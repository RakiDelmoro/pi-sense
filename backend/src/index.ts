import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import mqtt from 'mqtt'
import config from './config/sensor_configs.js'

type ServiceStatus = 'connected' | 'disconnected'

const app = express()
app.use(cors())

const httpServer = createServer(app)

const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
  },
})

let mqttStatus: ServiceStatus = 'disconnected'

const topicToField = new Map<string, { sensorKey: string; fieldKey: string }>()

for (const [sensorKey, sensor] of Object.entries(config.sensors)) {
  for (const [fieldKey, field] of Object.entries(sensor.fields)) {
    topicToField.set(field.topic, { sensorKey, fieldKey })
  }
}

const topics = Array.from(topicToField.keys())

const mqttClient = mqtt.connect(config.mqtt.brokerUrl)

mqttClient.on('connect', () => {
  mqttStatus = 'connected'
  console.log(`Connected to MQTT broker: ${config.mqtt.brokerUrl}`)
  io.emit('mqtt:status', mqttStatus)

  for (const topic of topics) {
    mqttClient.subscribe(topic, { qos: 1, rh: 0 }, (err) => {
      if (err) {
        console.error(`Failed to subscribe to ${topic}:`, err)
      } else {
        console.log(`Subscribed to: ${topic}`)
      }
    })
  }
})

mqttClient.on('message', (topic, message) => {
  const mapping = topicToField.get(topic)
  if (!mapping) return

  const raw = message.toString().trim()
  const value = parseFloat(raw)
  if (isNaN(value)) {
    console.warn(`Invalid numeric value on ${topic}: "${raw}"`)
    return
  }

  const payload = {
    sensorKey: mapping.sensorKey,
    fieldKey: mapping.fieldKey,
    value,
    timestamp: Date.now(),
  }

  io.emit('sensor:update', payload)
})

mqttClient.on('error', (err) => {
  console.error('MQTT connection error:', err.message)
  mqttStatus = 'disconnected'
  io.emit('mqtt:status', mqttStatus)
})

mqttClient.on('offline', () => {
  console.warn('MQTT broker offline')
  mqttStatus = 'disconnected'
  io.emit('mqtt:status', mqttStatus)
})

mqttClient.on('close', () => {
  mqttStatus = 'disconnected'
  io.emit('mqtt:status', mqttStatus)
})

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`)
  socket.emit('mqtt:status', mqttStatus)
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`)
  })
})

app.get('/api/config', (_req, res) => {
  res.json(config.sensors)
})

httpServer.listen(config.server.port, () => {
  console.log(`PiSense server running on port ${config.server.port}`)
})
