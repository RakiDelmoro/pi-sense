import { describe, it, expect } from "bun:test";
import { extractValue } from "../src/client/payload";
import type { SensorConfig } from "../src/client/types";

function makeConfig(overrides: Partial<SensorConfig> = {}): SensorConfig {
  return {
    id: "test-id",
    topic: "home/test",
    label: "Test",
    payloadType: "plain",
    jsonPath: "",
    widgetType: "text",
    unit: "",
    min: 0,
    max: 100,
    ...overrides,
  };
}

describe("extractValue", () => {
  it("returns plain text as-is", () => {
    const cfg = makeConfig({ payloadType: "plain" });
    const result = extractValue(cfg, "hello world");
    expect(result.value).toBe("hello world");
    expect(result.topic).toBe("home/test");
    expect(result.rawPayload).toBe("hello world");
  });

  it("converts numeric plain text to number", () => {
    const cfg = makeConfig({ payloadType: "plain" });
    const result = extractValue(cfg, "22.5");
    expect(result.value).toBe(22.5);
  });

  it("converts integer plain text to number", () => {
    const cfg = makeConfig({ payloadType: "plain" });
    const result = extractValue(cfg, "42");
    expect(result.value).toBe(42);
  });

  it("parses simple JSON value", () => {
    const cfg = makeConfig({ payloadType: "json", jsonPath: "temperature" });
    const result = extractValue(cfg, '{"temperature": 25.3}');
    expect(result.value).toBe(25.3);
  });

  it("parses nested JSON path", () => {
    const cfg = makeConfig({ payloadType: "json", jsonPath: "dht22.humidity" });
    const result = extractValue(cfg, '{"dht22": {"humidity": 60}}');
    expect(result.value).toBe(60);
  });

  it("returns raw payload when JSON path not found", () => {
    const cfg = makeConfig({ payloadType: "json", jsonPath: "missing" });
    const result = extractValue(cfg, '{"temperature": 20}');
    expect(result.value).toBe('{"temperature": 20}');
  });

  it("returns raw payload when JSON is invalid", () => {
    const cfg = makeConfig({ payloadType: "json", jsonPath: "key" });
    const result = extractValue(cfg, "not json");
    expect(result.value).toBe("not json");
  });

  it("stringifies JSON when no path given", () => {
    const cfg = makeConfig({ payloadType: "json", jsonPath: "" });
    const result = extractValue(cfg, '{"a": 1}');
    expect(result.value).toBe('{"a":1}');
  });

  it("handles boolean-like string in plain mode", () => {
    const cfg = makeConfig({ payloadType: "plain" });
    const result = extractValue(cfg, "true");
    expect(result.value).toBe("true");
  });

  it("handles switch ON payload", () => {
    const cfg = makeConfig({ payloadType: "plain", widgetType: "switch" });
    const result = extractValue(cfg, "ON");
    expect(result.value).toBe("ON");
  });

  it("handles switch OFF payload", () => {
    const cfg = makeConfig({ payloadType: "plain", widgetType: "switch" });
    const result = extractValue(cfg, "OFF");
    expect(result.value).toBe("OFF");
  });

  it("handles deeply nested JSON", () => {
    const cfg = makeConfig({ payloadType: "json", jsonPath: "a.b.c" });
    const result = extractValue(cfg, '{"a": {"b": {"c": 99}}}');
    expect(result.value).toBe(99);
  });

  it("handles empty payload gracefully", () => {
    const cfg = makeConfig({ payloadType: "plain" });
    const result = extractValue(cfg, "");
    expect(result.value).toBe("");
  });
});
