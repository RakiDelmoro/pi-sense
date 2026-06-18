---
name: sensor-generator
description: Manage sensor dashboard cards for Pi Sense. Use when the user asks to add, modify, or remove any sensor visualization from the dashboard. Creates Preact TSX + CSS in sensors/<slug>/ — cards are auto-discovered, no manual wiring needed.
---

# Sensor Generator

Manage sensor cards for the Pi Sense dashboard. The user describes what they want; you build it with Preact and Chart.js.

## Layout Ordering

The dashboard orders sensor cards based on the optional `layoutWeight` property in `config.ts`.
- Lower numbers render first (left-to-right, top-to-bottom).
- Use weights in increments of 10 (`10`, `20`, `30`...) to allow inserting other cards easily in-between later.
- If no weight is specified, cards will fall back to a weight of `999` (bottom of the page).

Default suggested layouts:
- **Main gauges / indicators:** `layoutWeight: 10`, `20`, etc. (will snap side-by-side using 6 columns unless `--wide`)
- **Main charts / graphs:** `layoutWeight: 30`, `40`, etc. (using `.sensor-card--wide` to span the full screen)

## When to use

Any time the user mentions a sensor card — adding, changing, or removing one.

Examples of what a user might say:

- "Create a humidity card listening to topic `humidity`"
- "Show wind direction as a compass arrow for topic `wind/dir`"
- "Add a card with a colored ring — green if > 70, yellow if > 30, red otherwise — for topic `battery-level`"
- "Make a 7-segment LED display for topic `power/readout`"
- "Change the Water Tank card to show a vertical fill bar instead"
- "Update the battery-level card to blink when below 20"
- "Rename Water Tank to Main Tank and change topic to `main-tank`"
- "Change the temperature card max to 150"
- "Delete the Water Tank card"
- "Remove the humidity card"

The user can describe any visual. You build it with Preact, SVG, CSS, and Chart.js — whatever it takes.

## Auto-discovery

**Sensor cards are automatically discovered.** The server scans `sensors/*/sensor.tsx` at build time and generates a registry — no manual wiring in `app.tsx` or anywhere else. Creating or deleting sensor files is all you need to do. The dashboard will pick them up after the next page refresh.

## MQTT topic convention

The adapter subscribes to exactly the topics declared in `sensors/*/config.ts` — there is no enforced prefix. A sensor's `topic` is what the adapter listens to and what the dashboard/automation react to via `pi-sense/updates/<topic>`.

Existing sensors use the `esp/` prefix (e.g. `esp/water-level`, `esp/water-flow`). When creating a new sensor, match the topic your device actually publishes to.

> **Note:** An earlier version of this doc prescribed a `sensors/` prefix. That is not enforced by the code. If you want to standardize on a prefix, decide and migrate existing configs — for now, use whatever topic the device publishes.

## Modes

Infer the mode from the user's prompt:

| Trigger words | Mode |
|---|---|
| create, add, make, show, new, put, build | **Create** |
| change, update, modify, rename, fix, adjust, tweak, replace, redo | **Modify** |
| delete, remove, get rid of, drop, trash | **Delete** |

### Create mode

Generate a new sensor card from scratch.

1. Extract label, topic, visual description, unit, range, decimals, valueKey from the prompt
2. If the user doesn't specify the MQTT topic, **always ask** — the topic is required and cannot be guessed
3. If the user doesn't describe the visual clearly, ask them what they want it to look like
3. Generate the slug from the label (lowercase, hyphens, no special chars). If `sensors/<slug>/` exists, append a number
4. Create `sensors/<slug>/config.ts`, `sensor.tsx`, `sensor.css`
5. Verify — no other files need to be touched (auto-discovery handles the rest)

### Modify mode

Full control over an existing sensor. Pi can rewrite any or all of the 3 files.

1. Identify which sensor the user is referring to (by label, slug, or topic)
2. If unclear which sensor, ask the user to clarify
3. Read the existing files in `sensors/<slug>/` to understand what's there
4. Apply the user's requested changes — this may touch any combination of files:
   - Config change (label, topic, range, etc.) → rewrite `config.ts`
   - Visual change → rewrite `sensor.tsx` and/or `sensor.css`
   - Rename (label/topic change) → if the slug changes, this becomes a delete + create: remove the old `sensors/<old-slug>/`, create new `sensors/<new-slug>/`
5. Verify — no other files need to be touched

### Delete mode

Remove a sensor completely — code and database data. **Always ask for confirmation before deleting.**

1. Identify which sensor the user wants to delete
2. Use `ask_user_question` to confirm: *"Delete the card? This will remove the sensor code and all InfluxDB data for topic `'<topic>'`."*
3. If confirmed:
   - Remove `sensors/<slug>/` folder
   - Delete all InfluxDB data for that topic via the server API (server must be running):
     ```bash
     STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:3141/api/sensor-data?topic=<topic>")
     if [ "$STATUS" != "204" ]; then echo "FAIL: InfluxDB data not deleted (HTTP $STATUS)"; fi
     ```
     This also blocks the topic so the adapter stops ingesting new data for it.
