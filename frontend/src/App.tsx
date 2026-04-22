import { useState, useEffect, useRef } from 'react'
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
}: {
  sensor: SensorConfig
  fieldValues: Record<string, number>
  onDelete: (id: string) => void
  onDragStart: (e: React.MouseEvent | React.TouchEvent, id: string) => void
  isDragging: boolean
}) {
  return (
    <div
      data-sensor-id={sensor.id}
      className={`card sensor-card ${isDragging ? 'dragging' : ''}`}
      style={{ position: 'absolute', left: 0, top: 0 }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('.sensor-delete')) return
        e.preventDefault()
        onDragStart(e, sensor.id)
      }}
      onTouchStart={(e) => {
        if ((e.target as HTMLElement).closest('.sensor-delete')) return
        onDragStart(e, sensor.id)
      }}
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

const GAP = 20

function pctToPixel(pct: Position, canvasW: number, canvasH: number, cardW: number, cardH: number) {
  const availW = Math.max(1, canvasW - cardW - GAP * 2)
  const availH = Math.max(1, canvasH - cardH - GAP * 2)
  return {
    x: GAP + (pct.x / 100) * availW,
    y: GAP + (pct.y / 100) * availH,
  }
}

function pixelToPct(pixelX: number, pixelY: number, canvasW: number, canvasH: number, cardW: number, cardH: number): Position {
  const availW = Math.max(1, canvasW - cardW - GAP * 2)
  const availH = Math.max(1, canvasH - cardH - GAP * 2)
  return {
    x: Math.max(0, Math.min(100, ((pixelX - GAP) / availW) * 100)),
    y: Math.max(0, Math.min(100, ((pixelY - GAP) / availH) * 100)),
  }
}

interface DragState {
  id: string
  startX: number
  startY: number
  startMouseX: number
  startMouseY: number
}

function App() {
  const { sensors, values, socketStatus, mqttStatus, loading, refreshSensors } = useSensors()
  const [showModal, setShowModal] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<DragState | null>(null)
  const positionedRef = useRef<Set<string>>(new Set())

  // Position all cards (initial or after resize)
  const positionCards = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const canvasRect = canvas.getBoundingClientRect()

    const placed: { x: number; y: number; w: number; h: number }[] = []

    sensors.forEach((sensor) => {
      // Find the card element by data-id attribute
      const el = canvas.querySelector(`[data-sensor-id="${sensor.id}"]`) as HTMLElement | null
      if (!el) return

      const cardRect = el.getBoundingClientRect()
      const pct = sensor.position ?? { x: 50, y: 50 }
      let pixel = pctToPixel(pct, canvasRect.width, canvasRect.height, cardRect.width, cardRect.height)

      // Overlap nudge
      let attempts = 0
      while (attempts < 10) {
        const overlaps = placed.some((p) =>
          pixel.x < p.x + p.w + 16 &&
          pixel.x + cardRect.width > p.x - 16 &&
          pixel.y < p.y + p.h + 16 &&
          pixel.y + cardRect.height > p.y - 16
        )
        if (!overlaps) break
        pixel.x += 40
        pixel.y += 40
        const maxX = Math.max(GAP, canvasRect.width - cardRect.width - GAP)
        const maxY = Math.max(GAP, canvasRect.height - cardRect.height - GAP)
        if (pixel.x > maxX) { pixel.x = GAP; pixel.y += 40 }
        if (pixel.y > maxY) pixel.y = maxY
        attempts++
      }

      el.style.transform = `translate(${pixel.x}px, ${pixel.y}px)`
      positionedRef.current.add(sensor.id)
      placed.push({ x: pixel.x, y: pixel.y, w: cardRect.width, h: cardRect.height })
    })
  }

  // Initial positioning
  useEffect(() => {
    if (sensors.length > 0 && positionedRef.current.size === 0) {
      requestAnimationFrame(positionCards)
    }
  }, [sensors])

  // Resize
  useEffect(() => {
    const onResize = () => {
      positionedRef.current.clear()
      requestAnimationFrame(positionCards)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Drag handlers
  const handleDragStart = (e: React.MouseEvent | React.TouchEvent, id: string) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const el = canvas.querySelector(`[data-sensor-id="${id}"]`) as HTMLElement | null
    if (!el) return

    // Read current position from DOM
    const style = window.getComputedStyle(el)
    const matrix = new DOMMatrix(style.transform)
    let startX = matrix.m41
    let startY = matrix.m42

    // Fallback if no transform yet
    if (startX === 0 && startY === 0) {
      const sensor = sensors.find((s) => s.id === id)
      if (sensor) {
        const canvasRect = canvas.getBoundingClientRect()
        const cardRect = el.getBoundingClientRect()
        const p = pctToPixel(sensor.position ?? { x: 50, y: 50 }, canvasRect.width, canvasRect.height, cardRect.width, cardRect.height)
        startX = p.x
        startY = p.y
        el.style.transform = `translate(${startX}px, ${startY}px)`
        positionedRef.current.add(id)
      }
    }

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

    dragState.current = { id, startX, startY, startMouseX: clientX, startMouseY: clientY }
    setDragging(id)
  }

  const handleDragMove = (e: MouseEvent | TouchEvent) => {
    if (!dragState.current) return
    const { id, startX, startY, startMouseX, startMouseY } = dragState.current

    const canvas = canvasRef.current
    if (!canvas) return
    const el = canvas.querySelector(`[data-sensor-id="${id}"]`) as HTMLElement | null
    if (!el) return

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY

    const dx = clientX - startMouseX
    const dy = clientY - startMouseY

    let x = startX + dx
    let y = startY + dy

    const canvasRect = canvas.getBoundingClientRect()
    const cardRect = el.getBoundingClientRect()

    const minX = GAP
    const maxX = Math.max(GAP, canvasRect.width - cardRect.width - GAP)
    const minY = GAP
    const maxY = Math.max(GAP, canvasRect.height - cardRect.height - GAP)

    x = Math.max(minX, Math.min(maxX, x))
    y = Math.max(minY, Math.min(maxY, y))

    el.style.transform = `translate(${x}px, ${y}px)`
  }

  const handleDragEnd = () => {
    if (!dragState.current) return
    const { id } = dragState.current

    const canvas = canvasRef.current
    if (!canvas) return
    const el = canvas.querySelector(`[data-sensor-id="${id}"]`) as HTMLElement | null
    if (!el) return

    const style = window.getComputedStyle(el)
    const matrix = new DOMMatrix(style.transform)
    const currentX = matrix.m41
    const currentY = matrix.m42

    const canvasRect = canvas.getBoundingClientRect()
    const cardRect = el.getBoundingClientRect()

    const pct = pixelToPct(currentX, currentY, canvasRect.width, canvasRect.height, cardRect.width, cardRect.height)

    updateSensorPosition(id, pct).catch((err) => {
      console.error('Failed to save position:', err)
    })

    dragState.current = null
    setDragging(null)
  }

  // Attach/detach global mouse/touch listeners based on dragging state
  useEffect(() => {
    if (!dragging) return
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
  }, [dragging])

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
