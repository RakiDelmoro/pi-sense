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

### 1. Configure

Edit `docker-compose.prod.yml` — fill in every line marked with `# ⚠️ set before deploying`.

### 2. Build and run on the same machine

If you're deploying on the same machine where you're building:

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

Same commands for first deploy and updates — only the dashboard container is rebuilt, InfluxDB data is preserved.

### 3. Cross-platform build — export as tar

When the target platform differs from your build machine (e.g. building on x86_64 for a Raspberry Pi 4), use Docker buildx for cross-compilation.

**Create a buildx builder (one-time):**

```bash
docker buildx create --name pi-builder --use
docker buildx inspect --bootstrap
```

**Build for a specific platform and save as tar:**

| Target | Command |
|--------|--------|
| Raspberry Pi 4 / ARM64 | `docker buildx build --platform linux/arm64 --output type=docker,dest=pi-sense-prod.tar -t pi-sense-prod:latest -f Dockerfile .` |
| Linux x86_64 | `docker buildx build --platform linux/amd64 --output type=docker,dest=pi-sense-prod.tar -t pi-sense-prod:latest -f Dockerfile .` |
| Windows (WSL2 + Docker) | `docker buildx build --platform linux/amd64 --output type=docker,dest=pi-sense-prod.tar -t pi-sense-prod:latest -f Dockerfile .` |

**Transfer the image to the target machine:**

```bash
scp pi-sense-prod.tar user@<TARGET_IP>:~/
```

**On the target machine, load and run:**

```bash
docker load -i pi-sense-prod.tar

docker run -d --name pi-sense \
  -p 3141:3141 \
  -e HUE_BRIDGE_IP=<hue-bridge-ip> \
  -e HUE_API_KEY=<your-api-key> \
  -e INFLUX_URL=http://influxdb:8086 \
  -e INFLUX_TOKEN=<your-token> \
  -e INFLUX_ORG=pi-sense \
  -e INFLUX_BUCKET=pi-sense \
  -e MQTT_URL=mqtt://mosquitto:1883 \
  -e MQTT_USERNAME=<your-mqtt-user> \
  -e MQTT_PASSWORD=<your-mqtt-pass> \
  pi-sense-prod:latest
```



### 4. Updating production — without losing data

The dashboard is **stateless** — all sensor history lives in InfluxDB and Mosquitto volumes, which persist across updates. Only the dashboard container gets swapped; data stays intact.

**With docker compose (full stack on the Pi):**

```bash
# 1. Build new image on your dev machine
docker buildx build --platform linux/arm64 --output type=docker,dest=pi-sense-prod.tar -t pi-sense-prod:latest -f Dockerfile .

# 2. Transfer to Pi
scp pi-sense-prod.tar user@<PI_IP>:~/

# 3. On the Pi: load the new image and recreate only the dashboard
docker load -i pi-sense-prod.tar
docker compose -f docker-compose.prod.yml up -d dashboard
```

**With docker run (standalone dashboard only):**

```bash
# 1. Build new image on your dev machine
docker buildx build --platform linux/arm64 --output type=docker,dest=pi-sense-prod.tar -t pi-sense-prod:latest -f Dockerfile .

# 2. Transfer to Pi
scp pi-sense-prod.tar user@<PI_IP>:~/

# 3. On the Pi: swap the old container for the new one
docker stop pi-sense && docker rm pi-sense
docker load -i pi-sense-prod.tar
docker run -d --name pi-sense \
  -p 3141:3141 \
  -e HUE_BRIDGE_IP=<hue-bridge-ip> \
  -e HUE_API_KEY=<your-api-key> \
  -e INFLUX_URL=http://influxdb:8086 \
  -e INFLUX_TOKEN=<your-token> \
  -e INFLUX_ORG=pi-sense \
  -e INFLUX_BUCKET=pi-sense \
  -e MQTT_URL=mqtt://mosquitto:1883 \
  -e MQTT_USERNAME=<your-mqtt-user> \
  -e MQTT_PASSWORD=<your-mqtt-pass> \
  pi-sense-prod:latest
```

---

## 🤖 Let Pi Handle It

**Got a warning, caught a bug, or dealing with some messy spots in our codebase? Do not sweat it.** Let [Pi](https://pi.dev/) deal with it. Just drop your thoughts or paste the error in the chat, and let Pi do the heavy lifting of rewriting, refactoring, and fixing. **Write less, build more.** 🚀
