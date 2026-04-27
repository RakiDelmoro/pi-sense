import type { SensorConfig } from "./types";

const STORAGE_KEY = "pi-sense-sensors";
const THEME_KEY = "pi-sense-theme";

export function loadSensors(): SensorConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SensorConfig[];
  } catch {
    return [];
  }
}

export function saveSensors(sensors: SensorConfig[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sensors));
}

export function addSensor(sensor: SensorConfig): void {
  const sensors = loadSensors();
  sensors.push(sensor);
  saveSensors(sensors);
}

export function removeSensor(id: string): void {
  const sensors = loadSensors().filter((s) => s.id !== id);
  saveSensors(sensors);
}

export function loadTheme(): "light" | "dark" {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === "dark" || raw === "light") return raw;
  } catch { /* ignore */ }
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

export function saveTheme(theme: "light" | "dark"): void {
  localStorage.setItem(THEME_KEY, theme);
}
