// Lightweight embedded MQTT broker (TCP 1883 + WebSocket 9001)
// No dependencies — pure Bun.

interface ClientState {
  id: string;
  type: "tcp" | "ws";
  buffer: Uint8Array;
  subscriptions: Set<string>;
  socket: any;
}

const clients = new Map<string, ClientState>();

function parseRemainingLength(data: Uint8Array, start: number): { value: number; bytes: number } | null {
  let value = 0;
  let multiplier = 1;
  let pos = start;

  while (pos < data.length) {
    const byte = data[pos++];
    value += (byte & 0x7f) * multiplier;
    multiplier *= 128;
    if ((byte & 0x80) === 0) {
      return { value, bytes: pos - start };
    }
    if (multiplier > 128 * 128 * 128 * 128) return null;
  }
  return null;
}

function encodeConnack(): Uint8Array {
  return new Uint8Array([0x20, 0x02, 0x00, 0x00]);
}

function encodeSuback(packetId: number): Uint8Array {
  return new Uint8Array([0x90, 0x03, (packetId >> 8) & 0xff, packetId & 0xff, 0x00]);
}

function encodeUnsuback(packetId: number): Uint8Array {
  return new Uint8Array([0xb0, 0x02, (packetId >> 8) & 0xff, packetId & 0xff]);
}

function encodeVariableLength(value: number): number[] {
  const bytes: number[] = [];
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 0x80;
    bytes.push(byte);
  } while (value > 0);
  return bytes;
}

function encodePublish(topic: string, payload: string): Uint8Array {
  const topicBytes = new TextEncoder().encode(topic);
  const payloadBytes = new TextEncoder().encode(payload);
  const topicLen = topicBytes.length;
  const payloadLen = payloadBytes.length;
  const variableLen = 2 + topicLen + payloadLen;
  const remainingBytes = encodeVariableLength(variableLen);

  const packet = new Uint8Array(1 + remainingBytes.length + variableLen);
  let i = 0;
  packet[i++] = 0x30;
  for (const b of remainingBytes) packet[i++] = b;
  packet[i++] = (topicLen >> 8) & 0xff;
  packet[i++] = topicLen & 0xff;
  packet.set(topicBytes, i);
  i += topicLen;
  packet.set(payloadBytes, i);

  return packet;
}

function sendToClient(client: ClientState, data: Uint8Array) {
  if (client.type === "tcp") {
    (client.socket as Bun.Socket<any>).write(data);
  } else {
    (client.socket as any).send(data);
  }
}

function removeClient(clientId: string) {
  const client = clients.get(clientId);
  if (client && client.type === "tcp") {
    try { (client.socket as Bun.Socket<any>).end(); } catch { /* ignore */ }
  }
  clients.delete(clientId);
}

function handlePacket(client: ClientState, data: Uint8Array) {
  if (client.type === "tcp") {
    const newBuf = new Uint8Array(client.buffer.length + data.length);
    newBuf.set(client.buffer);
    newBuf.set(data, client.buffer.length);
    client.buffer = newBuf;

    while (client.buffer.length >= 2) {
      const rl = parseRemainingLength(client.buffer, 1);
      if (!rl) break;
      const totalLen = 1 + rl.bytes + rl.value;
      if (client.buffer.length < totalLen) break;

      const packet = client.buffer.slice(0, totalLen);
      client.buffer = client.buffer.slice(totalLen);
      processMqttPacket(client, packet);
    }
  } else {
    processMqttPacket(client, data);
  }
}

