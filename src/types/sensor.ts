export interface SensorConfig {
  slug: string;
  label: string;
  topic: string;
  unit?: string;
  min?: number;
  max?: number;
  decimals?: number;
  /** JSON key to extract the numeric value from MQTT payloads (default: 'value') */
  valueKey?: string;
  [key: string]: unknown;
}
