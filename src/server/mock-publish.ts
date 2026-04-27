const MQTT_BROKER = process.env.MQTT_BROKER || "localhost";
const MQTT_PORT = Number(process.env.MQTT_PORT) || 1883;

function parseArgs() {
  const args = process.argv.slice(2);
  const result: { topic?: string; payload?: string; count: number } = { count: 1 };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--topic":
      case "-t":
        result.topic = args[++i];
        break;
      case "--payload":
      case "-p":
        result.payload = args[++i];
        break;
      case "--count":
      case "-c":
        result.count = Math.max(1, parseInt(args[++i], 10) || 1);
        break;
    }
  }

  return result;
}

function encodeMqttConnect(): Uint8Array {
  const clientId = "pi-sense-mock-" + Math.random().toString(36).slice(2, 8);
  const idBytes = new TextEncoder().encode(clientId);
  const idLen = idBytes.length;

  const protocolName = new TextEncoder().encode("MQTT");
  const variable = new Uint8Array(2 + protocolName.length + 1 + 1 + 2 + 2 + idLen);
  let i = 0;
  variable[i++] = 0;
  variable[i++] = protocolName.length;
  variable.set(protocolName, i);
  i += protocolName.length;
  variable[i++] = 0x04;
  variable[i++] = 0x02;
  variable[i++] = 0;
  variable[i++] = 60;
  variable[i++] = (idLen >> 8) & 0xff;
  variable[i++] = idLen & 0xff;
  variable.set(idBytes, i);

  const remainingLen = variable.length;
  const packet = new Uint8Array(1 + (remainingLen < 128 ? 1 : 2) + remainingLen);
  packet[0] = 0x10;
  packet[1] = remainingLen;
  packet.set(variable, 2);

  return packet;
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

function encodeMqttPublish(topic: string, payload: string): Uint8Array {
  const topicBytes = new TextEncoder().encode(topic);
  const payloadBytes = new TextEncoder().encode(payload);
  const topicLen = topicBytes.length;
  const payloadLen = payloadBytes.length;

  const variableLen = 2 + topicLen + payloadLen;
  const remainingLenBytes = encodeVariableLength(variableLen);

  const packet = new Uint8Array(1 + remainingLenBytes.length + variableLen);
  let i = 0;
  packet[i++] = 0x30;
  for (const b of remainingLenBytes) packet[i++] = b;
  packet[i++] = (topicLen >> 8) & 0xff;
  packet[i++] = topicLen & 0xff;
  packet.set(topicBytes, i);
  i += topicLen;
  packet.set(payloadBytes, i);

  return packet;
}

function encodeMqttDisconnect(): Uint8Array {
  return new Uint8Array([0xe0, 0x00]);
}

async function publish() {
  const args = parseArgs();

  if (!args.topic) {
    console.error("Usage: bun run src/server/mock-publish.ts --topic <topic> [--payload <payload>] [--count <n>]");
    console.error("  --topic, -t    MQTT topic (required)");
    console.error("  --payload, -p  Payload string (default: random 0-100)");
    console.error("  --count, -c    How many times to publish (default: 1)");
    process.exit(1);
  }

  console.log(`[mock] Connecting to ${MQTT_BROKER}:${MQTT_PORT}...`);

  const socket = await Bun.connect({
    hostname: MQTT_BROKER,
    port: MQTT_PORT,
    socket: {
      data(_socket, data) {
        const bytes = new Uint8Array(data);
        if (bytes.length >= 2 && bytes[0] === 0x20 && bytes[1] === 0x02) {
          console.log("[mock] Connected to broker");
        }
      },
      open(socket) {
        socket.write(encodeMqttConnect());

        for (let n = 0; n < args.count; n++) {
          const payload = args.payload ?? String(Math.floor(Math.random() * 101));
          socket.write(encodeMqttPublish(args.topic, payload));
          console.log(`[mock] Published: ${payload} → ${args.topic}`);
        }

        socket.write(encodeMqttDisconnect());
        socket.end();
      },
      close() {
        console.log("[mock] Disconnected");
        process.exit(0);
      },
      error(_socket, err) {
        console.error("[mock] Error:", err.message);
        process.exit(1);
      },
    },
  });

  await new Promise(() => {});
}

publish();
