import type { SensorConfig, SensorReading } from "./types";

export function extractValue(cfg: SensorConfig, payload: string): SensorReading {
  let value: string | number | boolean = payload;

  if (cfg.payloadType === "json") {
    try {
      const parsed = JSON.parse(payload);
      if (cfg.jsonPath) {
        const keys = cfg.jsonPath.split(".");
        let current: unknown = parsed;
        for (const key of keys) {
          if (current && typeof current === "object" && key in current) {
            current = (current as Record<string, unknown>)[key];
          } else {
            current = undefined;
            break;
          }
        }
        value = current !== undefined ? String(current) : payload;
      } else {
        value = JSON.stringify(parsed);
      }
    } catch {
      value = payload;
    }
  }

  const num = Number(value);
  if (!Number.isNaN(num) && String(value).trim() !== "") {
    value = num;
  }

  return {
    topic: cfg.topic,
    value,
    rawPayload: payload,
    timestamp: Date.now(),
  };
}
