import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'

export interface SensorSettings {
  min: number
  max: number
  unit: string
}

export interface FieldConfig {
  id: string
  jsonKey: string
  label: string
  widgetType: 'gauge' | 'flow' | 'numeric' | 'status'
  settings: SensorSettings
}

export interface Position {
  x: number
  y: number
}

export interface SensorConfig {
  id: string
  label: string
  topic: string
  payloadType: 'plain' | 'json'
  fields: FieldConfig[]
  position?: Position
}

// Legacy interface for migration
interface LegacySensorConfig {
  id: string
  label: string
  topic: string
  payloadType: 'plain' | 'json'
  jsonPath?: string
  widgetType?: 'gauge' | 'flow' | 'numeric' | 'status'
  settings?: SensorSettings
  fields?: FieldConfig[]
  position?: Position
}

const DATA_FILE = resolve('backend/data/sensors.json')

function migrateLegacy(sensors: LegacySensorConfig[]): SensorConfig[] {
  return sensors.map((s) => {
    if (Array.isArray(s.fields) && s.fields.length > 0) {
      return s as SensorConfig
    }
    // Migrate old format
    const field: FieldConfig = {
      id: randomUUID(),
      jsonKey: s.payloadType === 'json' ? (s.jsonPath ?? '') : '',
      label: s.label,
      widgetType: s.widgetType ?? 'numeric',
      settings: s.settings ?? { min: 0, max: 100, unit: '' },
    }
    return {
      id: s.id,
      label: s.label,
      topic: s.topic,
      payloadType: s.payloadType,
      fields: [field],
      position: s.position,
    }
  })
}

function ensureFile(): SensorConfig[] {
  if (!existsSync(DATA_FILE)) {
    writeFileSync(DATA_FILE, JSON.stringify([], null, 2))
    return []
  }
  try {
    const raw = readFileSync(DATA_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as LegacySensorConfig[]
    const migrated = migrateLegacy(parsed)
    // If migration happened, save back
    if (JSON.stringify(parsed) !== JSON.stringify(migrated)) {
      saveFile(migrated)
      console.log('[store] Migrated old sensors.json to new format')
    }
    return migrated
  } catch {
    writeFileSync(DATA_FILE, JSON.stringify([], null, 2))
    return []
  }
}

function saveFile(sensors: SensorConfig[]) {
  writeFileSync(DATA_FILE, JSON.stringify(sensors, null, 2))
}

export function getAllSensors(): SensorConfig[] {
  return ensureFile()
}

export function getSensorById(id: string): SensorConfig | undefined {
  return ensureFile().find((s) => s.id === id)
}

export function getSensorByTopic(topic: string): SensorConfig | undefined {
  return ensureFile().find((s) => s.topic === topic)
}

export function addSensor(partial: Omit<SensorConfig, 'id'>): SensorConfig {
  const sensors = ensureFile()
  const sensor: SensorConfig = {
    ...partial,
    id: randomUUID(),
  }
  sensors.push(sensor)
  saveFile(sensors)
  return sensor
}

export function updateSensor(id: string, updates: Partial<Omit<SensorConfig, 'id'>>): SensorConfig | null {
  const sensors = ensureFile()
  const idx = sensors.findIndex((s) => s.id === id)
  if (idx === -1) return null
  sensors[idx] = { ...sensors[idx], ...updates }
  saveFile(sensors)
  return sensors[idx]
}

export function deleteSensor(id: string): SensorConfig | null {
  const sensors = ensureFile()
  const idx = sensors.findIndex((s) => s.id === id)
  if (idx === -1) return null
  const removed = sensors.splice(idx, 1)[0]
  saveFile(sensors)
  return removed
}
