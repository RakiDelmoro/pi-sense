import { startMqttClient } from '../mqtt/mqtt';
import { startIngest } from './ingest';
import { loadSensorTopics } from '../mqtt/sensor-topics';

// Sanitize env vars — Windows CRLF .env files and Docker env_file can inject trailing whitespace
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed !== v) process.env[k] = trimmed;
  }
}

const INFLUX_TOKEN = process.env.INFLUX_TOKEN?.trim();
if (!INFLUX_TOKEN) {
  console.error('Missing required env var: INFLUX_TOKEN must be set');
  process.exit(1);
}

// Load per-topic ingest metadata, then connect + start ingesting.
await loadSensorTopics();
startMqttClient();
startIngest();

console.log('🔌 Pi Sense adapter running');
