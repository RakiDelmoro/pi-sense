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

const API_BASE = import.meta.env.VITE_API_URL || ''

export async function fetchSensors(): Promise<SensorConfig[]> {
  const res = await fetch(`${API_BASE}/api/sensors`)
  if (!res.ok) throw new Error('Failed to fetch sensors')
  return res.json()
}

export async function createSensor(sensor: Omit<SensorConfig, 'id'>): Promise<SensorConfig> {
  const res = await fetch(`${API_BASE}/api/sensors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sensor),
  })
  if (!res.ok) throw new Error('Failed to create sensor')
  return res.json()
}

export async function updateSensor(id: string, updates: Partial<Omit<SensorConfig, 'id'>>): Promise<SensorConfig> {
  const res = await fetch(`${API_BASE}/api/sensors/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new Error('Failed to update sensor')
  return res.json()
}

export async function updateSensorPosition(id: string, position: Position): Promise<SensorConfig> {
  const res = await fetch(`${API_BASE}/api/sensors/${id}/position`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(position),
  })
  if (!res.ok) throw new Error('Failed to update position')
  return res.json()
}

export async function deleteSensor(id: string): Promise<SensorConfig> {
  const res = await fetch(`${API_BASE}/api/sensors/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete sensor')
  return res.json()
}
