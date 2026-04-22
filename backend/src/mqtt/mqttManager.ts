import mqtt from 'mqtt'
import type { Server } from 'socket.io'
import type { SensorConfig } from '../store/sensorStore.js'
import { getAllSensors } from '../store/sensorStore.js'
import { parsePayload } from '../parser/payloadParser.js'

export class MqttManager {
  private client: mqtt.MqttClient | null = null
  private io: Server | null = null
  private subscribedTopics = new Set<string>()
  private brokerUrl: string

  constructor(brokerUrl: string) {
    this.brokerUrl = brokerUrl
  }

  connect(io: Server) {
    this.io = io
    this.client = mqtt.connect(this.brokerUrl)

    this.client.on('connect', () => {
      console.log(`[mqtt] Connected to broker: ${this.brokerUrl}`)
      io.emit('mqtt:status', 'connected')
    })

    this.client.on('message', (topic, message) => {
      this.handleMessage(topic, message.toString())
    })

    this.client.on('error', (err) => {
      console.error('[mqtt] Connection error:', err.message)
      io.emit('mqtt:status', 'disconnected')
    })

    this.client.on('offline', () => {
      console.warn('[mqtt] Broker offline')
      io.emit('mqtt:status', 'disconnected')
    })

    this.client.on('close', () => {
      io.emit('mqtt:status', 'disconnected')
    })
  }

  private handleMessage(topic: string, raw: string) {
    const sensors = getAllSensors()
    const matchingSensors = sensors.filter((s) => s.topic === topic)
    if (matchingSensors.length === 0) return

    for (const sensor of matchingSensors) {
      const values = parsePayload(sensor, raw)
      for (const [fieldId, value] of Object.entries(values)) {
        if (value === null) continue
        this.io?.emit('sensor:update', {
          sensorId: sensor.id,
          fieldId,
          value,
          timestamp: Date.now(),
        })
      }
    }
  }

  subscribeTopic(topic: string) {
    if (!this.client || this.subscribedTopics.has(topic)) return
    this.client.subscribe(topic, { qos: 1, rh: 0 }, (err) => {
      if (err) {
        console.error(`[mqtt] Failed to subscribe to ${topic}:`, err)
      } else {
        console.log(`[mqtt] Subscribed to: ${topic}`)
        this.subscribedTopics.add(topic)
      }
    })
  }

  unsubscribeTopic(topic: string) {
    if (!this.client || !this.subscribedTopics.has(topic)) return
    this.client.unsubscribe(topic, (err) => {
      if (err) {
        console.error(`[mqtt] Failed to unsubscribe from ${topic}:`, err)
      } else {
        console.log(`[mqtt] Unsubscribed from: ${topic}`)
        this.subscribedTopics.delete(topic)
      }
    })
  }

  syncSubscriptions(sensors: SensorConfig[]) {
    const desiredTopics = new Set(sensors.map((s) => s.topic))
    // Subscribe to new topics
    for (const topic of desiredTopics) {
      this.subscribeTopic(topic)
    }
    // Unsubscribe from removed topics
    for (const topic of this.subscribedTopics) {
      if (!desiredTopics.has(topic)) {
        this.unsubscribeTopic(topic)
      }
    }
  }

  getMqttStatus(): 'connected' | 'disconnected' {
    return this.client?.connected ? 'connected' : 'disconnected'
  }
}
