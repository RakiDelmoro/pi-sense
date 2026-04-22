import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'
import { useSensors } from './hooks/useSensors'
import { WidgetRenderer } from './components/WidgetRenderer'
import { AddSensorModal } from './components/AddSensorModal'
import { deleteSensor, updateSensorPosition } from './api/sensors'
import type { SensorConfig, FieldConfig, Position } from './api/sensors'
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

function FieldWidget({ field, value }: { field: FieldConfig; value: number }) {
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
  pixelX,
  pixelY,
  registerCard,
}: {
  sensor: SensorConfig
  fieldValues: Record<string, number>
  onDelete: (id: string) => void
  onDragStart: (e: React.MouseEvent | React.TouchEvent, id: string) => void
  isDragging: boolean
  pixelX: number
  pixelY: number
  registerCard: (id: string, el: HTMLDivElement | null) => void
}) {
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
      ref={(el) => registerCard(sensor.id, el)}
      className={`card sensor-card ${isDragging ? 'dragging' : ''}`}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transform: `translate(${pixelX}px, ${pixelY}px)`,
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

interface DragState {
  id: string
  offsetX: number
  offsetY: number
}

function pctToPixel(pct: Position, canvasW: number, canvasH: number, cardW: number, cardH: number) {
  const maxX = Math.max(0, canvasW - cardW)
  const maxY = Math.max(0, canvasH - cardH)
  return {
    x: (pct.x / 100) * maxX,
    y: (pct.y / 100) * maxY,
  }
}

function pixelToPct(pixelX: number, pixelY: number, canvasW: number, canvasH: number, cardW: number, cardH: number): Position {
  const maxX = Math.max(1, canvasW - cardW)
  const maxY = Math.max(1, canvasH - cardH)
  return {
    x: Math.max(0, Math.min(100, (pixelX / maxX) * 100)),
    y: Math.max(0, Math.min(100, (pixelY / maxY) * 100)),
  }
}

function App() {
  const { sensors, values, socketStatus, mqttStatus, loading, refreshSensors } = useSensors()
  const [showModal, setShowModal] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  const cardElements = useRef<Map<string, HTMLDivElement>>(new Map())
  const dragState = useRef<DragState | null>(null)
  const sensorsRef = useRef(sensors)
  sensorsRef.current = sensors

  const positionAllCards = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const canvasRect = canvas.getBoundingClientRect()

    sensorsRef.current.forEach((sensor) => {
      const el = cardElements.current.get(sensor.id)
      if (!el) return
      const cardRect = el.getBoundingClientRect()
      const pct = sensor.position ?? { x: 50, y: 50 }
      const pixel = pctToPixel(pct, canvasRect.width, canvasRect.height, cardRect.width, cardRect.height)
      el.style.transform = `translate(${pixel.x}px, ${pixel.y}px)`
    })
  }, [])

  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent, id: string) => {
    const el = cardElements.current.get(id)
    const canvas = canvasRef.current
    if (!el || !canvas) return

    const style = window.getComputedStyle(el)
    const matrix = new DOMMatrix(style.transform)
    const currentX = matrix.m41
    const currentY = matrix.m42

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

    dragState.current = {
      id,
      offsetX: clientX - currentX,
      offsetY: clientY - currentY,
    }
    setDragging(id)
  }, [])

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!dragState.current) return
    const { id, offsetX, offsetY } = dragState.current

    const el = cardElements.current.get(id)
    const canvas = canvasRef.current
    if (!el || !canvas) return

    const canvasRect = canvas.getBoundingClientRect()
    const cardRect = el.getBoundingClientRect()

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

    let x = clientX - canvasRect.left - offsetX
    let y = clientY - canvasRect.top - offsetY

    const maxX = Math.max(0, canvasRect.width - cardRect.width)
    const maxY = Math.max(0, canvasRect.height - cardRect.height)

    x = Math.max(0, Math.min(maxX, x))
    y = Math.max(0, Math.min(maxY, y))

    el.style.transform = `translate(${x}px, ${y}px)`
  }, [])

  const handleDragEnd = useCallback(() => {
    if (!dragState.current) return
    const { id } = dragState.current

    const el = cardElements.current.get(id)
    const canvas = canvasRef.current
    if (!el || !canvas) return

    const style = window.getComputedStyle(el)
    const matrix = new DOMMatrix(style.transform)
    const pixelX = matrix.m41
    const pixelY = matrix.m42

    const canvasRect = canvas.getBoundingClientRect()
    const cardRect = el.getBoundingClientRect()

    const pct = pixelToPct(pixelX, pixelY, canvasRect.width, canvasRect.height, cardRect.width, cardRect.height)

    updateSensorPosition(id, pct).catch((err) => {
      console.error('Failed to save position:', err)
    })

    dragState.current = null
    setDragging(null)
  }, [])

  useEffect(() => {
    if (!dragState.current) return
    window.addEventListener('mousemove', handleDragMove)
    window.addEventListener('mouseup', handleDragEnd)
    window.addEventListener('touchmove', handleDragMove, { passive: false })
    window.addEventListener('touchend', handleDragEnd)
    return () => {
      window.removeEventListener('mousemove', handleDragMove)
      window.removeEventListener('mouseup', handleDragEnd)
      window.removeEventListener('touchmove', handleDragMove)
      window.removeEventListener('touchend', handleDragEnd)
    }
  }, [handleDragMove, handleDragEnd])

  useEffect(() => {
    requestAnimationFrame(positionAllCards)
  }, [sensors, positionAllCards])

  useEffect(() => {
    const handleResize = () => {
      requestAnimationFrame(positionAllCards)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [positionAllCards])

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
          ref={canvasRef}
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
              {sensors.map((sensor) => {
                const pct = sensor.position ?? { x: 50, y: 50 }
                const canvas = canvasRef.current
                const el = cardElements.current.get(sensor.id)
                let pixelX = 0
                let pixelY = 0
                if (canvas && el) {
                  const cRect = canvas.getBoundingClientRect()
                  const cardRect = el.getBoundingClientRect()
                  const p = pctToPixel(pct, cRect.width, cRect.height, cardRect.width, cardRect.height)
                  pixelX = p.x
                  pixelY = p.y
                }
                return (
                  <SensorCard
                    key={sensor.id}
                    sensor={sensor}
                    fieldValues={values[sensor.id] ?? {}}
                    onDelete={handleDelete}
                    onDragStart={handleDragStart}
                    isDragging={dragging === sensor.id}
                    pixelX={pixelX}
                    pixelY={pixelY}
                    registerCard={(id, el) => {
                      if (el) cardElements.current.set(id, el)
                      else cardElements.current.delete(id)
                    }}
                  />
                )
              })}
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
