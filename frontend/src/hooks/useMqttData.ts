import { useEffect, useState, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'

interface SensorUpdate {
  sensorKey: string
  fieldKey: string
  value: number
  timestamp: number
}

type SensorData = Record<string, Record<string, number>>
type ServiceStatus = 'connected' | 'disconnected'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:3001`

export function useMqttData() {
  const [data, setData] = useState<SensorData>({})
  const [socketStatus, setSocketStatus] = useState<ServiceStatus>('disconnected')
  const [mqttStatus, setMqttStatus] = useState<ServiceStatus>('disconnected')
  const socketRef = useRef<Socket | null>(null)

  const connect = useCallback(() => {
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
      setData((prev) => ({
        ...prev,
        [update.sensorKey]: {
          ...prev[update.sensorKey],
          [update.fieldKey]: update.value,
        },
      }))
    })

    socketRef.current = socket
  }, [])

  useEffect(() => {
    connect()

    return () => {
      socketRef.current?.disconnect()
      socketRef.current = null
    }
  }, [connect])

  return { data, socketStatus, mqttStatus }
}
