import { useState } from 'react'
import './App.css'
import { useSensors } from './hooks/useSensors'
import { WidgetRenderer } from './components/WidgetRenderer'
import { AddSensorModal } from './components/AddSensorModal'
import { deleteSensor } from './api/sensors'
import type { SensorConfig, FieldConfig } from './api/sensors'
import { NetworkBackground } from './components/NetworkBackground'
import { StatusIndicator } from './components/widgets/StatusIndicator'

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
}: {
  sensor: SensorConfig
  fieldValues: Record<string, number>
  onDelete: (id: string) => void
}) {
  return (
    <div className="card sensor-card">
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

  const systemStatus = socketStatus === 'connected' && mqttStatus === 'connected' ? 'connected' : 'disconnected'

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
              <div>
                <h1 className="title">PiSense Home</h1>
              </div>
            </div>
            <div className="header-status-group">
              <StatusIndicator value={systemStatus === 'connected' ? 1 : 0} label="System" />
            </div>
          </div>
        </header>

        <main className="main">
          {loading ? (
            <div className="empty-state">
              <div className="loading-spinner" />
              <p>Loading sensors...</p>
            </div>
          ) : sensors.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a10 10 0 100 20 10 10 0 000-20z" />
                  <path d="M12 8v8M8 12h8" />
                </svg>
              </div>
              <h2>No Sensors Yet</h2>
              <p>Add your first sensor to start monitoring MQTT data.</p>
              <button className="btn btn-primary add-sensor-btn" onClick={() => setShowModal(true)}>
                Add Sensor
              </button>
            </div>
          ) : (
            <>
              <div className="toolbar">
                <button className="btn btn-primary add-sensor-btn" onClick={() => setShowModal(true)}>
                  + Add Sensor
                </button>
              </div>
              <section className="status-grid">
                {sensors.map((sensor) => (
                  <SensorCard
                    key={sensor.id}
                    sensor={sensor}
                    fieldValues={values[sensor.id] ?? {}}
                    onDelete={handleDelete}
                  />
                ))}
              </section>
            </>
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
