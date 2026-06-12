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

**Inside the dev container** (Linux shell):

```bash
mosquitto_pub -h localhost -p 1883 -t "pi-sensors/temperature" -m '{"value": 23.5}'
```

**From Windows PowerShell** (host machine) — use `--%` to stop PowerShell from stripping quotes:

```powershell
mosquitto_pub --% -h localhost -p 1883 -t "pi-sensors/temperature" -m "{\"value\": 23.5}"
```

Open **http://localhost:3141** — you should see the temperature card update with `23.5`. If the card doesn't respond, check that:
- The MQTT broker is running (`pi-sense-dev-mosquitto`)
- The topic matches the one defined in `sensors/<slug>/config.ts`
- The dashboard server is running (`bun start`)

Something not working? Ask [Pi](https://pi.dev/) — paste the error or describe what's off and let it debug for you.

---

## Production

*Ship it — configure real credentials, build the Docker image, and deploy anywhere. No project directory needed in production.*

### 1. Build images

Images are generic — no configuration is baked in. All config lives in `docker-compose.prod.yml` and is injected at runtime. Only mosquitto needs `--build-arg` (it hashes passwords at build time).

**Dashboard (web + server):**

```powershell
docker buildx build --platform linux/arm64 `
  -t pi-sense-dashboard:latest `
  -f Dockerfile.dashboard --load .
```

**InfluxDB:**

```powershell
docker buildx build --platform linux/arm64 `
  -t pi-sense-influxdb:latest `
  -f Dockerfile.influxdb --load .
```

**Mosquitto:**

```powershell
docker buildx build --platform linux/arm64 `
  -t pi-sense-mosquitto:latest `
  --build-arg MQTT_USERNAME=<your-mqtt-user> `
  --build-arg MQTT_PASSWORD=<your-mqtt-pass> `
  -f Dockerfile.mosquitto --load .
```

### 2. Configure

Edit `docker-compose.prod.yml` — fill in every line marked with `# ⚠️ set before deploying`.

### 3. Run the stack

```bash
docker compose -f docker-compose.prod.yml up -d
```

### 4. Cross-platform build — export as tar

When the target platform differs from your build machine (e.g. building on x86_64 for a Raspberry Pi 4), export each image as a tar, transfer, and load on the target.

**Create a buildx builder (one-time):**

```bash
docker buildx create --name pi-builder --use
docker buildx inspect --bootstrap
```

**Build and export (replace `--load` with `--output`):**

```powershell
# Dashboard
docker buildx build --platform linux/arm64 `
  --output type=docker,dest=pi-sense-dashboard.tar `
  -t pi-sense-dashboard:latest `
  -f Dockerfile.dashboard .

# InfluxDB
docker buildx build --platform linux/arm64 `
  --output type=docker,dest=pi-sense-influxdb.tar `
  -t pi-sense-influxdb:latest `
  -f Dockerfile.influxdb .

# Mosquitto
docker buildx build --platform linux/arm64 `
  --output type=docker,dest=pi-sense-mosquitto.tar `
  -t pi-sense-mosquitto:latest `
  --build-arg MQTT_USERNAME=<your-mqtt-user> `
  --build-arg MQTT_PASSWORD=<your-mqtt-pass> `
  -f Dockerfile.mosquitto .
```

**Transfer and load on the target machine:**

```bash
scp pi-sense-dashboard.tar pi-sense-influxdb.tar pi-sense-mosquitto.tar docker-compose.prod.yml user@<TARGET_IP>:~/
```

```bash
docker load -i pi-sense-dashboard.tar
docker load -i pi-sense-influxdb.tar
docker load -i pi-sense-mosquitto.tar
docker compose -f docker-compose.prod.yml up -d
```

### 5. Updating production — without losing data

The dashboard is **stateless** — all sensor history lives in InfluxDB volumes, which persist across updates.

```bash
# 1. Rebuild dashboard image
# 2. Transfer the new tar (+ compose file if config changed)

scp pi-sense-dashboard.tar user@<TARGET_IP>:~/
# scp docker-compose.prod.yml user@<TARGET_IP>:~/  # only if changed

# 3. On the Pi: load and recreate only the dashboard
docker load -i pi-sense-dashboard.tar
docker compose -f docker-compose.prod.yml up -d dashboard
```

---

## 🤖 Let Pi Handle It

**Got a warning, caught a bug, or dealing with some messy spots in our codebase? Do not sweat it.** Let [Pi](https://pi.dev/) deal with it. Just drop your thoughts or paste the error in the chat, and let Pi do the heavy lifting of rewriting, refactoring, and fixing. **Write less, build more.** 🚀
