import mqtt from 'mqtt';
import type { AutomationRule, AutomationContext } from './types';
import { dispatchActions } from './actions';
import { queryLatest } from '../influx/influx';

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

export async function setAutomationEnabled(slug: string, enabled: boolean): Promise<void> {
  if (!loadedRules.some(r => r.slug === slug)) {
    throw new Error(`Automation "${slug}" not found`);
  }
  enabledRules.set(slug, enabled);
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

  // Build topic → rules index. Rules react to DB-update notifications for
  // their topic, not to raw MQTT payloads — the DB is the only source of truth.
  const topicRules = new Map<string, LoadedRule[]>();
  for (const rule of loadedRules) {
    const existing = topicRules.get(rule.topic) ?? [];
    existing.push(rule);
    topicRules.set(rule.topic, existing);
  }

  const controlTopic = 'automations/+/enabled';
  const updatePrefix = 'pi-sense/updates/';

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
    const topics = ['pi-sense/updates/#', controlTopic];
    mqttClient.subscribe(topics, (err) => {
      if (err) {
        console.error('MQTT subscribe error:', err);
      } else {
        console.log(`📡 Automation subscribed to: ${topics.join(', ')}`);
      }
    });
  });

  mqttClient.on('message', async (topic, payload) => {
    // Control messages from the dashboard toggling enable/disable
    const controlMatch = topic.match(/^automations\/([^/]+)\/enabled$/);
    if (controlMatch) {
      const slug = controlMatch[1];
      try {
        const data = JSON.parse(payload.toString());
        if (typeof data.enabled === 'boolean') {
          enabledRules.set(slug, data.enabled);
          console.log(`🔧 Automation "${slug}" ${data.enabled ? 'enabled' : 'disabled'}`);
        }
      } catch { /* ignore invalid control payloads */ }
      return;
    }

    // DB-update notification: requery InfluxDB for the authoritative value.
    if (!topic.startsWith(updatePrefix)) return;
    const sensorTopic = topic.slice(updatePrefix.length);
    const matchingRules = topicRules.get(sensorTopic);
    if (!matchingRules) return;

    const latest = await queryLatest(sensorTopic);
    if (!latest) return;

    const ctx: AutomationContext = {
      value: latest.value,
      topic: sensorTopic,
      raw: String(latest.value),
      timestamp: latest.timestamp,
    };

    for (const rule of matchingRules) {
      if (enabledRules.get(rule.slug) === false) continue;
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