function processMqttPacket(client: ClientState, packet: Uint8Array) {
  const type = (packet[0] >> 4) & 0x0f;
  const rl = parseRemainingLength(packet, 1);
  if (!rl) return;

  let pos = 1 + rl.bytes;
  const packetEnd = 1 + rl.bytes + rl.value;

  switch (type) {
    case 1: { // CONNECT
      let p = pos;
      const protoLen = (packet[p] << 8) | packet[p + 1];
      p += 2 + protoLen;
      p += 1; // protocol level
      p += 1; // connect flags
      p += 2; // keep alive

      const idLen = (packet[p] << 8) | packet[p + 1];
      p += 2;
      client.id = new TextDecoder().decode(packet.slice(p, p + idLen));
      if (!client.id) client.id = `client-${Math.random().toString(36).slice(2, 8)}`;

      clients.set(client.id, client);
      sendToClient(client, encodeConnack());
      console.log(`[broker] Client connected: ${client.id}`);
      break;
    }

    case 3: { // PUBLISH
      const topicLen = (packet[pos] << 8) | packet[pos + 1];
      pos += 2;
      const topic = new TextDecoder().decode(packet.slice(pos, pos + topicLen));
      pos += topicLen;

      const qos = (packet[0] >> 1) & 0x03;
      if (qos > 0) pos += 2; // skip packet ID

      const payload = new TextDecoder().decode(packet.slice(pos, packetEnd));

      console.log(`[broker] Publish: ${topic} = ${payload}`);

      for (const [, c] of clients) {
        if (c.subscriptions.has(topic)) {
          sendToClient(c, encodePublish(topic, payload));
        }
      }
      break;
    }

    case 8: { // SUBSCRIBE
      const packetId = (packet[pos] << 8) | packet[pos + 1];
      pos += 2;

      while (pos < packetEnd) {
        const topicLen = (packet[pos] << 8) | packet[pos + 1];
        pos += 2;
        const topic = new TextDecoder().decode(packet.slice(pos, pos + topicLen));
        pos += topicLen;
        pos += 1; // requested QoS (we ignore)

        client.subscriptions.add(topic);
        console.log(`[broker] ${client.id} subscribed to: ${topic}`);
      }

      sendToClient(client, encodeSuback(packetId));
      break;
    }

    case 10: { // UNSUBSCRIBE
      const packetId = (packet[pos] << 8) | packet[pos + 1];
      pos += 2;

      while (pos < packetEnd) {
        const topicLen = (packet[pos] << 8) | packet[pos + 1];
        pos += 2;
        const topic = new TextDecoder().decode(packet.slice(pos, pos + topicLen));
        pos += topicLen;

        client.subscriptions.delete(topic);
        console.log(`[broker] ${client.id} unsubscribed from: ${topic}`);
      }

      sendToClient(client, encodeUnsuback(packetId));
      break;
    }

    case 12: // PINGREQ
      sendToClient(client, new Uint8Array([0xd0, 0x00]));
      break;

    case 14: // DISCONNECT
      console.log(`[broker] Client disconnected: ${client.id}`);
      removeClient(client.id);
      break;
  }
}

export function startBroker() {
  // TCP listener for local publishers (mock-publish.ts)
  Bun.listen({
    hostname: "0.0.0.0",
    port: 1883,
    socket: {
      data(socket, data) {
        const client = (socket as any).__client as ClientState;
        if (client) handlePacket(client, new Uint8Array(data));
      },
      open(socket) {
        const client: ClientState = {
          id: "",
          type: "tcp",
          buffer: new Uint8Array(0),
          subscriptions: new Set(),
          socket,
        };
        (socket as any).__client = client;
      },
      close(socket) {
        const client = (socket as any).__client as ClientState;
        if (client && client.id) removeClient(client.id);
      },
      error(socket, error) {
        console.error("[broker] TCP error:", error.message);
        const client = (socket as any).__client as ClientState;
        if (client && client.id) removeClient(client.id);
      },
    },
  });

  console.log("[broker] TCP   : mqtt://0.0.0.0:1883");

  // WebSocket listener for browser subscribers
  Bun.serve({
    hostname: "0.0.0.0",
    port: 9001,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("MQTT WebSocket broker", { status: 400 });
    },
    websocket: {
      message(ws, message) {
        const client = (ws as any).data as ClientState;
        if (client) handlePacket(client, new Uint8Array(message as ArrayBuffer));
      },
      open(ws) {
        const client: ClientState = {
          id: "",
          type: "ws",
          buffer: new Uint8Array(0),
          subscriptions: new Set(),
          socket: ws,
        };
        (ws as any).data = client;
      },
      close(ws) {
        const client = (ws as any).data as ClientState;
        if (client && client.id) removeClient(client.id);
      },
    },
  });

  console.log("[broker] WS    : ws://0.0.0.0:9001");
}
