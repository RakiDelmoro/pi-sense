import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'
import { useSensors } from './hooks/useSensors'
import { WidgetRenderer } from './components/WidgetRenderer'
import { AddSensorModal } from './components/AddSensorModal'
import { deleteSensor, updateSensorPosition } from './api/sensors'
import type { SensorConfig, FieldConfig } from './api/sensors'
import { NetworkBackground } from './components/NetworkBackground'
import { StatusIndicator } from './components/widgets/StatusIndicator'

function TypingText({ text, speed = 60 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState('')
  const [showCursor, setShowCursor] = useState(true)
  const [done, setDone] = useState(false)
  const indexRef = useRef(0)

  useEffect(() => {
    const typeNext = () => {
      if (indexRef.current < text.length) {
        setDisplayed(text.slice(0, indexRef.current + 1))
        indexRef.current += 1
        setTimeout(typeNext, speed)
      } else {
        setDone(true)
        setTimeout(() => setShowCursor(false), 600)
      }
    }
    const timer = setTimeout(typeNext, 400)
    return () => clearTimeout(timer)
  }, [text, speed])

  return (
    <span className="typing-text">
      {displayed}
      {showCursor && <span className={`typing-cursor ${done ? 'typing-cursor--fade' : ''}`} />}
    </span>
  )
}

function FieldWidget({
  field,
  value,
}: {
  field: FieldConfig
  value: number
}) {
  return (
    <div className="field-widget">
      <WidgetRenderer field={field} value={value} />
    </div>
  )
}

function SensorCard({
  sensor,
  fieldValues,
  onDelete,
  onDragStart,
  isDragging,
}: {
  sensor: SensorConfig
  fieldValues: Record<string, number>
  onDelete: (id: string) => void
  onDragStart: (e: React.MouseEvent | React.TouchEvent, id: string) => void
  isDragging: boolean
}) {
  const pos = sensor.position ?? { x: 50, y: 50 }

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.sensor-delete')) return
    onDragStart(e, sensor.id)
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('.sensor-delete')) return
    onDragStart(e, sensor.id)
  }

  return (
    <div
      className={`card sensor-card ${isDragging ? 'dragging' : ''}`}
      style={{
        position: 'absolute',
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        transform: 'translate(-50%, -50%)',
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      <button
        className="sensor-delete"
        onClick={() => onDelete(sensor.id)}
        aria-label="Delete sensor"
        title="Delete sensor"
      >
        &times;
      </button>
      <h2>{sensor.label}</h2>
      <div className={`sensor-fields sensor-fields--${sensor.fields.length}`}>
        {sensor.fields.map((field) => (
          <FieldWidget
            key={field.id}
            field={field}
            value={fieldValues[field.id] ?? field.settings.min}
          />
        ))}
      </div>
    </div>
  )
}

function App() {
  const { sensors, values, socketStatus, mqttStatus, loading, refreshSensors } = useSensors()
  const [showModal, setShowModal] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const canvasRef = useRef<HTMLElement>(null)

  const systemStatus = socketStatus === 'connected' && mqttStatus === 'connected' ? 'connected' : 'disconnected'
  const isEmpty = !loading && sensors.length === 0

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this sensor?')) return
    try {
      await deleteSensor(id)
      refreshSensors()
    } catch (err) {
      console.error('Failed to delete sensor:', err)
      alert('Failed to delete sensor')
    }
  }

  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent, id: string) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

    const rect = canvas.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * 100
    const y = ((clientY - rect.top) / rect.height) * 100

    const sensor = sensors.find((s) => s.id === id)
    const pos = sensor?.position ?? { x: 50, y: 50 }

    setDragOffset({ x: x - pos.x, y: y - pos.y })
    setDragging(id)
  }, [sensors])

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!dragging || !canvasRef.current) return

    const canvas = canvasRef.current
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

    const rect = canvas.getBoundingClientRect()
    let x = ((clientX - rect.left) / rect.width) * 100 - dragOffset.x
    let y = ((clientY - rect.top) / rect.height) * 100 - dragOffset.y

    x = Math.max(5, Math.min(95, x))
    y = Math.max(5, Math.min(95, y))

    updateSensorPosition(dragging, { x, y }).catch((err) => {
      console.error('Failed to update position:', err)
    })
  }, [dragging, dragOffset])

  const handleDragEnd = useCallback(() => {
    setDragging(null)
  }, [])

  useEffect(() => {
    if (!dragging) return
    window.addEventListener('mousemove', handleDragMove)
    window.addEventListener('mouseup', handleDragEnd)
    window.addEventListener('touchmove', handleDragMove)
    window.addEventListener('touchend', handleDragEnd)
    return () => {
      window.removeEventListener('mousemove', handleDragMove)
      window.removeEventListener('mouseup', handleDragEnd)
      window.removeEventListener('touchmove', handleDragMove)
      window.removeEventListener('touchend', handleDragEnd)
    }
  }, [dragging, handleDragMove, handleDragEnd])

  return (
    <div className="app">
      <NetworkBackground />
      <div className="ambient-orb orb-1" />
      <div className="ambient-orb orb-2" />
      <div className="ambient-orb orb-3" />

      <div className="content-layer">
        <header className="header">
          <div className="header-top">
            <div className="logo-group">
              <div className="logo-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </div>
              <div className="logo-text">
                <h1 className="title">PiSense Home</h1>
                <p className="tagline">
                  {isEmpty ? (
                    <TypingText text="Your data, your home, your view." />
                  ) : (
                    'Your data, your home, your view.'
                  )}
                </p>
              </div>
            </div>

            <div className="header-status-group">
              {!isEmpty && (
                <button
                  className="btn btn-primary header-add-btn"
                  onClick={() => setShowModal(true)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add Sensor
                </button>
              )}
              <StatusIndicator value={systemStatus === 'connected' ? 1 : 0} label="System" />
            </div>
          </div>
        </header>

        <main
          className={`main ${dragging ? 'main--dragging' : ''}`}
          ref={canvasRef as React.RefObject<HTMLElement>}
        >
          {loading ? (
            <div className="empty-state">
              <div className="loading-spinner" />
              <p>Loading sensors...</p>
            </div>
          ) : isEmpty ? (
            <div className="empty-state">
              <button className="btn btn-primary add-sensor-btn add-sensor-btn--hero" onClick={() => setShowModal(true)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add sensor to monitor
              </button>
            </div>
          ) : (
            <section className="sensor-canvas">
              {sensors.map((sensor) => (
                <SensorCard
                  key={sensor.id}
                  sensor={sensor}
                  fieldValues={values[sensor.id] ?? {}}
                  onDelete={handleDelete}
                  onDragStart={handleDragStart}
                  isDragging={dragging === sensor.id}
                />
              ))}
            </section>
          )}
        </main>

        <footer className="footer">
          <div className="footer-inner">
            <span className="footer-brand">PiSense</span>
            <span className="footer-sep">&bull;</span>
            <span>Powered by Raspberry Pi</span>
            <span className="footer-sep">&bull;</span>
            <span className="footer-time">
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
          </div>
        </footer>
      </div>

      {showModal && (
        <AddSensorModal
          onClose={() => setShowModal(false)}
          onAdded={() => refreshSensors()}
        />
      )}
    </div>
  )
}

export default App