4. Verify — no other files need to be touched (auto-discovery will stop including the deleted sensor)

## Data flow

The dashboard never touches MQTT directly. All data comes from InfluxDB via `server.ts`.

```
Sensor → MQTT Broker → Adapter (parses, writes InfluxDB, flushes)
                                       │
                                       └── publishes pi-sense/updates/<topic> (bare notification)
                                                  │
                                       Dashboard (server.ts) receives notification
                                                  │
                                       server.ts queries InfluxDB for latest value
                                                  │
                                       WebSocket push to browser
```

- The **adapter** subscribes to MQTT, parses payloads, writes data to InfluxDB, flushes, then publishes a bare `pi-sense/updates/<topic>` notification (no value — the DB is the only source of truth)
- `server.ts` (the dashboard) subscribes to `pi-sense/updates/#`. On each notification it queries InfluxDB for the confirmed value and pushes it to browsers via WebSocket
- Browser connects to `server.ts` WebSocket, receives `{ topic, value, timestamp }` messages — all values come from InfluxDB queries
- Browser queries `GET /api/history?topic=...&limit=...&range=...` for data within a time range (charts) — also from InfluxDB; auto-downsamples only when raw count exceeds threshold
- **InfluxDB is the only source of truth.** The browser never sees data that InfluxDB hasn't confirmed.

## Rules

These are non-negotiable. Every sensor card must follow them.

### File structure

```
sensors/<slug>/
├── config.ts     # Sensor metadata — always required
├── sensor.tsx    # Preact component — always required
└── sensor.css    # Scoped styles — always required
```

**Only create/modify/delete files within `sensors/<slug>/`.** Never edit `src/app.tsx` or any other file outside the sensor folder — auto-discovery handles everything.

Per-sensor ingest metadata (`valueKey`, `timeOffsetKey`) is read by scanning `sensors/*/config.ts` at startup (in `src/mqtt/sensor-topics.ts`, used by the adapter). Adding a new config field that the adapter should honor requires no server-side code edit — just add the field to the config and update `sensor-topics.ts` if a new kind of metadata is introduced. Frontend-only config fields (thresholds, colors, etc.) never require any server edits.

### config.ts — always this shape

```ts
import type { SensorConfig } from '../../src/dashboard/types/sensor';

export const config: SensorConfig = {
  slug: '<slug>',
  label: '<Label>',
  topic: '<topic>',
  unit: '<unit or undefined>',
  min: 0,
  max: 100,
  decimals: 0,
  valueKey: undefined,  // JSON key for numeric value in MQTT payload (default: 'value')
  layoutWeight: 10,     // Optional ordering weight on the dashboard (default: 999)
};
```

**`valueKey`** — The JSON key used to extract the numeric value from the sensor's MQTT payload. Defaults to `'value'` if omitted. Set this when the payload uses a different key (e.g. `'water_level'` for `{"water_level": 73.5}`). The MQTT bridge reads each sensor's `valueKey` from its config and uses it to parse incoming payloads — this is per-sensor, not global.

Only keys with a registered sensor card are extracted and stored. Any other keys in the payload are ignored — they're parsed but never read, so transient data like `time_offset` or `device_id` won't clutter InfluxDB.

### sensor.tsx — component rules

- Import and use `useSensorValue` from `src/dashboard/hooks/use-sensor-data` for real-time numeric values
- Import and use `useSensorHistory` from `src/dashboard/hooks/use-sensor-data` for time-series arrays (charts)
- Import `config` from `./config`
- Import CSS from `./sensor.css`
- Accept **no props** — all config comes from `./config`
- Export as default
- Use Chart.js only if you need a chart. Import it directly — it's already installed.
- Use Preact hooks (`useState`, `useEffect`, `useRef`, etc.) freely from `preact/hooks`
- You can use SVG for custom shapes (gauges, compasses, meters, etc.)
- You can use CSS animations/transitions for dynamic effects

### sensor.css — scoping rule

Every CSS class must be scoped with `.sensor-<slug>` to avoid collisions across cards.

```css
/* BAD — unscoped */
.reading { font-size: 2rem; }

/* GOOD — scoped */
.sensor-humidity .reading { font-size: 2rem; }
```

Use these CSS custom properties from the project theme:

| Variable | Value |
|---|---|
| `--color-bg` | `#09090b` |
| `--color-surface` | `#111113` |
| `--color-border` | `#1a1a1f` |
| `--color-text` | `#fafafa` |
| `--color-text-secondary` | `#a1a1aa` |
| `--color-text-muted` | `#52525b` |
| `--color-accent` | `#818cf8` |
| `--radius-sm` | `6px` |
| `--radius-md` | `10px` |

### Slug generation

Derive from the label: lowercase, replace spaces/special chars with hyphens, collapse consecutive hyphens, strip leading/trailing hyphens. If `sensors/<slug>/` exists, append a number: `water-tank-2`.

### Verify

After any mode (create, modify, delete), verify — **do not start the dev server.**

