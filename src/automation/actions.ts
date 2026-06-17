import type { ActionResult } from './types';

const HUE_BRIDGE_IP = () => process.env.HUE_BRIDGE_IP?.trim();
const HUE_API_KEY = () => process.env.HUE_API_KEY?.trim();

async function dispatchHue(action: Extract<ActionResult, { type: 'hue' }>): Promise<void> {
  const ip = HUE_BRIDGE_IP();
  const key = HUE_API_KEY();
  if (!ip || !key) {
    console.error(`⚠️  Hue action skipped: HUE_BRIDGE_IP or HUE_API_KEY not set`);
    return;
  }
  const url = `http://${ip}/api/${key}/lights/${action.lightId}/state`;
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action.state),
    });
    const data = await res.json();
    if (Array.isArray(data) && data[0]?.error) {
      console.error(`⚠️  Hue error (light ${action.lightId}): ${data[0].error.description}`);
    } else {
      console.log(`💡 Hue light ${action.lightId} → ${JSON.stringify(action.state)}`);
    }
  } catch {
    console.error(`⚠️  Hue bridge unreachable (light ${action.lightId})`);
  }
}

async function dispatchWebhook(action: Extract<ActionResult, { type: 'webhook' }>): Promise<void> {
  try {
    const res = await fetch(action.url, {
      method: action.method ?? 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: action.body != null ? JSON.stringify(action.body) : undefined,
    });
    console.log(`🔗 Webhook ${action.method ?? 'POST'} ${action.url} → HTTP ${res.status}`);
  } catch (err) {
    console.error(`⚠️  Webhook failed: ${action.url}`, err);
  }
}

function dispatchLog(action: Extract<ActionResult, { type: 'log' }>): void {
  console.log(`📝 ${action.message}`);
}

export async function dispatchAction(action: ActionResult): Promise<void> {
  if (!action) return;
  if (action.type === 'hue') await dispatchHue(action);
  else if (action.type === 'webhook') await dispatchWebhook(action);
  else if (action.type === 'log') dispatchLog(action);
}

export async function dispatchActions(results: ActionResult | ActionResult[] | null): Promise<void> {
  if (!results) return;
  const actions = Array.isArray(results) ? results : [results];
  for (const action of actions) {
    await dispatchAction(action);
  }
}
