import { InfluxDB } from '@influxdata/influxdb-client';
import { topicTimeOffsetKeys } from '../mqtt/sensor-topics';

// Lazy init — env vars are read after server.ts CRLF sanitizer runs
let _influx: InfluxDB | null = null;
let _queryApi: ReturnType<InfluxDB['getQueryApi']> | null = null;
let _writeApi: ReturnType<InfluxDB['getWriteApi']> | null = null;

function getInflux() {
  if (!_influx) {
    const url = (process.env.INFLUX_URL || 'http://localhost:8086').trim();
    const token = (process.env.INFLUX_TOKEN || '').trim();
    _influx = new InfluxDB({ url, token });
  }
  return _influx;
}

export function getQueryApi() {
  if (!_queryApi) {
    _queryApi = getInflux().getQueryApi((process.env.INFLUX_ORG || 'pi-sense').trim());
  }
  return _queryApi;
}

export function getWriteApi() {
  if (!_writeApi) {
    const org = (process.env.INFLUX_ORG || 'pi-sense').trim();
    const bucket = (process.env.INFLUX_BUCKET || 'pi-sense').trim();
    _writeApi = getInflux().getWriteApi(org, bucket, 'ms');
  }
  return _writeApi;
}

export function getInfluxBucket() { return (process.env.INFLUX_BUCKET || 'pi-sense').trim(); }

/** Validate topic name — only alphanumeric, hyphens, underscores, forward slashes */
export function isValidTopic(topic: string): boolean {
  return /^[a-zA-Z0-9_\-\/]+$/.test(topic);
}

/** Validate time range — only digits + unit (m/h/d/Mo/y) */
export function isValidRange(range: string): boolean {
  return /^\d+[mhd]$|^\d+Mo$|^\d+y$/.test(range);
}

/** Map client range syntax to InfluxDB Flux syntax. */
export function normalizeRange(range: string): string {
  return range.replace(/Mo$/, 'mo');
}

/** Validate ISO timestamp string */
export function isValidIsoTimestamp(ts: string): boolean {
  return !isNaN(Date.parse(ts));
}

const DOWNSAMPLE_THRESHOLD = 5000;

function autoAggregateWindow(range: string, rawCount: number): string {
  if (rawCount <= DOWNSAMPLE_THRESHOLD) return '';
  const windows = ['1m', '2m', '5m', '10m', '15m', '30m', '1h', '2h', '3h', '6h', '12h', '1d'];
  const ratio = rawCount / DOWNSAMPLE_THRESHOLD;
  const idx = Math.min(Math.ceil(Math.log2(ratio)), windows.length - 1);
  return windows[idx];
}

/** Query the latest value for a topic from InfluxDB */
export async function queryLatest(topic: string): Promise<{ value: number; timestamp: string; timeOffsetMs?: number } | null> {
  if (!isValidTopic(topic)) {
    console.error(`Invalid topic rejected: ${topic}`);
    return null;
  }
  const hasTimeOffset = topicTimeOffsetKeys.has(topic);
  const lastBeforePivot = hasTimeOffset;
  const pivotClause = hasTimeOffset
    ? '|> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")'
    : '';

  const flux = `
    from(bucket: "${getInfluxBucket()}")
      |> range(start: -1y)
      |> filter(fn: (r) => r._measurement == "sensor" and r.topic == "${topic}")
      ${lastBeforePivot ? '|> last()' : ''}
      ${pivotClause}
      ${!lastBeforePivot ? '|> last()' : ''}
  `;
  try {
    const rows = await getQueryApi().collectRows(flux, (row: any, tableMeta: any) => {
      const o = tableMeta.toObject(row);
      const result: { value: number; timestamp: string; timeOffsetMs?: number } = {
        value: Number(hasTimeOffset ? o.value : o._value),
        timestamp: o._time,
      };
      if (hasTimeOffset && o.time_offset_ms != null) {
        result.timeOffsetMs = Number(o.time_offset_ms);
      }
      return result;
    });
    if (rows.length > 0) return rows[0];
  } catch (err) {
    console.error('InfluxDB query error (latest):', err);
  }
  return null;
}

