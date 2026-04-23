import { useState } from 'react'
import { createSensor } from '../api/sensors.ts'
import type { FieldConfig } from '../api/sensors.ts'

interface AddSensorModalProps {
  onClose: () => void
  onAdded: () => void
  dockNewSensor?: boolean
}

const WIDGET_TYPES: { value: FieldConfig['widgetType']; label: string }[] = [
  { value: 'gauge', label: 'Gauge' },
  { value: 'flow', label: 'Flow Indicator' },
  { value: 'numeric', label: 'Numeric Display' },
  { value: 'status', label: 'Status (On/Off)' },
]

function makeDefaultField(): FieldConfig {
  return {
    id: crypto.randomUUID(),
    jsonKey: '',
    label: '',
    widgetType: 'gauge',
    settings: { min: 0, max: 100, unit: '' },
  }
}

export function AddSensorModal({ onClose, onAdded, dockNewSensor }: AddSensorModalProps) {
  const [label, setLabel] = useState('')
  const [topic, setTopic] = useState('')
  const [payloadType, setPayloadType] = useState<'plain' | 'json'>('plain')
  const [fields, setFields] = useState<FieldConfig[]>([makeDefaultField()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function addField() {
    if (fields.length >= 4) return
    setFields((prev) => [...prev, makeDefaultField()])
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index))
  }

  function updateField(index: number, updates: Partial<FieldConfig>) {
    setFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...updates } : f))
    )
  }

  function updateFieldSettings(index: number, updates: Partial<FieldConfig['settings']>) {
    setFields((prev) =>
      prev.map((f, i) =>
        i === index ? { ...f, settings: { ...f.settings, ...updates } } : f
      )
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!label.trim() || !topic.trim()) {
      setError('Label and topic are required')
      return
    }
    if (fields.length === 0) {
      setError('At least one field is required')
      return
    }
    if (payloadType === 'json' && fields.length > 4) {
      setError('Maximum 4 fields allowed for JSON payloads')
      return
    }
    if (payloadType === 'plain' && fields.length !== 1) {
      setError('Plain number payloads support exactly 1 field')
      return
    }

    for (const field of fields) {
      if (!field.label.trim()) {
        setError('Each field must have a display label')
        return
      }
      if (payloadType === 'json' && !field.jsonKey.trim()) {
        setError('Each JSON field must have a JSON Key')
        return
      }
    }

    setLoading(true)
    try {
      await createSensor({
        label: label.trim(),
        topic: topic.trim(),
        payloadType,
        fields: fields.map((f) => ({
          ...f,
          jsonKey: payloadType === 'json' ? f.jsonKey.trim() : '',
          label: f.label.trim(),
        })),
        placed: dockNewSensor ? false : true,
        position: dockNewSensor ? { x: 50, y: 0 } : { x: 50, y: 50 },
      })
      onAdded()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add sensor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Add Sensor</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          {error && <div className="modal-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="sensor-label">Sensor Label</label>
            <input
              id="sensor-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Weather Station"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="sensor-topic">MQTT Topic</label>
            <input
              id="sensor-topic"
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. esp/weather"
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="sensor-payload">Payload Type</label>
              <select
                id="sensor-payload"
                value={payloadType}
                onChange={(e) => {
                  const pt = e.target.value as 'plain' | 'json'
                  setPayloadType(pt)
                  if (pt === 'plain') {
                    setFields([makeDefaultField()])
                  }
                }}
              >
                <option value="plain">Plain Number</option>
                <option value="json">JSON</option>
              </select>
            </div>
          </div>

          <div className="fields-section">
            <div className="fields-header">
              <label>Fields</label>
              {payloadType === 'json' && fields.length < 4 && (
                <button type="button" className="btn btn-sm btn-secondary" onClick={addField}>
                  + Add Field
                </button>
              )}
            </div>

            {fields.map((field, index) => (
              <div key={field.id} className="field-row">
                <div className="field-row-header">
                  <span className="field-number">Field {index + 1}</span>
                  {fields.length > 1 && (
                    <button
                      type="button"
                      className="field-remove"
                      onClick={() => removeField(index)}
                      title="Remove field"
                    >
                      &times;
                    </button>
                  )}
                </div>

                <div className="form-row">
                  {payloadType === 'json' && (
                    <div className="form-group">
                      <label>JSON Key</label>
                      <input
                        type="text"
                        value={field.jsonKey}
                        onChange={(e) => updateField(index, { jsonKey: e.target.value })}
                        placeholder="e.g. water-level"
                        required
                      />
                    </div>
                  )}
                  <div className="form-group">
                    <label>Display Label</label>
                    <input
                      type="text"
                      value={field.label}
                      onChange={(e) => updateField(index, { label: e.target.value })}
                      placeholder="e.g. Temperature"
                      required
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Widget</label>
                    <select
                      value={field.widgetType}
                      onChange={(e) =>
                        updateField(index, { widgetType: e.target.value as FieldConfig['widgetType'] })
                      }
                    >
                      {WIDGET_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Min</label>
                    <input
                      type="number"
                      step="any"
                      value={field.settings.min}
                      onChange={(e) =>
                        updateFieldSettings(index, { min: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Max</label>
                    <input
                      type="number"
                      step="any"
                      value={field.settings.max}
                      onChange={(e) =>
                        updateFieldSettings(index, { max: parseFloat(e.target.value) || 100 })
                      }
                    />
                  </div>
                  <div className="form-group">
                    <label>Unit</label>
                    <input
                      type="text"
                      value={field.settings.unit}
                      onChange={(e) => updateFieldSettings(index, { unit: e.target.value })}
                      placeholder="%"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Adding...' : 'Add Sensor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
