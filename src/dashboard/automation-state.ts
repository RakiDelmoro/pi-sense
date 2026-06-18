// In-memory mirror of automation enabled state, sourced from retained
// `automations/<slug>/enabled` MQTT messages. The dashboard subscribes to that
// topic and updates this map; getAutomations() reads it for display.
// Authoritative state lives in the retained MQTT message, not here.

const automationEnabled = new Map<string, boolean>();

export function getAutomationEnabled(slug: string): boolean | undefined {
  return automationEnabled.get(slug);
}

export function setAutomationEnabledState(slug: string, enabled: boolean): void {
  automationEnabled.set(slug, enabled);
}
