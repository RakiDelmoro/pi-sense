<div align="center">
  <img src="public/gen-logo.png" width="300" />

  <br />
  <br />

  **Think it. Say it. See it.** Describe a sensor card and [Pi](https://pi.dev/) builds it end-to-end — code, data, and visuals appear automatically. The only tool you need is your words.

</div>

---

## Development

*Build and iterate locally — spin up the stack, create sensor cards, and see changes in real time.*

### 1. Open the dev container

```bash
git clone https://github.com/RakiDelmoro/pi-sense.git
cd pi-sense
```

Open the project in VS Code — it will prompt to **Reopen in Container**. Accept it.

The dev container starts:
- **App** (`pi-sense-dev-app`) — your workspace with Bun and all dependencies
- **InfluxDB** (`pi-sense-dev-influxdb`) — time-series database (port 8086)
- **Mosquitto** (`pi-sense-dev-mosquitto`) — MQTT broker (port 1883)

### 2. Start the core system (Dashboard, MQTT, InfluxDB)

```bash
bun start
```

Open **http://localhost:3141** — the dashboard is live.

### 3. Create sensor cards
Start the Pi interactive harness:

```bash
pi
```

Tell [Pi](https://pi.dev/) what you want. It generates the card, wires the data, renders the visualization.

```
You: "Add a temperature gauge on topic pi-sensors/temperature, range -10 to 50"
Pi:  Creates sensors/temperature/{config.ts, sensor.tsx, sensor.css}
```

Card files are **auto-discovered** — no manual wiring. A file watcher detects changes, regenerates the registry, and rebuilds the frontend bundle. Refresh the browser to see updates.

```
sensors/<slug>/
├── config.ts      # metadata: topic, label, range, unit
├── sensor.tsx     # Preact component
└── sensor.css     # scoped styles
```


### 4. Verify with live data

```bash
mosquitto_pub -h localhost -p 1883 -t "pi-sensors/temperature" -m '{"value": 23.5}'
```

Open **http://localhost:3141** — you should see the temperature card update with `23.5`. If the card doesn't respond, check that:
- The MQTT broker is running (`pi-sense-dev-mosquitto`)
- The topic matches the one defined in `sensors/<slug>/config.ts`
- The dashboard server is running (`bun start`)

---

## Production

*Ship it — configure real credentials, deploy with Docker, and keep your sensor data safe.*

### 1. Configure

```bash
cp .env.example .env
```

Edit `.env` — replace all `change-me-in-production` values with real credentials.

### 2. Build and run (also used for deploying updates)

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

Same commands for first deploy and updates — only the dashboard container is rebuilt, InfluxDB data is preserved.

### 3. Management commands

| Command | What it does | Data impact |
|---------|--------------|-------------|
| `docker compose -f docker-compose.prod.yml down` | Stop all containers | ✅ Data preserved |
| `docker compose -f docker-compose.prod.yml up -d` | Start all containers | ✅ Data preserved |
| `docker compose -f docker-compose.prod.yml down -v` | Stop and **delete all volumes** | ⚠️ **All data wiped** |

> **⚠️ `down -v` is destructive** — it permanently deletes InfluxDB sensor history and Mosquitto credentials. Use it only when you want a completely fresh start (e.g., changing credentials, corrupted data).

---

## 🤖 Let Pi Handle It

**Got a warning, caught a bug, or dealing with some messy spots in our codebase? Do not sweat it.** Let [Pi](https://pi.dev/) deal with it. Just drop your thoughts or paste the error in the chat, and let Pi do the heavy lifting of rewriting, refactoring, and fixing. **Write less, build more.** 🚀
