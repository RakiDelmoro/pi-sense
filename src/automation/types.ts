export interface AutomationConfig {
  slug: string;
  label: string;
  topic: string;
  /** JSON key to extract the numeric value from MQTT payloads (default: 'value') */
  valueKey?: string;
  enabled?: boolean;
  /** Optional short description shown in the dashboard. */
  description?: string;
}

export interface AutomationContext {
  value: number;
  topic: string;
  raw: string;
  timestamp: string;
}

export type ActionResult =
  | { type: 'hue'; lightId: string | number; state: Record<string, unknown> }
  | { type: 'webhook'; url: string; method?: string; body?: unknown }
  | { type: 'log'; message: string }
  | null;

export interface AutomationRule extends AutomationConfig {
  evaluate(ctx: AutomationContext): ActionResult | ActionResult[] | null;
}
