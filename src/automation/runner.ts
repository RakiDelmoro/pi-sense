import mqtt from 'mqtt';
import type { AutomationRule, AutomationContext } from './types';
import { dispatchActions } from './actions';

/** Quote unquoted JSON keys so `{water_level: 42}` → `{"water_level": 42}` */
function quoteJsonKeys(raw: string): string {
  return raw.replace(/([,{\s])([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');
}

interface LoadedRule {
  module: AutomationRule;
  topic: string;
  path: string;
  slug: string;
}

const loadedRules: LoadedRule[] = [];
const enabledRules = new Map<string, boolean>();

export function getAutomations() {
  return loadedRules.map(r => ({
    slug: r.slug,
    label: r.module.label,
    topic: r.module.topic,
    description: r.module.description,
    valueKey: r.module.valueKey,
    enabled: enabledRules.get(r.slug) ?? r.module.enabled ?? true,
  }));
}

function configPath(slug: string): string {
  return `${import.meta.dir}/../../automations/${slug}/config.ts`;
}

async function writeEnabledToConfig(slug: string, enabled: boolean): Promise<void> {
  const path = configPath(slug);
  const file = Bun.file(path);
  const text = await file.text();
  const updated = text.replace(
    /enabled:\s*(true|false)/,
    `enabled: ${enabled}`,
  );
  await Bun.write(path, updated);
}

export async function setAutomationEnabled(slug: string, enabled: boolean): Promise<void> {
  if (!loadedRules.some(r => r.slug === slug)) {
    throw new Error(`Automation "${slug}" not found`);
  }
  enabledRules.set(slug, enabled);
  await writeEnabledToConfig(slug, enabled);
}

export async function startAutomationRunner() {
  // Discover rules
  const glob = new Bun.Glob('automations/*/rule.ts');
  const entries = [...glob.scanSync({ cwd: import.meta.dir + '/../..' })].sort();

  for (const entry of entries) {
    const slug = entry.match(/automations\/([^/]+)\/rule\.ts/)?.[1];
    if (!slug) continue;

    try {
      const mod = await import('../../' + entry);
      const rule: AutomationRule = mod.default ?? mod;
      if (!rule.evaluate || !rule.topic) {
        console.warn(`⚠️  Skipping automation "${slug}": missing evaluate() or topic`);
        continue;
      }
      loadedRules.push({ module: rule, topic: rule.topic, path: entry, slug });
      enabledRules.set(slug, rule.enabled ?? true);
      if (rule.enabled === false) {
        console.log(`⏸️  Automation loaded but disabled: ${rule.label} (${slug})`);
      } else {
        console.log(`✅ Loaded automation: ${rule.label} (${slug}) → ${rule.topic}`);
      }
    } catch (err) {
      console.error(`❌ Failed to load automation "${slug}":`, err);
    }
  }

  if (loadedRules.length === 0) {
    console.log('📡 No automation rules found');
    return;
  }

  const activeRules = loadedRules.filter(r => enabledRules.get(r.slug) !== false);

  if (activeRules.length === 0) {
    console.log('📡 No active automation rules');
  }

  // Build topic → rules index (include all topics so enabling at runtime works)
  const topicRules = new Map<string, LoadedRule[]>();
  for (const rule of loadedRules) {
    const existing = topicRules.get(rule.topic) ?? [];
    existing.push(rule);
    topicRules.set(rule.topic, existing);
  }

  const controlTopic = 'automations/+/enabled';

  // Connect to MQTT
  const mqttUrl = (process.env.MQTT_URL || 'mqtt://localhost:1883').trim();
  const mqttUsername = process.env.MQTT_USERNAME?.trim() || undefined;
  const mqttPassword = process.env.MQTT_PASSWORD?.trim() || undefined;

  const mqttClient = mqtt.connect(mqttUrl, {
    username: mqttUsername,
    password: mqttPassword,
  });

  mqttClient.on('connect', () => {
    console.log(`📡 Automation MQTT connected: ${mqttUrl}`);
    const topics = [...topicRules.keys(), controlTopic];
    mqttClient.subscribe(topics, (err) => {
      if (err) {
        console.error('MQTT subscribe error:', err);
      } else {
        console.log(`📡 Automation subscribed to: ${topics.join(', ')}`);
      }
    });
  });

  mqttClient.on('message', (topic, payload) => {
    const raw = payload.toString();

    // Control messages from the dashboard toggling enable/disable
    const controlMatch = topic.match(/^automations\/([^/]+)\/enabled$/);
    if (controlMatch) {
      const slug = controlMatch[1];
      try {
        const data = JSON.parse(raw);
        if (typeof data.enabled === 'boolean') {
          enabledRules.set(slug, data.enabled);
          console.log(`🔧 Automation "${slug}" ${data.enabled ? 'enabled' : 'disabled'}`);
        }
      } catch { /* ignore invalid control payloads */ }
      return;
    }

    const matchingRules = topicRules.get(topic);
    if (!matchingRules) return;

    for (const rule of matchingRules) {
      if (enabledRules.get(rule.slug) === false) continue;

      let value: number;
      let timestamp: string;

      try {
        const data = JSON.parse(raw) || JSON.parse(quoteJsonKeys(raw));
        const key = rule.module.valueKey ?? 'value';
        value = Number(data[key] ?? data.value ?? data);
        if (isNaN(value)) continue;
        timestamp = (data.timestamp && !isNaN(Date.parse(data.timestamp)))
          ? data.timestamp
          : new Date().toISOString();
      } catch {
        value = Number(raw);
        if (isNaN(value)) continue;
        timestamp = new Date().toISOString();
      }

      const ctx: AutomationContext = { value, topic, raw, timestamp };

      try {
        const results = rule.module.evaluate(ctx);
        dispatchActions(results);
      } catch (err) {
        console.error(`❌ Automation "${rule.module.label}" error:`, err);
      }
    }
  });

  mqttClient.on('error', (err) => {
    console.error('MQTT connection error:', err);
  });

  mqttClient.on('close', () => {
    console.log('MQTT connection closed — will auto-reconnect');
  });
}
