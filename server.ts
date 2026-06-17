import {
  queryLatest,
  queryHistory,
  deleteInfluxData,
  blockedTopics,
  isValidTopic,
  getInfluxBucket,
} from './src/server/services/influx';
import {
  wsClients,
  subscribeWs,
  unsubscribeWs,
  removeWs,
} from './src/server/services/websocket';
import {
  loadOrBuildApp,
  startWatching,
  cachedJS,
  cachedCSS,
} from './src/server/services/builder';
import { startMqttBridge } from './src/server/bridge/mqtt';
import { hueFetch } from './src/server/services/hue';
import { initSenseCapHandler } from './src/server/sensecap/handler';
import { getAutomations, setAutomationEnabled } from './src/server/services/automations';
import { startMqttBridge } from './src/server/bridge/mqtt';
import { hueFetch } from './src/server/services/hue';
import { initSenseCapHandler } from './src/server/sensecap/handler';

// Sanitize env vars — Windows CRLF .env files and Docker env_file can inject trailing whitespace
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed !== v) process.env[k] = trimmed;
  }
}

const HUE_BRIDGE_IP = process.env.HUE_BRIDGE_IP;
const HUE_API_KEY = process.env.HUE_API_KEY;

if (!HUE_BRIDGE_IP || !HUE_API_KEY) {
  console.error('Missing required env vars: HUE_BRIDGE_IP and HUE_API_KEY must be set (e.g. in .env)');
  process.exit(1);
}

const PORT = parseInt(process.env.PORT || '3141');
const ROOT = import.meta.dir;

function join(...parts: string[]) {
  return parts.join('/').replace(/\/+/g, '/');
}

// Ensure build/pre-build load and starting services
await loadOrBuildApp();
startWatching();
startMqttBridge();
initSenseCapHandler();

// HTTP + WebSocket interface coordinator
const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // WebSocket upgrade support
    if (pathname === '/ws') {
      if (server.upgrade(req)) return;
      return new Response('WebSocket upgrade failed', { status: 500 });
    }

    // Hue: list all lights
    if (pathname === '/api/hue/lights') {
      return hueFetch('/lights');
    }

    // Hue: set light state
    const lightStateMatch = pathname.match(/^\/api\/hue\/lights\/([\d]+)\/state$/);
    if (req.method === 'PUT' && lightStateMatch) {
      const id = lightStateMatch[1];
      const body = await req.text();
      return hueFetch(`/lights/${id}/state`, {
        method: 'PUT',
        body,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Scenes: apply via server so both Hue and SenseCap state stay in sync
    const sceneMatch = pathname.match(/^\/api\/scene\/(bright|relax)$/);
    if (req.method === 'POST' && sceneMatch) {
      const { applyScene } = await import('./src/server/services/scenes');
      try {
        const result = await applyScene(sceneMatch[1] as 'bright' | 'relax');
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err?.message ?? 'scene failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Automations: list
    if (pathname === '/api/automations') {
      try {
        const automations = await getAutomations();
        return new Response(JSON.stringify(automations), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err?.message ?? 'failed to list automations' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Automations: toggle enabled
    const automationToggleMatch = pathname.match(/^\/api\/automations\/([^/]+)\/toggle$/);
    if (req.method === 'POST' && automationToggleMatch) {
      const slug = automationToggleMatch[1];
      try {
        const body = await req.json().catch(() => ({}));
        const enabled = body?.enabled === true ? true : body?.enabled === false ? false : undefined;
        if (enabled === undefined) {
          return new Response(JSON.stringify({ error: 'enabled must be true or false' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        await setAutomationEnabled(slug, enabled);
        return new Response(JSON.stringify({ slug, enabled }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err?.message ?? 'failed to toggle automation' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // API: latest value for a topic
    if (pathname === '/api/latest') {
      const topic = url.searchParams.get('topic') || '';
      if (!topic) {
        return new Response(JSON.stringify({ error: 'topic is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return queryLatest(topic).then(data =>
        new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json' },
        })
      ).catch(() =>
        new Response(JSON.stringify(null), {
          headers: { 'Content-Type': 'application/json' },
        })
      );
    }

    // API: historical data
    if (pathname === '/api/history') {
      const topic = url.searchParams.get('topic') || '';
      const limit = parseInt(url.searchParams.get('limit') || '8640', 10);
      const range = url.searchParams.get('range') || '24h';
      const startIso = url.searchParams.get('start') || undefined;
      const stopIso = url.searchParams.get('stop') || undefined;
      if (!topic) {
        return new Response(JSON.stringify({ error: 'topic is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return queryHistory(topic, limit, range, startIso, stopIso).then(data =>
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

    // API: clear sensor data from InfluxDB
    if (req.method === 'POST' && pathname === '/api/sensor-data/clear') {
      const topic = url.searchParams.get('topic') || '';
      if (!topic || !isValidTopic(topic)) {
        return new Response(JSON.stringify({ error: 'valid topic is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return deleteInfluxData(topic).then(deleted => {
        if (!deleted) {
          return new Response(JSON.stringify({ error: 'failed to clear InfluxDB data' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(null, { status: 204 });
      });
    }

    // API: delete and block a topic permanently
    if (req.method === 'DELETE' && pathname === '/api/sensor-data') {
      const topic = url.searchParams.get('topic') || '';
      if (!topic || !isValidTopic(topic)) {
        return new Response(JSON.stringify({ error: 'valid topic is required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return deleteInfluxData(topic).then(deleted => {
        if (!deleted) {
          return new Response(JSON.stringify({ error: 'failed to delete InfluxDB data' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        blockedTopics.add(topic);

        const subs = wsClients; // Send to active clients that need cleanup
        for (const ws of subs) {
          ws.send(JSON.stringify({ topic, deleted: true }));
        }

        return new Response(null, { status: 204 });
      });
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

    // Serve static files secure-guarded
    if (pathname.startsWith('/public/')) {
      const resolved = new URL(pathname, 'http://localhost').pathname;
      if (resolved.includes('..')) {
        return new Response('Forbidden', { status: 403 });
      }
      const filePath = join(ROOT, resolved.replace(/^\//, ''));
      if (!filePath.startsWith(join(ROOT, 'public'))) {
        return new Response('Forbidden', { status: 403 });
      }
      return new Response(Bun.file(filePath));
    }

    return new Response('Not Found', { status: 404 });
  },
  websocket: {
    maxPayloadLength: 16 * 1024,
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
      } catch { /* skip */ }
    },
    close(ws) {
      removeWs(ws);
    },
  },
});

console.log(`🔥 Pi Sense server → http://localhost:${PORT}`);
console.log(`   WebSocket endpoint → ws://localhost:${PORT}/ws`);
console.log(`   InfluxDB bucket → ${getInfluxBucket()}`);
