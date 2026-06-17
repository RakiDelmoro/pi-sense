import { Point } from '@influxdata/influxdb-client';
import mqtt, { type IClientPublishOptions } from 'mqtt';
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

let mqttClient: mqtt.MqttClient | null = null;

export type SensorValueHandler = (topic: string, value: number, timestamp: Date) => void;
export type MessageHandler = (topic: string, payload: Buffer) => void;
export type ConnectHandler = () => void;

const sensorValueHandlers = new Set<SensorValueHandler>();
const messageHandlers = new Set<MessageHandler>();
const connectHandlers = new Set<ConnectHandler>();

let sensorTopics: string[] = [];

const AUTOMATION_CONTROL_TOPIC = 'automations/+/enabled';
const automationEnabled = new Map<string, boolean>();

export function getAutomationEnabled(slug: string): boolean | undefined {
  return automationEnabled.get(slug);
}

export function setAutomationEnabled(slug: string, enabled: boolean): void {
  automationEnabled.set(slug, enabled);
}

/** Register a handler called for every parsable sensor value the bridge receives. */
export function onSensorValue(handler: SensorValueHandler) {
  sensorValueHandlers.add(handler);
  return () => sensorValueHandlers.delete(handler);
}

/** Register a handler called for every raw MQTT message received. */
export function onMqttMessage(handler: MessageHandler) {
  messageHandlers.add(handler);
  return () => messageHandlers.delete(handler);
}

/** Register a handler called every time the MQTT client connects (or reconnects). */
export function onMqttConnect(handler: ConnectHandler) {
  connectHandlers.add(handler);
  // If connection is already up, run immediately.
  if (mqttClient?.connected) {
    handler();
  }
  return () => connectHandlers.delete(handler);
}

/** Publish a message on the shared MQTT connection. */
export function publish(
  topic: string,
  payload: unknown,
  opts: IClientPublishOptions = { qos: 1, retain: false },
): void {
  if (!mqttClient || !mqttClient.connected) {
    console.warn(`⚠️ MQTT not connected — dropping publish to ${topic}`);
    return;
  }
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  mqttClient.publish(topic, data, opts);
  console.log(`📤 MQTT publish → ${topic}: ${data}`);
}

export function startMqttBridge() {
  const mqttUrl = (process.env.MQTT_URL || 'mqtt://localhost:1883').trim();
  const mqttUsername = process.env.MQTT_USERNAME?.trim() || undefined;
  const mqttPassword = process.env.MQTT_PASSWORD?.trim() || undefined;
  console.log(`🔍 MQTT_URL = ${JSON.stringify(mqttUrl)}`);
  mqttClient = mqtt.connect(mqttUrl, {
    username: mqttUsername,
    password: mqttPassword,
  });

  const client = mqttClient!;

  client.on('connect', () => {
    console.log(`📡 MQTT connected: ${mqttUrl}`);
    connectHandlers.forEach(h => h());
    sensorTopics = [...topicValueKeys.keys()].filter(t => !blockedTopics.has(t));
    if (sensorTopics.length === 0) {
      console.log('📡 No sensor topics to subscribe to');
    }
    const topics = sensorTopics.length > 0
      ? [...sensorTopics, AUTOMATION_CONTROL_TOPIC]
      : [AUTOMATION_CONTROL_TOPIC];
    client.subscribe(topics, (err) => {
      if (err) {
        console.error('MQTT subscribe error:', err);
      } else {
        console.log(`📡 Subscribed to: ${topics.join(', ')}`);
      }
    });
  });

  client.on('message', (topic, payload) => {
    messageHandlers.forEach(h => h(topic, payload));

    const automationMatch = topic.match(/^automations\/([^/]+)\/enabled$/);
    if (automationMatch) {
      try {
        const data = JSON.parse(payload.toString());
        if (typeof data.enabled === 'boolean') {
          automationEnabled.set(automationMatch[1], data.enabled);
        }
      } catch { /* ignore invalid payload */ }
      return;
    }

    if (blockedTopics.has(topic)) return;
    if (!sensorTopics.includes(topic)) return;

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
    sensorValueHandlers.forEach(h => h(topic, value, valueDate));

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

    writeApi.flush().then(async () => {
      const latest = await queryLatest(topic);
      if (latest) {
        broadcastUpdate(topic, latest.value, latest.timestamp, latest.timeOffsetMs);
      }
    }).catch((err) => {
      console.error('InfluxDB flush error:', err);
    });
  });

  client.on('error', (err) => {
    console.error('MQTT connection error:', err);
  });

  client.on('close', () => {
    console.log('MQTT connection closed — will auto-reconnect');
  });
}

/** Subscribe to an additional MQTT topic on the shared bridge connection. */
export function subscribeMqtt(topic: string, qos: 0 | 1 | 2 = 1): void {
  if (!mqttClient || !mqttClient.connected) {
    console.warn(`⚠️ MQTT not connected — deferring subscription to ${topic}`);
    mqttClient?.once('connect', () => subscribeMqtt(topic, qos));
    return;
  }
  mqttClient.subscribe(topic, { qos }, (err) => {
    if (err) {
      console.error(`MQTT subscribe error for ${topic}:`, err);
    } else {
      console.log(`📡 Subscribed to: ${topic}`);
    }
  });
}
