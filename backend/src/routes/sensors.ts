import { Router } from 'express'
import express from 'express'
import {
  getAllSensors,
  getSensorById,
  addSensor,
  updateSensor,
  deleteSensor,
} from '../store/sensorStore.js'
import type { MqttManager } from '../mqtt/mqttManager.js'
import type { FieldConfig, SensorConfig } from '../store/sensorStore.js'

function validateFields(payloadType: string, fields: unknown[]): { valid: boolean; error?: string; normalized?: FieldConfig[] } {
  if (!Array.isArray(fields) || fields.length === 0) {
    return { valid: false, error: 'At least one field is required' }
  }
  if (payloadType === 'json' && fields.length > 4) {
    return { valid: false, error: 'Maximum 4 fields allowed for JSON payloads' }
  }
  if (payloadType === 'plain' && fields.length !== 1) {
    return { valid: false, error: 'Plain number payloads support exactly 1 field' }
  }

  const normalized: FieldConfig[] = []
  for (const f of fields) {
    const field = f as Record<string, unknown>
    if (payloadType === 'json' && (!field.jsonKey || typeof field.jsonKey !== 'string')) {
      return { valid: false, error: 'Each JSON field must have a jsonKey' }
    }
    if (!field.label || typeof field.label !== 'string') {
      return { valid: false, error: 'Each field must have a label' }
    }
    if (!field.widgetType || !['gauge', 'flow', 'numeric', 'status'].includes(field.widgetType as string)) {
      return { valid: false, error: 'Each field must have a valid widgetType' }
    }
    const settings = field.settings as Record<string, unknown> | undefined
    normalized.push({
      id: typeof field.id === 'string' ? field.id : crypto.randomUUID(),
      jsonKey: (field.jsonKey as string) ?? '',
      label: field.label as string,
      widgetType: field.widgetType as FieldConfig['widgetType'],
      settings: {
        min: typeof settings?.min === 'number' ? settings.min : 0,
        max: typeof settings?.max === 'number' ? settings.max : 100,
        unit: typeof settings?.unit === 'string' ? settings.unit : '',
      },
    })
  }

  return { valid: true, normalized }
}

export function createSensorRoutes(mqttManager: MqttManager): Router {
  const router = Router()
  router.use(express.json())

  router.get('/', (_req, res) => {
    res.json(getAllSensors())
  })

  router.get('/:id', (req, res) => {
    const sensor = getSensorById(req.params.id)
    if (!sensor) return res.status(404).json({ error: 'Sensor not found' })
    res.json(sensor)
  })

  router.post('/', (req, res) => {
    const { label, topic, payloadType, fields } = req.body as Partial<SensorConfig>

    if (!label || !topic || !payloadType) {
      return res.status(400).json({ error: 'Missing required fields: label, topic, payloadType' })
    }

    const validation = validateFields(payloadType, fields as unknown[])
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error })
    }

    const sensor = addSensor({
      label,
      topic,
      payloadType,
      fields: validation.normalized!,
    })

    mqttManager.subscribeTopic(sensor.topic)
    res.status(201).json(sensor)
  })

  router.put('/:id', (req, res) => {
    const { label, topic, payloadType, fields } = req.body as Partial<SensorConfig>
    const existing = getSensorById(req.params.id)
    if (!existing) return res.status(404).json({ error: 'Sensor not found' })

    const oldTopic = existing.topic

    const updates: Parameters<typeof updateSensor>[1] = {}
    if (label !== undefined) updates.label = label
    if (topic !== undefined) updates.topic = topic
    if (payloadType !== undefined) updates.payloadType = payloadType
    if (fields !== undefined) {
      const validation = validateFields(payloadType ?? existing.payloadType, fields as unknown[])
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error })
      }
      updates.fields = validation.normalized
    }

    const updated = updateSensor(req.params.id, updates)
    if (!updated) return res.status(404).json({ error: 'Sensor not found' })

    if (oldTopic !== updated.topic) {
      mqttManager.unsubscribeTopic(oldTopic)
      mqttManager.subscribeTopic(updated.topic)
    }

    res.json(updated)
  })

  router.delete('/:id', (req, res) => {
    const sensor = deleteSensor(req.params.id)
    if (!sensor) return res.status(404).json({ error: 'Sensor not found' })
    mqttManager.unsubscribeTopic(sensor.topic)
    res.json(sensor)
  })

  return router
}
