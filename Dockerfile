# ── Stage 1: Build ──────────────────────────────────────────────
FROM oven/bun:1.3 AS build

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source and sensor definitions
COPY src/ src/
COPY sensors/ sensors/
COPY server.ts index.html tsconfig.json ./

# Generate sensor registry and build frontend bundle
RUN bun run -e " \
  const ROOT = '/app'; \
  const glob = new Bun.Glob('sensors/*/sensor.tsx'); \
  const entries = [...glob.scanSync({ cwd: ROOT })]; \
  const imports = []; \
  const items = []; \
  for (const entry of entries) { \
    const slug = entry.match(/sensors\\/([^/]+)\\/sensor\\.tsx/)?.[1]; \
    if (!slug) continue; \
    const varName = slug.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); \
    imports.push('import ' + varName + \" from '../\" + entry.replace(/\\.tsx$/, '') + \"';\"); \
    items.push(\"  { slug: '\" + slug + \"', Component: \" + varName + ' },'); \
  } \
  const content = '// Auto-generated — do not edit\\n' + \
    imports.join('\\n') + '\\n\\n' + \
    'import type { FunctionalComponent } from \"preact\";\\n\\n' + \
    'export interface SensorEntry { slug: string; Component: FunctionalComponent; }\\n\\n' + \
    'const sensorRegistry: SensorEntry[] = [\\n' + items.join('\\n') + '\\n];\\n\\nexport default sensorRegistry;\\n'; \
  await Bun.write(ROOT + '/src/sensor-registry.ts', content); \
  console.log('Generated registry: ' + entries.length + ' sensor(s)'); \
"

RUN bun build src/index.tsx --outdir /app/dist --target browser

# ── Stage 2: Run ───────────────────────────────────────────────
FROM oven/bun:1.3-slim

WORKDIR /app

# Install only production dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy server, static assets, and sensor configs (needed at runtime for MQTT valueKey lookup)
COPY server.ts index.html ./
COPY --from=build /app/dist/ /app/dist/
COPY sensors/ sensors/
COPY public/ public/

# Run as non-root user for security
RUN groupadd -r app && useradd -r -g app app
USER app

# InfluxDB config (overridable at runtime)
ENV PORT=3141
ENV INFLUX_URL=http://influxdb:8086
ENV INFLUX_TOKEN=""
ENV INFLUX_ORG=pi-sense
ENV INFLUX_BUCKET=pi-sense
ENV MQTT_URL=mqtt://mosquitto:1883
ENV MQTT_TOPIC_PREFIX=pi-sensors/#

EXPOSE 3141

CMD ["bun", "server.ts"]
