import type { SensorConfig, FieldConfig } from '../store/sensorStore.js'

export function parsePayload(sensor: SensorConfig, rawMessage: string): Record<string, number | null> {
  const trimmed = rawMessage.trim()
  const result: Record<string, number | null> = {}

  if (sensor.payloadType === 'plain') {
    const field = sensor.fields[0]
    if (!field) return result
    const value = parseFloat(trimmed)
    result[field.id] = isNaN(value) ? null : value
    return result
  }

  if (sensor.payloadType === 'json') {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      console.warn(`[parser] Invalid JSON on topic ${sensor.topic}: "${trimmed}"`)
      for (const field of sensor.fields) {
        result[field.id] = null
      }
      return result
    }

    for (const field of sensor.fields) {
      const value = getValueAtPath(parsed, field.jsonKey)
      if (typeof value === 'number') {
        result[field.id] = value
      } else if (typeof value === 'string') {
        const num = parseFloat(value)
        result[field.id] = isNaN(num) ? null : num
      } else if (typeof value === 'boolean') {
        result[field.id] = value ? 1 : 0
      } else {
        console.warn(`[parser] Could not resolve numeric value at key "${field.jsonKey}" for field ${field.id}`)
        result[field.id] = null
      }
    }
    return result
  }

  return result
}

function getValueAtPath(obj: unknown, path: string): unknown {
  const keys = path.split('.')
  let current: unknown = obj
  for (const key of keys) {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[key]
    } else {
      return undefined
    }
  }
  return current
}
