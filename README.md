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

- **MQTT** receives raw sensor data
- **Server** bridges MQTT → InfluxDB, then pushes confirmed values to browsers
- **InfluxDB** is the only source of truth — the dashboard never sees unconfirmed data
- **WebSocket** delivers real-time updates — no polling, no refresh

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

## Docker

```bash
docker compose up
```

Production-ready with InfluxDB persistence and automatic Mosquitto setup.

## License

MIT
