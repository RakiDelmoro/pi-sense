<div align="center">
  <img src="public/logo.png" width="120" />

  # Pi Sense

  **Sensor dashboards that build themselves.**

  **Think it. Say it. See it.** Describe a sensor card and [Pi](https://pi.dev/) builds it end-to-end — code, data, and visuals appear automatically. The only tool you need is your words.

</div>

---

## Development

### 1. Open the dev container

```bash
git clone https://github.com/RakiDelmoro/pi-sense.git
cd pi-sense
```

Open the project in VS Code — it will prompt to **Reopen in Container**. Accept it.

The dev container starts:
- **App** — your workspace with Bun and all dependencies
- **InfluxDB** — time-series database (port 8086)
- **Mosquitto** — MQTT broker (port 1883)

### 2. Start the dashboard

```bash
bun run dev
```

Open **http://localhost:3141** — the dashboard is live.

### 3. Create sensor cards

Tell [Pi](https://pi.dev/) what you want. It generates the card, wires the data, renders the visualization.

```
You: "Add a temperature gauge on topic sensors/temp, range -10 to 50"
Pi:  Creates sensors/temperature/{config.ts, sensor.tsx, sensor.css}
```

Card files are **auto-discovered** — no manual wiring. A file watcher detects changes, regenerates the registry, and rebuilds the frontend bundle. Refresh the browser to see updates.

```
sensors/<slug>/
├── config.ts      # metadata: topic, label, range, unit
├── sensor.tsx     # Preact component
└── sensor.css     # scoped styles
```

All sensor topics must start with `sensors/` — the server subscribes to `sensors/#`.

### 4. Test with live data

```bash
mosquitto_pub -t "sensors/temperature" -m '{"value": 23.5}'
```

---

## Production

### 1. Configure

```bash
cp .env.example .env
```

Edit `.env` — replace all `change-me-in-production` values with real credentials.

### 2. Build and run

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```
