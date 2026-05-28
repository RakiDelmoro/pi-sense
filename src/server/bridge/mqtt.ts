import { Point } from '@influxdata/influxdb-client';
import mqtt from 'mqtt';
import {
  writeApi,
  queryLatest,
  blockedTopics,
  topicValueKeys,
  topicTimeOffsetKeys,
} from '../services/influx';
import { broadcastUpdate } from '../services/websocket';

const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const MQTT_TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX || 'pi-sensors/#';

export function startMqttBridge() {
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
      if (isNaN(value)) return;
      timestamp = new Date().toISOString();
    }

    const point = new Point('sensor')
      .tag('topic', topic)
      .floatField('value', value);
    if (timeOffsetMs != null) {
      point.intField('time_offset_ms', timeOffsetMs);
    }
    point.timestamp(new Date(timestamp));
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
