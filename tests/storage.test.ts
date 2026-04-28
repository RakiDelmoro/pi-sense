import { describe, it, expect, beforeEach } from "bun:test";

// Mock localStorage before importing storage module
const storage: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem(key: string) {
    return storage[key] ?? null;
  },
  setItem(key: string, value: string) {
    storage[key] = value;
  },
  removeItem(key: string) {
    delete storage[key];
  },
  clear() {
    for (const key of Object.keys(storage)) {
      delete storage[key];
    }
  },
};

const { loadSensors, saveSensors, addSensor, removeSensor } = await import("../src/client/storage");
import type { SensorConfig } from "../src/client/types";

function makeSensor(id: string, topic: string): SensorConfig {
  return {
    id,
    topic,
    label: topic,
    payloadType: "plain",
    jsonPath: "",
    widgetType: "text",
    unit: "",
    min: 0,
    max: 100,
  };
}

describe("storage", () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
  });

  it("returns empty array when no sensors saved", () => {
    const sensors = loadSensors();
    expect(sensors).toEqual([]);
  });

  it("saves and loads sensors", () => {
    const sensors = [makeSensor("1", "home/a"), makeSensor("2", "home/b")];
    saveSensors(sensors);
    const loaded = loadSensors();
    expect(loaded).toEqual(sensors);
  });

  it("adds a sensor to existing list", () => {
    addSensor(makeSensor("1", "home/a"));
    addSensor(makeSensor("2", "home/b"));
    const loaded = loadSensors();
    expect(loaded.length).toBe(2);
    expect(loaded[0].id).toBe("1");
    expect(loaded[1].id).toBe("2");
  });

  it("removes a sensor by id", () => {
    saveSensors([makeSensor("1", "home/a"), makeSensor("2", "home/b")]);
    removeSensor("1");
    const loaded = loadSensors();
    expect(loaded.length).toBe(1);
    expect(loaded[0].id).toBe("2");
  });

  it("handles remove of non-existent id gracefully", () => {
    saveSensors([makeSensor("1", "home/a")]);
    removeSensor("999");
    const loaded = loadSensors();
    expect(loaded.length).toBe(1);
  });

  it("survives corrupted localStorage data", () => {
    (globalThis as any).localStorage.setItem("pi-sense-sensors", "not json");
    const loaded = loadSensors();
    expect(loaded).toEqual([]);
  });
});
