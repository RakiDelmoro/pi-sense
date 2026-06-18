import { Point } from '@influxdata/influxdb-client';
import { getWriteApi } from '../influx/influx';
import { topicValueKeys, topicTimeOffsetKeys } from '../mqtt/sensor-topics';
import { onMqttMessage, onMqttConnect, publish, subscribeMqtt } from '../mqtt/mqtt';

/** Quote unquoted JSON keys so `{water_level: 42}` → `{"water_level": 42}` */
function quoteJsonKeys(raw: string): string {
  return raw.replace(/([,{\s])([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
}

// Adapter-only ingest filter. Populated from retained `pi-sense/blocked/<topic>`
// messages so blocks survive adapter restarts. A blocked topic is never written
// to InfluxDB even though the adapter remains subscribed to it.
export const blockedTopics = new Set<string>();

const UPDATE_TOPIC_PREFIX = 'pi-sense/updates/';
const BLOCKED_TOPIC_PREFIX = 'pi-sense/blocked/';

/** Start the ingest loop: subscribe to sensor topics, parse, write InfluxDB, notify. */
export function startIngest() {
  // Track block/unblock control (retained) so the filter survives restarts.
  subscribeMqtt('pi-sense/blocked/#', 1);

  onMqttMessage((topic, payload) => {
    // Block/unblock control — maintain the ingest filter.
    if (topic.startsWith(BLOCKED_TOPIC_PREFIX)) {
      const blockedTopic = topic.slice(BLOCKED_TOPIC_PREFIX.length);
      const raw = payload.toString().trim();
      if (raw === '0') {
        blockedTopics.delete(blockedTopic);
        console.log(`✅ Unblocked topic: ${blockedTopic}`);
      } else {
        blockedTopics.add(blockedTopic);
        console.log(`🚫 Blocked topic: ${blockedTopic}`);
      }
      return;
    }

    if (blockedTopics.has(topic)) return;
    if (!topicValueKeys.has(topic)) return;

    const raw = payload.toString();
    let value: number;
    let timeOffsetMs: number | undefined;
    let timestamp: string;

    try {
      const data = JSON.parse(raw) || JSON.parse(quoteJsonKeys(raw));
      const key = topicValueKeys.get(topic) ?? 'value';
      value = Number(data[key] ?? data.value ?? data);
      if (isNaN(value)) {
        console.warn(`⚠️  MQTT dropped: topic="${topic}" — value is NaN from key "${key}" in payload: ${raw}`);
        return;
      }
      const timeOffsetKey = topicTimeOffsetKeys.get(topic);
      if (timeOffsetKey && data[timeOffsetKey] != null) {
        timeOffsetMs = Number(data[timeOffsetKey]);
        if (isNaN(timeOffsetMs)) timeOffsetMs = undefined;
      }
      timestamp = (data.timestamp && !isNaN(Date.parse(data.timestamp)))
        ? data.timestamp
        : new Date().toISOString();
    } catch {
      value = Number(raw);
      if (isNaN(value)) {
        console.warn(`⚠️  MQTT dropped: topic="${topic}" — not valid JSON and not a number: ${raw}`);
        return;
      }
      timestamp = new Date().toISOString();
    }

    const valueDate = new Date(timestamp);
    console.log(`📨 MQTT → ${topic}: ${value} ${raw}`);

    const point = new Point('sensor')
      .tag('topic', topic)
      .floatField('value', value);
    if (timeOffsetMs != null) {
      point.intField('time_offset_ms', timeOffsetMs);
    }
    point.timestamp(valueDate);
    const writeApi = getWriteApi();
    writeApi.writePoint(point);

    writeApi.flush().then(() => {
      // Notify downstream consumers (dashboard, automation) that the DB changed.
      // Bare payload — the DB remains the only source of truth for values.
      publish(UPDATE_TOPIC_PREFIX + topic, '', { qos: 1, retain: false });
    }).catch((err) => {
      console.error('InfluxDB flush error:', err);
    });
  });

  // (Re)subscribe to all sensor topics on every (re)connect.
  onMqttConnect(() => {
    const topics = [...topicValueKeys.keys()];
    if (topics.length === 0) {
      console.log('📡 No sensor topics to subscribe to');
      return;
    }
    for (const t of topics) subscribeMqtt(t, 1);
  });

  console.log('🔌 Ingest started');
}
