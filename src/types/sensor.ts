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
  /** Section this card belongs to (e.g. 'sensors', 'lights'). Defaults to 'sensors'. */
  section?: string;
  /** Ordering layout weight on the dashboard. Lower numbers render first (e.g. 10, 20, 30...) */
  layoutWeight?: number;
  [key: string]: unknown;
}
