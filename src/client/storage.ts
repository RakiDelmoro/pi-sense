import type { SensorConfig } from "./types";
import type { DataPoint } from "./chart";

const STORAGE_KEY = "pi-sense-sensors";
const THEME_KEY = "pi-sense-theme";
const HISTORY_KEY = "pi-sense-history";

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

export function loadHistory(): Record<string, DataPoint[]> {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, DataPoint[]>;
  } catch {
    return {};
  }
}

export function saveHistory(history: Record<string, DataPoint[]>): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function addHistoryPoint(sensorId: string, point: DataPoint): void {
  const history = loadHistory();
  if (!history[sensorId]) history[sensorId] = [];
  history[sensorId].push(point);
  if (history[sensorId].length > 120) history[sensorId].shift();
  saveHistory(history);
}

export function removeHistory(sensorId: string): void {
  const history = loadHistory();
  delete history[sensorId];
  saveHistory(history);
}

export function clearHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}
