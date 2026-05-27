import { InfluxDB, Point } from '@influxdata/influxdb-client';
import mqtt from 'mqtt';

const PORT = parseInt(process.env.PORT || '3141');
const ROOT = import.meta.dir;
const INFLUX_URL = process.env.INFLUX_URL || 'http://localhost:8086';
const INFLUX_TOKEN = process.env.INFLUX_TOKEN || '';
const INFLUX_ORG = process.env.INFLUX_ORG || 'pi-sense';
const INFLUX_BUCKET = process.env.INFLUX_BUCKET || 'pi-sense';

function join(...parts: string[]) {
  return parts.join('/').replace(/\/+/g, '/');
}

// ── Per-topic value keys (extracted from sensor configs) ─────────
// Maps MQTT topic → JSON key to extract numeric value from payloads.
// Default is 'value'. If a sensor config specifies `valueKey`, that's used instead.
const topicValueKeys = new Map<string, string>();

// ── Per-topic time-offset keys ────────────────────────────────────
// Maps MQTT topic → JSON key for the time offset (ms) in payloads.
// When present, the bridge stores `time_offset_ms` alongside `value`
// and the history/latest APIs use a pivot query to return both fields.
const topicTimeOffsetKeys = new Map<string, string>();

// ── InfluxDB client ──────────────────────────────────────────────
const influx = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
const queryApi = influx.getQueryApi(INFLUX_ORG);
const writeApi = influx.getWriteApi(INFLUX_ORG, INFLUX_BUCKET, 'ms');

// ── WebSocket clients ────────────────────────────────────────────
const wsClients = new Set<ServerWebSocket>();
const topicSubs = new Map<string, Set<ServerWebSocket>>(); // topic → set of ws
const blockedTopics = new Set<string>(); // topics deleted via API — MQTT bridge skips these

function subscribeWs(ws: ServerWebSocket, topics: string[]) {
  for (const topic of topics) {
    if (!topicSubs.has(topic)) topicSubs.set(topic, new Set());
    topicSubs.get(topic)!.add(ws);
  }
}

function unsubscribeWs(ws: ServerWebSocket, topics: string[]) {
  for (const topic of topics) {
    topicSubs.get(topic)?.delete(ws);
    if (topicSubs.get(topic)?.size === 0) topicSubs.delete(topic);
  }
}

function removeWs(ws: ServerWebSocket) {
  wsClients.delete(ws);
  for (const [, subs] of topicSubs) {
    subs.delete(ws);
  }
  // Clean up empty topic sets
  for (const [topic, subs] of topicSubs) {
    if (subs.size === 0) topicSubs.delete(topic);
  }
}

/** Push a sensor update to all browsers subscribed to that topic */
export function broadcastUpdate(topic: string, value: number, timestamp: string, timeOffsetMs?: number) {
  const msg = JSON.stringify({ topic, value, timestamp, ...(timeOffsetMs != null && { timeOffsetMs }) });
  const subs = topicSubs.get(topic);
  if (subs) {
    for (const ws of subs) {
      ws.send(msg);
    }
  }
}

// ── Input validation ────────────────────────────────────────────

/** Validate topic name — only alphanumeric, hyphens, underscores, forward slashes */
function isValidTopic(topic: string): boolean {
  return /^[a-zA-Z0-9_\-\/]+$/.test(topic);
}



// ── InfluxDB queries ─────────────────────────────────────────────

