import { useEffect, useState, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { fetchSensors } from '../api/sensors.ts'
import type { SensorConfig } from '../api/sensors.ts'

interface SensorUpdate {
  sensorId: string
  fieldId: string
  value: number
  timestamp: number
}

type ServiceStatus = 'connected' | 'disconnected'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:3001`

export function useSensors() {
  const [sensors, setSensors] = useState<SensorConfig[]>([])
  const [values, setValues] = useState<Record<string, Record<string, number>>>({})
  const [socketStatus, setSocketStatus] = useState<ServiceStatus>('disconnected')
  const [mqttStatus, setMqttStatus] = useState<ServiceStatus>('disconnected')
  const [loading, setLoading] = useState(true)
  const socketRef = useRef<Socket | null>(null)

  const loadSensors = useCallback(async () => {
    try {
      const data = await fetchSensors()
      setSensors(data)
    } catch (err) {
      console.error('Failed to load sensors:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const connectSocket = useCallback(() => {
    if (socketRef.current?.connected) return

    const socket = io(SERVER_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })

    socket.on('connect', () => setSocketStatus('connected'))
    socket.on('disconnect', () => setSocketStatus('disconnected'))
    socket.on('connect_error', () => setSocketStatus('disconnected'))

    socket.on('mqtt:status', (status: ServiceStatus) => {
      setMqttStatus(status)
    })

    socket.on('sensor:update', (update: SensorUpdate) => {
      setValues((prev) => ({
        ...prev,
        [update.sensorId]: {
          ...prev[update.sensorId],
          [update.fieldId]: update.value,
        },
      }))
    })

    socketRef.current = socket
  }, [])

  useEffect(() => {
    loadSensors()
    connectSocket()

    return () => {
      socketRef.current?.disconnect()
      socketRef.current = null
    }
  }, [loadSensors, connectSocket])

  const refreshSensors = useCallback(async () => {
    setLoading(true)
    await loadSensors()
  }, [loadSensors])

  return { sensors, values, socketStatus, mqttStatus, loading, refreshSensors }
}
