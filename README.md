<div align="center">
  <img src="public/logo.png" width="120" />

  # Pi Sense

  **Sensor dashboards that build themselves.**

  Describe a sensor card — Pi Agent writes the code, wires the data, renders the visualization. No config files to edit. No components to register. Just say what you want.

  [Get Started](#get-started) · [How It Works](#how-it-works) · [Architecture](#architecture)

</div>

---

## Philosophy

Pi Sense is built on one idea: **don't build the dashboard — describe it.**

You tell Pi Agent *"add a temperature gauge on topic sensors/temp, range -10 to 50"*. It creates the card, the config, the styles — everything. You say *"change it to a vertical bar"* — it rewrites the component. You say *"delete it"* — it's gone, code and data.

No boilerplate. No wiring. No registry to update. Just describe what you want to see.

## Get Started

```bash
# 1. Clone
git clone https://github.com/RakiDelmoro/pi-sense.git
cd pi-sense

# 2. Start everything
bun run dev
```

That's it. Mosquitto, InfluxDB, and the dashboard all start together.

```bash
# 3. Publish some data
mosquitto_pub -t "sensors/temperature" -m '{"value": 23.5}'
```

Open **http://localhost:3141** — your data is live.

## How It Works

```
  Sensor ──► MQTT ──► Server (bridge) ──► InfluxDB ──► WebSocket ──► Dashboard
                                     │
                                     └── single source of truth
```

1. **MQTT** receives raw sensor data on `sensors/#`
2. **Server** writes to InfluxDB, flushes, queries back the confirmed value, then pushes it to browsers via WebSocket
3. **InfluxDB** is the only source of truth — the dashboard never sees unconfirmed data
4. **WebSocket** delivers real-time updates to cards — no polling, no refresh needed
5. **Cards** auto-subscribe to their topic on mount via Preact hooks, fetch initial data from the history API, then receive live pushes

## Architecture

| Layer | Tech | Role |
|---|---|---|
| Broker | Mosquitto | MQTT ingest |
| Database | InfluxDB 2.7 | Time-series storage |
| Server | Bun + TypeScript | MQTT bridge, WebSocket, HTTP API |
| Dashboard | Preact + Chart.js | Real-time cards |

## Sensor Cards

Cards live in `sensors/<slug>/` and are **auto-discovered** — no manual wiring:

```
sensors/temperature/
├── config.ts      # metadata: topic, label, range, unit
├── sensor.tsx     # Preact component
└── sensor.css     # scoped styles
```

Every card reads config from its own `config.ts`. That's where your topic, range, and label live — the component follows.

### Auto-Discovery

Adding or removing a sensor card requires **zero changes** outside its folder. The server scans `sensors/*/sensor.tsx` at build time and generates a registry (`src/sensor-registry.ts`) with static imports for every card. The dashboard imports this registry and renders all cards — no manual registration, no config files to edit.

In development, a file watcher polls `sensors/` and `src/` every second. When it detects changes, it regenerates the registry, rebuilds the frontend bundle, and serves the updated bundle on the next page refresh.

### Topic Convention

All sensor topics **must start with `sensors/`**. The server subscribes to `sensors/#` on the MQTT broker — any topic outside this prefix will not be received.

```
✅  sensors/temperature
✅  sensors/water-tank
✅  sensors/wind/dir
❌  temperature        (won't be received)
❌  test/sensor        (won't be received)
```

### Real-Time Data Flow

Once a sensor card is rendered in the dashboard, it receives live data automatically — no refresh needed:

```
Sensor publishes ──► MQTT Broker
                         │
                    server.ts
                    (subscribes to sensors/#)
                         │
                  Write to InfluxDB
                  Flush to confirm
                  Query back from InfluxDB
                         │
                  WebSocket push to browser
                         │
                  useSensorValue / useSensorHistory
                  (Preact hooks update state → re-render)
```

Key guarantees:

- **InfluxDB is the only source of truth.** The server writes to InfluxDB, flushes, then queries back the confirmed value before pushing it to browsers. The dashboard never sees unconfirmed data.
- **WebSocket delivers real-time updates** — no polling, no refresh. Each card subscribes to its topic on mount and receives pushes immediately.
- **Initial data on mount.** Cards fetch `/api/history` on mount so they show the latest value even if no new data has arrived since the page loaded.
- **Automatic reconnection.** If the WebSocket drops, the client reconnects within 3 seconds and re-subscribes to all active topics.

### Data Hooks

Sensor components use two Preact hooks from `src/hooks/use-sensor-data.ts` — they are the **only** way cards receive data (never call InfluxDB or MQTT directly from a card):

| Hook | Returns | Use for |
|---|---|---|
| `useSensorValue(topic)` | `number \| null` | Gauge, big number, status indicator |
| `useSensorHistory(topic, maxPoints?)` | `HistoryPoint[]` | Line chart, area chart, trend (default 60 points) |

Both hooks share a single WebSocket connection and manage subscriptions automatically — subscribe on mount, unsubscribe on unmount.

### Card Styles

Cards use shared base classes from `src/styles/sensor-card.css` (already imported globally):

| Class | Purpose |
|---|---|
| `.sensor-card` | Card container (surface bg, border, rounded) |
| `.sensor-card--wide` | 2-column span (for charts) |
| `.sensor-card__header` | Flex row for label + topic |
| `.sensor-card__body` | Centered flex container for the visualization |

Custom styles are scoped with `.sensor-<slug>` to avoid collisions across cards.

## Docker

```bash
docker compose up
```

Production-ready with InfluxDB persistence and automatic Mosquitto setup.

## License

MIT
