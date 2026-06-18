// Per-topic ingest metadata, derived from sensors/*/config.ts.
// Shared shape: the ADAPTER uses topicValueKeys to parse payloads before
// writing to InfluxDB; the DASHBOARD uses topicTimeOffsetKeys to shape its
// queries (pivot for the time_offset_ms field). Each process loads its own
// copy at startup — they are read-only views over the same config files.

const ROOT = import.meta.dir + '/../..';

function join(...parts: string[]) {
  return parts.join('/').replace(/\/+/g, '/');
}

export const topicValueKeys = new Map<string, string>();
export const topicTimeOffsetKeys = new Map<string, string>();

/** Scan sensors/<slug>/config.ts and populate the per-topic metadata maps. */
export async function loadSensorTopics() {
  const glob = new Bun.Glob('sensors/*/config.ts');
  const entries = [...glob.scanSync({ cwd: ROOT })].sort();

  topicValueKeys.clear();
  topicTimeOffsetKeys.clear();

  for (const entry of entries) {
    const slug = entry.match(/sensors\/([^/]+)\/config\.ts/)?.[1];
    if (!slug) continue;
    try {
      const configContent = await Bun.file(join(ROOT, 'sensors', slug, 'config.ts')).text();
      const topicMatch = configContent.match(/topic:\s*['"]([^'"]+)['"]/);
      if (!topicMatch) continue;
      const topic = topicMatch[1];
      const valueKeyMatch = configContent.match(/valueKey:\s*['"]([^'"]+)['"]/);
      if (valueKeyMatch) topicValueKeys.set(topic, valueKeyMatch[1]);
      const timeOffsetKeyMatch = configContent.match(/timeOffsetKey:\s*['"]([^'"]+)['"]/);
      if (timeOffsetKeyMatch) topicTimeOffsetKeys.set(topic, timeOffsetKeyMatch[1]);
    } catch { /* ignore invalid config */ }
  }

  console.log(`Loaded ${topicValueKeys.size} sensor topic(s) from ${entries.length} config(s)`);
}