/** Query the latest value for a topic from InfluxDB */
async function queryLatest(topic: string): Promise<{ value: number; timestamp: string; timeOffsetMs?: number } | null> {
  if (!isValidTopic(topic)) {
    console.error(`Invalid topic rejected: ${topic}`);
    return null;
  }
  const hasTimeOffset = topicTimeOffsetKeys.has(topic);
  // For timeOffset topics: last() before pivot() because pivot removes _value column
  const lastBeforePivot = hasTimeOffset;
  const pivotClause = hasTimeOffset
    ? '|> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")'
    : '';
  const lastClause = hasTimeOffset ? '|> last()' : '';
  const flux = `
    from(bucket: "${INFLUX_BUCKET}")
      |> range(start: -24h)
      |> filter(fn: (r) => r._measurement == "sensor" and r.topic == "${topic}")
      ${lastBeforePivot ? '|> last()' : ''}
      ${pivotClause}
      ${!lastBeforePivot ? '|> last()' : ''}
  `;
  try {
    const rows = await queryApi.collectRows(flux, (row: any, tableMeta: any) => {
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



/** Validate time range — only digits + unit (m/h/d/Mo/y) */
function isValidRange(range: string): boolean {
  return /^\d+[mhd]$|^\d+Mo$|^\d+y$/.test(range);
}

/** Map client range syntax to InfluxDB Flux syntax.
 *  InfluxDB Flux uses: m=minutes, h=hours, d=days, mo=months, y=years.
 *  Client sends: Mo for months (uppercase to distinguish from m=minutes). */
function normalizeRange(range: string): string {
  return range.replace(/Mo$/, 'mo');
}

/** Validate ISO timestamp string */
function isValidIsoTimestamp(ts: string): boolean {
  return !isNaN(Date.parse(ts));
}

/** Max raw points before auto-downsampling kicks in. */
const DOWNSAMPLE_THRESHOLD = 5000;

/** Compute the smallest aggregateWindow that fits within the threshold.
 *  Calculates window = range_duration / threshold, rounded up to a nice interval. */
function autoAggregateWindow(range: string, rawCount: number): string {
  if (rawCount <= DOWNSAMPLE_THRESHOLD) return '';
  // Nice window sizes in ascending order
  const windows = ['1m', '2m', '5m', '10m', '15m', '30m', '1h', '2h', '3h', '6h', '12h', '1d'];
  const ratio = rawCount / DOWNSAMPLE_THRESHOLD;
  // Pick the window whose index is closest to the ratio
  const idx = Math.min(Math.ceil(Math.log2(ratio)), windows.length - 1);
  return windows[idx];
}

/** Query data points for a topic within a time range.
 *  Returns raw data if count is within threshold; auto-downsamples otherwise.
 *  For topics with timeOffsetKey, uses pivot query to return timeOffsetMs. */
async function queryHistory(topic: string, limit: number, range: string = '24h', startIso?: string, stopIso?: string): Promise<{ value: number; timestamp: string; timeOffsetMs?: number }[]> {
  if (!isValidTopic(topic)) {
    console.error(`Invalid topic rejected: ${topic}`);
    return [];
  }
  // Determine range clause: absolute timestamps or relative range
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

  // First pass: count raw points in the range
  // For topics with time_offset_ms field, filter to only count the 'value' field
  // to avoid double-counting
  const fieldFilter = hasTimeOffset ? '\n      |> filter(fn: (r) => r._field == "value")' : '';
  const countFlux = `
    from(bucket: "${INFLUX_BUCKET}")
      |> range(${rangeClause})
      |> filter(fn: (r) => r._measurement == "sensor" and r.topic == "${topic}")${fieldFilter}
      |> group()
      |> count()
  `;
  let rawCount = 0;
  try {
    const countRows = await queryApi.collectRows(countFlux, (row: any, tableMeta: any) => {
      const o = tableMeta.toObject(row);
      return Number(o._value);
    });
    rawCount = countRows[0] ?? 0;
  } catch (err) {
    console.error('InfluxDB count error:', err);
  }

  // For timeOffset topics, skip aggregateWindow (can't meaningfully average time_offset_ms)
  // and use pivot to merge value + time_offset_ms into single rows
  const window = !hasTimeOffset && rawCount > DOWNSAMPLE_THRESHOLD ? autoAggregateWindow(range, rawCount) : '';
  const windowClause = window ? `|> aggregateWindow(every: ${window}, fn: mean, createEmpty: false)` : '';

  // For topics with timeOffsetKey, pivot the value and time_offset_ms fields
  const pivotClause = hasTimeOffset
    ? '|> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")'
    : '';

  const flux = `
    from(bucket: "${INFLUX_BUCKET}")
      |> range(${rangeClause})
      |> filter(fn: (r) => r._measurement == "sensor" and r.topic == "${topic}")
      ${windowClause}
      ${pivotClause}
      |> sort(columns: ["_time"])
      |> limit(n: ${limit})
  `;
  try {
    const rows = await queryApi.collectRows(flux, (row: any, tableMeta: any) => {
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

// ── InfluxDB data deletion ─────────────────────────────────────

/** Delete all InfluxDB data for a topic. Returns true on success (HTTP 204). */
async function deleteInfluxData(topic: string): Promise<boolean> {
  if (!isValidTopic(topic)) {
    console.error(`Invalid topic rejected for deletion: ${topic}`);
    return false;
  }
  const url = `${INFLUX_URL}/api/v2/delete?org=${encodeURIComponent(INFLUX_ORG)}&bucket=${encodeURIComponent(INFLUX_BUCKET)}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${INFLUX_TOKEN}`,
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

// ── Sensor registry generator ─────────────────────────────────

/** Scan sensors/ directory and generate src/sensor-registry.ts with static imports.
 *  This ensures Bun.build() includes all sensor components in the bundle. */
async function generateSensorRegistry() {
  const glob = new Bun.Glob('sensors/*/sensor.tsx');
  const entries = [...glob.scanSync({ cwd: ROOT })];

  const imports: string[] = [];
  const items: string[] = [];
  const activeTopics = new Set<string>();

  for (const entry of entries) {
    const slug = entry.match(/sensors\/([^/]+)\/sensor\.tsx/)?.[1];
    if (!slug) continue;
    // Validate slug: only lowercase alphanumeric and hyphens
    if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
      console.error(`Invalid sensor slug skipped: ${slug} (must be lowercase alphanumeric + hyphens)`);
      continue;
    }
    // Read topic and valueKey from config
    try {
      const configContent = await Bun.file(join(ROOT, 'sensors', slug, 'config.ts')).text();
      const topicMatch = configContent.match(/topic:\s*['"]([^'"]+)['"]/);
      if (topicMatch) {
        activeTopics.add(topicMatch[1]);
        // Extract valueKey if specified (default is 'value')
        const valueKeyMatch = configContent.match(/valueKey:\s*['"]([^'"]+)['"]/);
        if (valueKeyMatch) {
          topicValueKeys.set(topicMatch[1], valueKeyMatch[1]);
        }
        // Extract timeOffsetKey if specified
        const timeOffsetKeyMatch = configContent.match(/timeOffsetKey:\s*['"]([^'"]+)['"]/);
        if (timeOffsetKeyMatch) {
          topicTimeOffsetKeys.set(topicMatch[1], timeOffsetKeyMatch[1]);
        }
      }
    } catch { /* ignore — topic will remain blocked if config can't be read */ }
    const varName = slug.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
    // Relative path from src/ to sensors/<slug>/sensor.tsx
    imports.push(`import ${varName} from '../${entry.replace(/\.tsx$/, '')}';`);
    items.push(`  { slug: '${slug}', Component: ${varName} },`);
  }

  const content = `// Auto-generated by server.ts — do not edit manually
${imports.join('\n')}

import type { FunctionalComponent } from 'preact';

export interface SensorEntry {
  slug: string;
  Component: FunctionalComponent;
}

const sensorRegistry: SensorEntry[] = [
${items.join('\n')}
];

export default sensorRegistry;
`;

  // Unblock topics that have active sensors (handles re-creation after deletion)
  for (const topic of activeTopics) {
    blockedTopics.delete(topic);
  }

  await Bun.write(join(ROOT, 'src/sensor-registry.ts'), content);
  console.log(`Generated sensor registry: ${entries.length} sensor(s) found`);
}

// ── Build ────────────────────────────────────────────────────────
let cachedJS = '';
let cachedCSS = '';

async function buildApp() {
  await generateSensorRegistry();

  const result = await Bun.build({
    entrypoints: [join(ROOT, 'src/index.tsx')],
    outdir: '/tmp/pi-sense-build',
    sourcemap: 'inline',
    target: 'browser',
  });

  if (result.success) {
    const js = result.outputs.find(o => o.type.startsWith('text/javascript'));
    const css = result.outputs.find(o => o.type.startsWith('text/css'));
    if (js) cachedJS = await js.text();
    if (css) cachedCSS = await css.text();
  } else {
    console.error('Build failed:', result.logs);
  }
}

// ── Load pre-built or build from source ─────────────────────────
// In production (Docker), pre-built files exist in /app/dist/.
// In development, we build from source and watch for changes.
async function loadOrBuildApp() {
  const prebuiltJS = join(ROOT, 'dist', 'index.js');
  const prebuiltCSS = join(ROOT, 'dist', 'index.css');

  const jsExists = await Bun.file(prebuiltJS).exists();
  const cssExists = await Bun.file(prebuiltCSS).exists();

  if (jsExists && cssExists) {
    cachedJS = await Bun.file(prebuiltJS).text();
    cachedCSS = await Bun.file(prebuiltCSS).text();
    console.log('Loaded pre-built frontend bundle from dist/');
  } else {
    await buildApp();
    console.log('Built frontend bundle from source');
  }
}

await loadOrBuildApp();

// ── File watcher for sensor changes ──────────────────────────────
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleRebuild() {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  // Debounce: wait 300ms after last file change before rebuilding
  // (sensor creation writes 3 files nearly simultaneously)
  rebuildTimer = setTimeout(async () => {
    rebuildTimer = null;
    console.log('Sensor files changed — rebuilding frontend...');
    await buildApp();
    console.log('Frontend rebuild complete');
  }, 300);
}

try {
  const { watchFile } = await import('fs');
  const sensorsDir = join(ROOT, 'sensors');
  const srcDir = join(ROOT, 'src');

  // Use polling-based watcher because inotify (fs.watch) may not work
  // in all environments (e.g., Docker containers, some CI systems).
  // Poll every 1s — fast enough for dev, light enough for resources.
  watchFile(sensorsDir, { interval: 1000 }, (curr, prev) => {
    if (curr.mtimeMs !== prev.mtimeMs) {
      scheduleRebuild();
    }
  });

  watchFile(srcDir, { interval: 1000 }, (curr, prev) => {
    if (curr.mtimeMs !== prev.mtimeMs) {
      scheduleRebuild();
    }
  });

  console.log('Watching sensors/ and src/ for changes (polling every 1s)');
} catch {
  console.log('Could not watch sensors/ and src/ — manual rebuild required');
}

// ── HTTP + WebSocket server ──────────────────────────────────────
const server = Bun.serve({
  port: PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // WebSocket upgrade
    if (pathname === '/ws') {
      if (server.upgrade(req)) return;
      return new Response('WebSocket upgrade failed', { status: 500 });
    }

    // API: latest value for a topic
    if (pathname === '/api/latest') {
      const topic = url.searchParams.get('topic') || '';
      if (!topic) {
        return new Response(JSON.stringify({ error: 'topic is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return queryLatest(topic).then(data =>
        new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json' },
        })
      ).catch(() =>
        new Response(JSON.stringify(null), {
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }

    // API: historical data (raw unless auto-downsampled)
    if (pathname === '/api/history') {
      const topic = url.searchParams.get('topic') || '';
      const limit = parseInt(url.searchParams.get('limit') || '8640', 10);
      const range = url.searchParams.get('range') || '24h';
      const startIso = url.searchParams.get('start') || undefined;
      const stopIso = url.searchParams.get('stop') || undefined;
      if (!topic) {
        return new Response(JSON.stringify({ error: 'topic is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return queryHistory(topic, limit, range, startIso, stopIso).then(data =>
        new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json' },
        })
      ).catch(() =>
        new Response(JSON.stringify({ error: 'query failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }

    // API: clear sensor data (wipe InfluxDB, keep topic active — NOT a sensor deletion)
    if (req.method === 'POST' && pathname === '/api/sensor-data/clear') {
      const topic = url.searchParams.get('topic') || '';
      if (!topic || !isValidTopic(topic)) {
        return new Response(JSON.stringify({ error: 'valid topic is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return deleteInfluxData(topic).then(deleted => {
        if (!deleted) {
          return new Response(JSON.stringify({ error: 'failed to clear InfluxDB data' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Do NOT block the topic — new data continues to flow normally
        return new Response(null, { status: 204 });
      });
    }

    // API: delete sensor data and block topic (permanent sensor removal)
    if (req.method === 'DELETE' && pathname === '/api/sensor-data') {
      const topic = url.searchParams.get('topic') || '';
      if (!topic || !isValidTopic(topic)) {
        return new Response(JSON.stringify({ error: 'valid topic is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return deleteInfluxData(topic).then(deleted => {
        if (!deleted) {
          return new Response(JSON.stringify({ error: 'failed to delete InfluxDB data' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Block the topic so the MQTT bridge stops writing new data for it
        blockedTopics.add(topic);

        // Clean up WebSocket subscriptions for this topic
        const subs = topicSubs.get(topic);
        if (subs) {
          for (const ws of subs) {
            ws.send(JSON.stringify({ topic, deleted: true }));
          }
          topicSubs.delete(topic);
        }

        return new Response(null, { status: 204 });
      });
    }

    // Serve index.html
    if (pathname === '/') {
      return new Response(Bun.file(join(ROOT, 'index.html')));
    }

    // Serve bundled JS
    if (pathname === '/dist/app.js') {
      return new Response(cachedJS, {
        headers: { 'Content-Type': 'application/javascript' },
      });
    }

    // Serve bundled CSS
    if (pathname === '/dist/app.css') {
      return new Response(cachedCSS, {
        headers: { 'Content-Type': 'text/css' },
      });
    }

    // Serve static files from public/
    if (pathname.startsWith('/public/')) {
      const resolved = new URL(pathname, 'http://localhost').pathname;
      // Prevent directory traversal
      if (resolved.includes('..')) {
        return new Response('Forbidden', { status: 403 });
      }
      const filePath = join(ROOT, resolved.replace(/^\//, ''));
      // Verify resolved path stays within public/
      if (!filePath.startsWith(join(ROOT, 'public'))) {
        return new Response('Forbidden', { status: 403 });
      }
      const file = Bun.file(filePath);
      return new Response(file);
    }

    return new Response('Not Found', { status: 404 });
  },
  websocket: {
    maxPayloadLength: 16 * 1024, // 16KB max per WebSocket message
    open(ws) {
      wsClients.add(ws);
    },
    message(ws, message) {
      try {
        const msg = JSON.parse(message as string);
        if (msg.action === 'subscribe' && Array.isArray(msg.topics)) {
          subscribeWs(ws, msg.topics);
        } else if (msg.action === 'unsubscribe' && Array.isArray(msg.topics)) {
          unsubscribeWs(ws, msg.topics);
        }
      } catch { /* ignore malformed */ }
    },
    close(ws) {
      removeWs(ws);
    },
  },
});

console.log(`🔥 Pi Sense server → http://localhost:${PORT}`);
console.log(`   WebSocket endpoint → ws://localhost:${PORT}/ws`);
console.log(`   InfluxDB → ${INFLUX_URL} (org=${INFLUX_ORG}, bucket=${INFLUX_BUCKET})`);

// ── MQTT Bridge ─────────────────────────────────────────────────
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const MQTT_TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX || 'sensors/#';

const mqttClient = mqtt.connect(MQTT_URL, {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
});

mqttClient.on('connect', () => {
  console.log(`📡 MQTT connected: ${MQTT_URL}`);
  mqttClient.subscribe(MQTT_TOPIC_PREFIX, (err) => {
    if (err) {
      console.error('MQTT subscribe error:', err);
    } else {
      console.log(`📡 Subscribed to: ${MQTT_TOPIC_PREFIX}`);
    }
  });
});

mqttClient.on('message', (topic, payload) => {
  // Skip blocked (deleted) topics — don't write ghost data to InfluxDB
  if (blockedTopics.has(topic)) return;

  const raw = payload.toString();
  let value: number;
  let timeOffsetMs: number | undefined;
  let timestamp: string;

  try {
    const data = JSON.parse(raw);
    const key = topicValueKeys.get(topic) ?? 'value';
    value = Number(data[key] ?? data.value ?? data);
    if (isNaN(value)) return;
    // Extract time offset if this topic has a timeOffsetKey configured
    const timeOffsetKey = topicTimeOffsetKeys.get(topic);
    if (timeOffsetKey && data[timeOffsetKey] != null) {
      timeOffsetMs = Number(data[timeOffsetKey]);
      if (isNaN(timeOffsetMs)) timeOffsetMs = undefined;
    }
    timestamp = (data.timestamp && !isNaN(Date.parse(data.timestamp)))
      ? data.timestamp
      : new Date().toISOString();
  } catch {
    // Fallback: treat raw payload as a numeric value
    value = Number(raw);
    if (isNaN(value)) return;
    timestamp = new Date().toISOString();
  }

  // ① Write to InfluxDB — it's the source of truth
  const point = new Point('sensor')
    .tag('topic', topic)
    .floatField('value', value);
  if (timeOffsetMs != null) {
    point.intField('time_offset_ms', timeOffsetMs);
  }
  point.timestamp(new Date(timestamp));
  writeApi.writePoint(point);

  // ② Flush, then query InfluxDB and broadcast to browsers — all in-process
  writeApi.flush().then(async () => {
    const latest = await queryLatest(topic);
    if (latest) {
      broadcastUpdate(topic, latest.value, latest.timestamp, latest.timeOffsetMs);
    }
  }).catch((err) => {
    console.error('InfluxDB flush error:', err);
  });
});

mqttClient.on('error', (err) => {
  console.error('MQTT connection error:', err);
});

mqttClient.on('close', () => {
  console.log('MQTT connection closed — will auto-reconnect');
});