**TypeScript compiles without errors:**

```bash
bunx tsc --noEmit
```

**For create/modify:** sensor folder exists with all 3 required files:

```bash
ls sensors/<slug>/config.ts sensors/<slug>/sensor.tsx sensors/<slug>/sensor.css
```

**For delete:** sensor folder no longer exists:

```bash
ls sensors/<slug>/ 2>/dev/null && echo "FAIL: folder still exists" || echo "OK: folder removed"
```

## Shared infrastructure

These files already exist — **do not recreate them**. Reference them by import path.

### `src/dashboard/types/sensor.ts` — SensorConfig type

Import: `import type { SensorConfig } from '../../src/dashboard/types/sensor';`

```ts
interface SensorConfig {
  slug: string;
  label: string;
  topic: string;
  unit?: string;
  min?: number;
  max?: number;
  decimals?: number;
  /** JSON key to extract the numeric value from MQTT payloads (default: 'value') */
  valueKey?: string;
  [key: string]: unknown;  // extra fields for thresholds, zones, colors, etc.
}
```

### `src/dashboard/hooks/use-sensor-data.ts` — Data hooks

Two hooks for getting sensor data into cards. **Never call InfluxDB or MQTT from a card — always use these hooks.**

| Hook | Returns | Use for |
|---|---|---|
| `useSensorValue(topic)` | `number \| null` | Big number display, gauge, status indicator |
| `useSensorHistory(topic, maxPoints?, range?)` | `HistoryPoint[]` | Line chart, area chart, trend | |

Import:
```ts
import { useSensorValue, useSensorHistory } from '../../src/dashboard/hooks/use-sensor-data';
import type { HistoryPoint } from '../../src/dashboard/hooks/use-sensor-data';
```

- `useSensorValue` returns `null` until the first WebSocket update arrives
- `useSensorHistory` returns `HistoryPoint[]` — each point has `{ value: number, timestamp: string }`. Fetches data from `/api/history` for the given range on mount (and when range changes), then appends live WebSocket updates, capped at `maxPoints` (ring buffer — oldest points drop off when the limit is exceeded)
  - `maxPoints` — max data points to keep (default 8640). Set based on how many points the chart should show
  - `range` — InfluxDB time range filter (default `'24h'`). Controls how far back to query. Common values: `'1h'`, `'24h'`, `'7d'`, `'30d'`, `'3Mo'`, `'6Mo'`, `'1y'`

### `src/dashboard/styles/sensor-card.css` — Base card styles

Already imported in `src/dashboard/styles/main.css`. Available CSS classes:

| Class | Purpose |
|---|---|
| `.sensor-card` | Card container (surface bg, border, rounded, padding) |
| `.sensor-card:hover` | Accent border on hover |
| `.sensor-card__header` | Flex row for label + topic |
| `.sensor-card__label` | Label text |
| `.sensor-card__topic` | Monospace topic text |
| `.sensor-card__body` | Centered flex container for the visualization |

### Sensor grid

Already in `src/dashboard/styles/main.css` — `.sensor-grid` with `auto-fill, minmax(280px, 1fr)` columns. Cards auto-size to their content height (no stretching).

### Card width modifiers

Add these classes to the `.sensor-card` element to control grid span:

| Class | Span | Use when |
|---|---|---|
| *(none)* | 1 column | Gauges, numbers, status indicators |
| `sensor-card--wide` | 2 columns | Line charts, area charts, anything landscape |

On mobile (<768px), `--wide` cards collapse back to 1 column automatically.

Example:
```tsx
<div class="sensor-card sensor-card--wide sensor-temperature-chart">
```

## Checklist

### Create

- [ ] Understand what the user wants to visualize
- [ ] Generate slug, check for folder conflicts
- [ ] Create `sensors/<slug>/config.ts`
- [ ] Create `sensors/<slug>/sensor.tsx` — build the visualization freely
- [ ] Create `sensors/<slug>/sensor.css` — scoped with `.sensor-<slug>`
- [ ] `bunx tsc --noEmit` — no type errors
- [ ] `ls sensors/<slug>/{config.ts,sensor.tsx,sensor.css}` — all files exist

### Modify

- [ ] Identify which sensor (by label, slug, or topic)
- [ ] Read existing files to understand current state
- [ ] Apply changes to the needed files — full control over all 3 files
- [ ] If slug changed: delete old folder, create new folder
- [ ] `bunx tsc --noEmit` — no type errors
- [ ] `ls sensors/<slug>/{config.ts,sensor.tsx,sensor.css}` — all files exist

### Delete

- [ ] Identify which sensor (by label, slug, or topic)
- [ ] Ask user for confirmation with `ask_user_question` — mention code AND database data will be removed
- [ ] If confirmed: remove `sensors/<slug>/` folder
- [ ] Delete InfluxDB data + block topic via `DELETE /api/sensor-data?topic=<topic>` — verify HTTP 204
- [ ] `bunx tsc --noEmit` — no type errors
- [ ] `ls sensors/<slug>/ 2>/dev/null` — folder no longer exists
