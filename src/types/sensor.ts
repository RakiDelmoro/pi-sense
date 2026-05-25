export interface SensorConfig {
  slug: string;
  label: string;
  topic: string;
  unit?: string;
  min?: number;
  max?: number;
  decimals?: number;
  [key: string]: unknown;
}
