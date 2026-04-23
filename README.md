# PiSense Home

A real-time IoT sensor monitoring dashboard designed for Raspberry Pi. Connects to MQTT brokers, ingests sensor data, and displays it through interactive widgets on a free-form canvas.

## Getting Started

```bash
npm install
npm run dev
```

This starts both the backend server (`:3001`) and the Vite frontend dev server (`:5173`) concurrently.

## MQTT Broker Configuration

By default, the server tries to connect to an MQTT broker at `mqtt://localhost:1883`. To use a different broker (e.g., an external Mosquitto instance on your network), set the `MQTT_BROKER_URL` environment variable before starting the dev server:

```bash
export MQTT_BROKER_URL=mqtt://192.168.51.121:1883
npm run dev
```

Or add it to your shell profile for persistence:

```bash
echo 'export MQTT_BROKER_URL=mqtt://192.168.51.121:1883' >> ~/.bashrc
source ~/.bashrc
```

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start backend + frontend concurrently |
| `npm run dev:server` | Start backend only (tsx watch) |
| `npm run dev:client` | Start frontend only (Vite) |
| `npm run build` | Type-check and build for production |
| `npm run lint` | Run ESLint |
| `npm run preview` | Preview production build |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | URL of the MQTT broker |
| `PORT` | `3001` | Backend server port |
| `VITE_SERVER_URL` | auto-detected | Frontend Socket.IO server URL |
| `VITE_API_URL` | `''` | Frontend REST API base URL |

## Architecture

- **Backend** — Express.js + Socket.io + MQTT.js
- **Frontend** — React 19 + Vite + TypeScript
- **Storage** — JSON file (`backend/data/sensors.json`)
