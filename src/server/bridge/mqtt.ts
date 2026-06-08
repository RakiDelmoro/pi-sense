import { Point } from '@influxdata/influxdb-client';
import mqtt from 'mqtt';
import {
  getWriteApi,
  queryLatest,
  blockedTopics,
  topicValueKeys,
  topicTimeOffsetKeys,
} from '../services/influx';
import { broadcastUpdate } from '../services/websocket';

/** Quote unquoted JSON keys so `{water_level: 42}` → `{"water_level": 42}` */
function quoteJsonKeys(raw: string): string {
  return raw.replace(/([,{\s])([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
}

export function startMqttBridge() {
  const mqttUrl = (process.env.MQTT_URL || 'mqtt://localhost:1883').trim();
  const mqttUsername = process.env.MQTT_USERNAME?.trim() || undefined;
  const mqttPassword = process.env.MQTT_PASSWORD?.trim() || undefined;
  console.log(`🔍 MQTT_URL = ${JSON.stringify(mqttUrl)}`);
  const mqttClient = mqtt.connect(mqttUrl, {
    username: mqttUsername,
    password: mqttPassword,
  });

  mqttClient.on('connect', () => {
    console.log(`📡 MQTT connected: ${mqttUrl}`);
    const topics = [...topicValueKeys.keys()].filter(t => !blockedTopics.has(t));
    if (topics.length === 0) {
      console.log('📡 No sensor topics to subscribe to');
      return;
    }
    mqttClient.subscribe(topics, (err) => {
      if (err) {
        console.error('MQTT subscribe error:', err);
      } else {
        console.log(`📡 Subscribed to: ${topics.join(', ')}`);
      }
    });
  });

  mqttClient.on('message', (topic, payload) => {
    if (blockedTopics.has(topic)) return;

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

    console.log(`📨 MQTT → ${topic}: ${value} ${raw}`);

    const point = new Point('sensor')
      .tag('topic', topic)
      .floatField('value', value);
    if (timeOffsetMs != null) {
      point.intField('time_offset_ms', timeOffsetMs);
    }
    point.timestamp(new Date(timestamp));
    const writeApi = getWriteApi();
    writeApi.writePoint(point);

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
}
