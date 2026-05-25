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

// ── InfluxDB client ──────────────────────────────────────────────
const influx = new InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
const queryApi = influx.getQueryApi(INFLUX_ORG);
const writeApi = influx.getWriteApi(INFLUX_ORG, INFLUX_BUCKET, 'ms');

// ── WebSocket clients ────────────────────────────────────────────
const wsClients = new Set<ServerWebSocket>();
const topicSubs = new Map<string, Set<ServerWebSocket>>(); // topic → set of ws

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
export function broadcastUpdate(topic: string, value: number, timestamp: string) {
  const msg = JSON.stringify({ topic, value, timestamp });
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

/** Validate time range — only digits + unit (m/h/d) */
function isValidRange(range: string): boolean {
  return /^\d+[mhd]$/.test(range);
}

// ── InfluxDB queries ─────────────────────────────────────────────

/** Query the latest value for a topic from InfluxDB */
async function queryLatest(topic: string): Promise<{ value: number; timestamp: string } | null> {
  if (!isValidTopic(topic)) {
    console.error(`Invalid topic rejected: ${topic}`);
    return null;
  }
  const flux = `
    from(bucket: "${INFLUX_BUCKET}")
      |> range(start: -1h)
      |> filter(fn: (r) => r._measurement == "sensor" and r.topic == "${topic}")
      |> last()
  `;
  try {
    const rows = await queryApi.collectRows(flux, (row: any, tableMeta: any) => {
      const o = tableMeta.toObject(row);
      return { value: Number(o._value), timestamp: o._time };
    });
    if (rows.length > 0) return rows[0];
  } catch (err) {
    console.error('InfluxDB query error (latest):', err);
  }
  return null;
}

/** Query historical values for a topic */
async function queryHistory(topic: string, range: string): Promise<{ value: number; timestamp: string }[]> {
  if (!isValidTopic(topic)) {
    console.error(`Invalid topic rejected: ${topic}`);
    return [];
  }
  if (!isValidRange(range)) {
    console.error(`Invalid range rejected: ${range}`);
    return [];
  }
  const flux = `
    from(bucket: "${INFLUX_BUCKET}")
      |> range(start: -${range})
      |> filter(fn: (r) => r._measurement == "sensor" and r.topic == "${topic}")
  `;
  try {
    const rows = await queryApi.collectRows(flux, (row: any, tableMeta: any) => {
      const o = tableMeta.toObject(row);
      return { value: Number(o._value), timestamp: o._time };
    });
    return rows;
  } catch (err) {
    console.error('InfluxDB query error (history):', err);
    return [];
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

  for (const entry of entries) {
    const slug = entry.match(/sensors\/([^/]+)\/sensor\.tsx/)?.[1];
    if (!slug) continue;
    // Validate slug: only lowercase alphanumeric and hyphens
    if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
      console.error(`Invalid sensor slug skipped: ${slug} (must be lowercase alphanumeric + hyphens)`);
      continue;
    }
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

    // API: historical data
    if (pathname === '/api/history') {
      const topic = url.searchParams.get('topic') || '';
      const range = url.searchParams.get('range') || '1h';
      if (!topic) {
        return new Response(JSON.stringify({ error: 'topic is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return queryHistory(topic, range).then(data =>
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
  const raw = payload.toString();
  let value: number;
  let timestamp: string;

  try {
    const data = JSON.parse(raw);
    value = Number(data.value ?? data);
    if (isNaN(value)) return;
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
    .floatField('value', value)
    .timestamp(new Date(timestamp));
  writeApi.writePoint(point);

  // ② Flush, then query InfluxDB and broadcast to browsers — all in-process
  writeApi.flush().then(async () => {
    const latest = await queryLatest(topic);
    if (latest) {
      broadcastUpdate(topic, latest.value, latest.timestamp);
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
