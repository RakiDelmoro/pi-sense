import type { AutomationConfig } from '../../automation/types';
import { publish } from '../bridge/mqtt';

const CONTROL_TOPIC_PREFIX = 'automations';

interface AutomationMeta extends AutomationConfig {
  // always present normalized type
}

function configPath(slug: string): string {
  return `${import.meta.dir}/../../../automations/${slug}/config.ts`;
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

  return {
    slug,
    label,
    topic,
    valueKey,
    enabled: enabled ?? true,
    description,
  };
}

// Discover all automations by scanning `automations/*/config.ts`.
export async function getAutomations(): Promise<AutomationMeta[]> {
  const pattern = 'automations/*/config.ts';
  const glob = new Bun.Glob(pattern);
  const entries = [...glob.scanSync({ cwd: import.meta.dir + '/../../..' })].sort();

  const results: AutomationMeta[] = [];
  for (const entry of entries) {
    const slug = entry.match(/automations\/([^/]+)\/config\.ts/)?.[1];
    if (!slug) continue;
    const config = await parseConfig(slug);
    if (config) results.push(config);
  }
  return results;
}

/** Toggle an automation's enabled state and notify the automation service. */
export async function setAutomationEnabled(slug: string, enabled: boolean): Promise<void> {
  const path = configPath(slug);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Automation "${slug}" not found`);
  }

  const text = await file.text();
  if (!/enabled:\s*(true|false)/m.test(text)) {
    throw new Error(`Automation config for "${slug}" is missing an enabled field`);
  }

  const updated = text.replace(/enabled:\s*(true|false)/m, `enabled: ${enabled}`);
  await Bun.write(path, updated);

  publish(`${CONTROL_TOPIC_PREFIX}/${slug}/enabled`, JSON.stringify({ enabled }), {
    qos: 1,
    retain: false,
  });
}
