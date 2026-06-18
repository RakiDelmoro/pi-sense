import mqtt, { type IClientPublishOptions } from 'mqtt';

// Reusable MQTT client wrapper shared by the adapter, dashboard, and
// automation containers. Each process owns exactly one connection to the
// broker; callers register message/connect handlers and subscribe to the
// topics they care about. This module holds no ingest or business logic.

let mqttClient: mqtt.MqttClient | null = null;

export type MessageHandler = (topic: string, payload: Buffer) => void;
export type ConnectHandler = () => void;

const messageHandlers = new Set<MessageHandler>();
const connectHandlers = new Set<ConnectHandler>();

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

/** Connect the shared MQTT client. Call once at process startup. */
export function startMqttClient() {
  if (mqttClient) return; // idempotent
  const mqttUrl = (process.env.MQTT_URL || 'mqtt://localhost:1883').trim();
  const mqttUsername = process.env.MQTT_USERNAME?.trim() || undefined;
  const mqttPassword = process.env.MQTT_PASSWORD?.trim() || undefined;
  console.log(`🔍 MQTT_URL = ${JSON.stringify(mqttUrl)}`);
  mqttClient = mqtt.connect(mqttUrl, {
    username: mqttUsername,
    password: mqttPassword,
  });

  const client = mqttClient;

  client.on('connect', () => {
    console.log(`📡 MQTT connected: ${mqttUrl}`);
    connectHandlers.forEach(h => h());
  });

  client.on('message', (topic, payload) => {
    messageHandlers.forEach(h => h(topic, payload));
  });

  client.on('error', (err) => {
    console.error('MQTT connection error:', err);
  });

  client.on('close', () => {
    console.log('MQTT connection closed — will auto-reconnect');
  });
}
