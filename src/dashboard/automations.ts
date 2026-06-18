import type { AutomationConfig } from '../automation/types';
import { publish } from '../mqtt/mqtt';
import { getAutomationEnabled, setAutomationEnabledState } from './automation-state';

interface AutomationMeta extends AutomationConfig {
  // always present normalized type
}

function configPath(slug: string): string {
  return `${import.meta.dir}/../../automations/${slug}/config.ts`;
}

function extractField(text: string, field: string): string | undefined {
  const re = new RegExp(`${field}:\\s*['"]([^'"]*)['"]`, 'm');
  const m = text.match(re);
  return m ? m[1] : undefined;
}

function extractBoolField(text: string, field: string): boolean | undefined {
  const re = new RegExp(`${field}:\\s*(true|false)`, 'm');
  const m = text.match(re);
  return m ? m[1] === 'true' : undefined;
}

async function parseConfig(slug: string): Promise<AutomationMeta | null> {
  const path = configPath(slug);
  const file = Bun.file(path);
  if (!(await file.exists())) return null;

  const text = await file.text();
  const label = extractField(text, 'label');
  const topic = extractField(text, 'topic');
  if (!label || !topic) return null;

  const valueKey = extractField(text, 'valueKey');
  const description = extractField(text, 'description');
  const enabled = extractBoolField(text, 'enabled');

  const runtimeEnabled = getAutomationEnabled(slug);

  return {
    slug,
    label,
    topic,
    valueKey,
    enabled: runtimeEnabled ?? enabled ?? true,
    description,
  };
}

// Discover all automations by scanning `automations/*/config.ts`.
export async function getAutomations(): Promise<AutomationMeta[]> {
  const pattern = 'automations/*/config.ts';
  const glob = new Bun.Glob(pattern);
  const entries = [...glob.scanSync({ cwd: import.meta.dir + '/../..' })].sort();

  const results: AutomationMeta[] = [];
  for (const entry of entries) {
    const slug = entry.match(/automations\/([^/]+)\/config\.ts/)?.[1];
    if (!slug) continue;
    const config = await parseConfig(slug);
    if (config) results.push(config);
  }
  return results;
}

const controlTopic = (slug: string): string => `automations/${slug}/enabled`;

/** Toggle an automation's enabled state via a retained MQTT control message. */
export async function setAutomationEnabled(slug: string, enabled: boolean): Promise<void> {
  publish(controlTopic(slug), JSON.stringify({ enabled }), {
    qos: 1,
    retain: true,
  });
  // Optimistically update local state so the dashboard UI reflects immediately.
  setAutomationEnabledState(slug, enabled);
}
