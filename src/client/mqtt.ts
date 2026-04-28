import type { MqttMessage } from "./types";

type MessageHandler = (msg: MqttMessage) => void;
type StatusHandler = (connected: boolean) => void;

declare global {
  var __MQTT_BROKER__: string | undefined;
  var __MQTT_WS_PORT__: string | undefined;
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const handlers = new Set<MessageHandler>();
const statusHandlers = new Set<StatusHandler>();
const subscribedTopics = new Set<string>();

const MQTT_BROKER = globalThis.__MQTT_BROKER__ || "localhost";
const MQTT_WS_PORT = globalThis.__MQTT_WS_PORT__ || "9001";

function getWsUrl(): string {
  return `ws://${MQTT_BROKER}:${MQTT_WS_PORT}`;
}

function send(data: Uint8Array | string) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(data);
  }
}

function notifyStatus(connected: boolean) {
  for (const h of statusHandlers) {
    try { h(connected); } catch { /* ignore */ }
  }
}

function encodeMqttConnect(): Uint8Array {
  const clientId = "pi-sense-" + Math.random().toString(36).slice(2, 8);
  const idBytes = new TextEncoder().encode(clientId);
  const idLen = idBytes.length;

  const header = 0x10;
  const protocolName = new TextEncoder().encode("MQTT");
  const protocolLevel = 0x04;
  const connectFlags = 0x02;
  const keepAlive = 60;

  const variable = new Uint8Array(2 + protocolName.length + 1 + 1 + 2 + 2 + idLen);
  let i = 0;
  variable[i++] = 0;
  variable[i++] = protocolName.length;
  variable.set(protocolName, i);
  i += protocolName.length;
  variable[i++] = protocolLevel;
  variable[i++] = connectFlags;
  variable[i++] = (keepAlive >> 8) & 0xff;
  variable[i++] = keepAlive & 0xff;
  variable[i++] = (idLen >> 8) & 0xff;
  variable[i++] = idLen & 0xff;
  variable.set(idBytes, i);

  const remainingLen = variable.length;
  const packet = new Uint8Array(1 + (remainingLen < 128 ? 1 : 2) + remainingLen);
  packet[0] = header;
  packet[1] = remainingLen;
  packet.set(variable, 2);

  return packet;
}

function encodeMqttSubscribe(topic: string, packetId: number): Uint8Array {
  const topicBytes = new TextEncoder().encode(topic);
  const topicLen = topicBytes.length;
  const qos = 0;

  const variableLen = 2 + topicLen + 1;
  const remainingLen = 2 + variableLen;

  const packet = new Uint8Array(1 + 1 + remainingLen);
  let i = 0;
  packet[i++] = 0x82;
  packet[i++] = remainingLen;
  packet[i++] = (packetId >> 8) & 0xff;
  packet[i++] = packetId & 0xff;
  packet[i++] = (topicLen >> 8) & 0xff;
  packet[i++] = topicLen & 0xff;
  packet.set(topicBytes, i);
  i += topicLen;
  packet[i++] = qos;

  return packet;
}

function encodeMqttUnsubscribe(topic: string, packetId: number): Uint8Array {
  const topicBytes = new TextEncoder().encode(topic);
  const topicLen = topicBytes.length;

  const variableLen = 2 + topicLen;
  const remainingLen = 2 + variableLen;

  const packet = new Uint8Array(1 + 1 + remainingLen);
  let i = 0;
  packet[i++] = 0xa2;
  packet[i++] = remainingLen;
  packet[i++] = (packetId >> 8) & 0xff;
  packet[i++] = packetId & 0xff;
  packet[i++] = (topicLen >> 8) & 0xff;
  packet[i++] = topicLen & 0xff;
  packet.set(topicBytes, i);

  return packet;
}

function encodeMqttPingreq(): Uint8Array {
  return new Uint8Array([0xc0, 0x00]);
}

function parseMqttPublish(data: Uint8Array): MqttMessage | null {
  if (data.length < 2 || (data[0] & 0xf0) !== 0x30) return null;

  let pos = 1;
  let remainingLen = 0;
  let multiplier = 1;
  let digit: number;
  do {
    digit = data[pos++];
    remainingLen += (digit & 0x7f) * multiplier;
    multiplier *= 128;
  } while ((digit & 0x80) !== 0);

  const topicLen = (data[pos] << 8) | data[pos + 1];
  pos += 2;
  const topic = new TextDecoder().decode(data.slice(pos, pos + topicLen));
  pos += topicLen;

  const qos = (data[0] >> 1) & 0x03;
  if (qos > 0) pos += 2;

  const payload = new TextDecoder().decode(data.slice(pos, pos + remainingLen - (pos - 2)));

  return { topic, payload };
}

function connect() {
  if (ws) return;

  try {
    ws = new WebSocket(getWsUrl());
    ws.binaryType = "arraybuffer";
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    notifyStatus(true);
    send(encodeMqttConnect());
    for (const topic of subscribedTopics) {
      send(encodeMqttSubscribe(topic, Math.floor(Math.random() * 65535)));
    }
  };

  ws.onmessage = (event) => {
    const data = new Uint8Array(event.data as ArrayBuffer);
    const msg = parseMqttPublish(data);
    if (msg) {
      for (const h of handlers) h(msg);
    }
  };

  ws.onclose = () => {
    ws = null;
    notifyStatus(false);
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 3000);
}

setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN) {
    send(encodeMqttPingreq());
  }
}, 30000);

export function initMqtt() {
  connect();
}

export function subscribe(topic: string) {
  subscribedTopics.add(topic);
  if (ws?.readyState === WebSocket.OPEN) {
    send(encodeMqttSubscribe(topic, Math.floor(Math.random() * 65535)));
  }
}

export function unsubscribe(topic: string) {
  subscribedTopics.delete(topic);
  if (ws?.readyState === WebSocket.OPEN) {
    send(encodeMqttUnsubscribe(topic, Math.floor(Math.random() * 65535)));
  }
}

export function onMessage(handler: MessageHandler) {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function onStatusChange(handler: StatusHandler) {
  statusHandlers.add(handler);
  // Immediately call with current best-guess state
  handler(ws !== null && ws.readyState === WebSocket.OPEN);
  return () => statusHandlers.delete(handler);
}