/** Query data points for a topic within a time range. */
export async function queryHistory(
  topic: string,
  limit: number,
  range: string = '24h',
  startIso?: string,
  stopIso?: string
): Promise<{ value: number; timestamp: string; timeOffsetMs?: number }[]> {
  if (!isValidTopic(topic)) {
    console.error(`Invalid topic rejected: ${topic}`);
    return [];
  }
  let rangeClause: string;
  if (startIso && isValidIsoTimestamp(startIso)) {
    const start = new Date(startIso).toISOString();
    const stop = (stopIso && isValidIsoTimestamp(stopIso))
      ? new Date(stopIso).toISOString()
      : new Date().toISOString();
    rangeClause = `start: ${start}, stop: ${stop}`;
  } else {
    if (!isValidRange(range)) {
      console.error(`Invalid range rejected: ${range}`);
      return [];
    }
    rangeClause = `start: -${normalizeRange(range)}`;
  }
  if (!Number.isInteger(limit) || limit < 1) limit = 10000;
  const hasTimeOffset = topicTimeOffsetKeys.has(topic);

  const fieldFilter = hasTimeOffset ? '\n      |> filter(fn: (r) => r._field == "value")' : '';
  const countFlux = `
    from(bucket: "${getInfluxBucket()}")
      |> range(${rangeClause})
      |> filter(fn: (r) => r._measurement == "sensor" and r.topic == "${topic}")${fieldFilter}
      |> group()
      |> count()
  `;
  let rawCount = 0;
  try {
    const countRows = await getQueryApi().collectRows(countFlux, (row: any, tableMeta: any) => {
      const o = tableMeta.toObject(row);
      return Number(o._value);
    });
    rawCount = countRows[0] ?? 0;
  } catch (err) {
    console.error('InfluxDB count error:', err);
  }

  const window = !hasTimeOffset && rawCount > DOWNSAMPLE_THRESHOLD ? autoAggregateWindow(range, rawCount) : '';
  const windowClause = window ? `|> aggregateWindow(every: ${window}, fn: mean, createEmpty: false)` : '';
  const pivotClause = hasTimeOffset
    ? '|> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")'
    : '';

  const flux = `
    from(bucket: "${getInfluxBucket()}")
      |> range(${rangeClause})
      |> filter(fn: (r) => r._measurement == "sensor" and r.topic == "${topic}")
      ${windowClause}
      ${pivotClause}
      |> sort(columns: ["_time"])
      |> limit(n: ${limit})
  `;
  try {
    const rows = await getQueryApi().collectRows(flux, (row: any, tableMeta: any) => {
      const o = tableMeta.toObject(row);
      const result: { value: number; timestamp: string; timeOffsetMs?: number } = {
        value: Number(hasTimeOffset ? o.value : o._value),
        timestamp: o._time,
      };
      if (hasTimeOffset && o.time_offset_ms != null) {
        result.timeOffsetMs = Number(o.time_offset_ms);
      }
      return result;
    });
    return rows;
  } catch (err) {
    console.error('InfluxDB query error (history):', err);
    return [];
  }
}

/** Delete all InfluxDB data for a topic. */
export async function deleteInfluxData(topic: string): Promise<boolean> {
  if (!isValidTopic(topic)) {
    console.error(`Invalid topic rejected for deletion: ${topic}`);
    return false;
  }
  const url = `${(process.env.INFLUX_URL || 'http://localhost:8086').trim()}/api/v2/delete?org=${encodeURIComponent((process.env.INFLUX_ORG || 'pi-sense').trim())}&bucket=${encodeURIComponent(getInfluxBucket())}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${(process.env.INFLUX_TOKEN || '').trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        start: '1970-01-01T00:00:00Z',
        stop: '2030-01-01T00:00:00Z',
        predicate: `topic="${topic}"`,
      }),
    });
    if (res.status === 204) {
      console.log(`Deleted InfluxDB data for topic: ${topic}`);
      return true;
    }
    console.error(`InfluxDB delete failed: HTTP ${res.status}`);
    return false;
  } catch (err) {
    console.error('InfluxDB delete error:', err);
    return false;
  }
}
