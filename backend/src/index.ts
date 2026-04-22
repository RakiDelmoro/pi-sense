import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { MqttManager } from './mqtt/mqttManager.js'
import { createSensorRoutes } from './routes/sensors.js'
import { getAllSensors } from './store/sensorStore.js'

const app = express()
app.use(cors())
app.use(express.json())

const httpServer = createServer(app)

const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
  },
})

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883'
const PORT = parseInt(process.env.PORT || '3001', 10)

console.log(`[server] Starting on port ${PORT}...`)

const mqttManager = new MqttManager(MQTT_BROKER_URL)
mqttManager.connect(io)

// Load persisted sensors and sync subscriptions once MQTT is ready
const persistedSensors = getAllSensors()
if (persistedSensors.length > 0) {
  console.log(`[server] Restoring ${persistedSensors.length} sensor(s)`)
  mqttManager.syncSubscriptions(persistedSensors)
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`)
  socket.emit('mqtt:status', mqttManager.getMqttStatus())
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`)
  })
})

app.use('/api/sensors', createSensorRoutes(mqttManager))

httpServer.listen(PORT, () => {
  console.log(`PiSense server running on port ${PORT}`)
})
