import type { SensorConfig } from "./types";
import { createWidget, type Widget } from "./widgets";
import { subscribe, unsubscribe, onMessage, onStatusChange } from "./mqtt";
import { loadSensors, saveSensors, addSensor, removeSensor, loadHistory, addHistoryPoint, removeHistory, clearHistory, loadLastValues, saveLastValue, removeLastValue, clearLastValues } from "./storage";
import { extractValue } from "./payload";
import { renderChart, type DataPoint } from "./chart";

let gridEl: HTMLElement;
let modalEl: HTMLElement;
let overlayEl: HTMLElement;
let chartOverlayEl: HTMLElement;
let chartOverlayInnerEl: HTMLElement;
const widgets = new Map<string, Widget>();
const sensors = new Map<string, SensorConfig>();
const lastUpdated = new Map<string, number>();
const lastValues = new Map<string, string | number | boolean>();
const historyBuffers = new Map<string, DataPoint[]>();
let updateInterval: ReturnType<typeof setInterval> | null = null;

function getGrid(): HTMLElement {
  if (!gridEl) {
    gridEl = document.getElementById("sensor-grid") as HTMLElement;
  }
  return gridEl;
}

function getModal(): HTMLElement {
  if (!modalEl) {
    modalEl = document.getElementById("add-sensor-modal") as HTMLElement;
  }
  return modalEl;
}

function getOverlay(): HTMLElement {
  if (!overlayEl) {
    overlayEl = document.getElementById("modal-overlay") as HTMLElement;
  }
  return overlayEl;
}

function getChartOverlay(): HTMLElement {
  if (!chartOverlayEl) {
    chartOverlayEl = document.getElementById("chart-overlay") as HTMLElement;
  }
  return chartOverlayEl;
}

function getChartOverlayInner(): HTMLElement {
  if (!chartOverlayInnerEl) {
    chartOverlayInnerEl = document.getElementById("chart-overlay-inner") as HTMLElement;
  }
  return chartOverlayInnerEl;
}

export function initDashboard() {
  const grid = getGrid();
  const addBtn = document.getElementById("add-sensor-btn") as HTMLButtonElement;
  const closeBtn = document.getElementById("modal-close") as HTMLButtonElement;
  const saveBtn = document.getElementById("modal-save") as HTMLButtonElement;
  const cancelBtn = document.getElementById("modal-cancel") as HTMLButtonElement;
  const resetBtn = document.getElementById("reset-all-btn") as HTMLButtonElement;

  addBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  saveBtn.addEventListener("click", handleSave);
  resetBtn.addEventListener("click", handleReset);
  getOverlay().addEventListener("click", closeModal);

  const payloadTypeSelect = document.getElementById("input-payload-type") as HTMLSelectElement;
  const jsonPathRow = document.getElementById("json-path-row") as HTMLElement;
  payloadTypeSelect.addEventListener("change", () => {
    jsonPathRow.style.display = payloadTypeSelect.value === "json" ? "block" : "none";
    updateModalPreview();
  });

  const widgetTypeSelect = document.getElementById("input-widget-type") as HTMLSelectElement;
  const minMaxRow = document.getElementById("min-max-row") as HTMLElement;
  widgetTypeSelect.addEventListener("change", () => {
    minMaxRow.style.display = widgetTypeSelect.value === "gauge" ? "block" : "none";
    updateModalPreview();
  });

  // Modal preview listeners
  const previewInputs = [
    "input-topic",
    "input-label",
    "input-json-path",
    "input-unit",
    "input-min",
    "input-max",
  ];
  for (const id of previewInputs) {
    const el = document.getElementById(id) as HTMLElement | null;
    if (el) el.addEventListener("input", updateModalPreview);
  }

  // Chart overlay close handlers
  const chartOverlay = getChartOverlay();
  const chartCloseBtn = document.getElementById("chart-overlay-close") as HTMLButtonElement | null;
  chartCloseBtn?.addEventListener("click", closeChartOverlay);
  chartOverlay.addEventListener("click", (e) => {
    if (e.target === chartOverlay) closeChartOverlay();
  });

  onMessage((msg) => {
    handleMqttMessage(msg.topic, msg.payload);
  });

  onStatusChange((connected) => {
    const statusEl = document.getElementById("conn-status");
    if (!statusEl) return;
    const label = statusEl.querySelector(".status-label") as HTMLElement;
    if (connected) {
      statusEl.className = "status-indicator live";
      label.textContent = "Live";
    } else {
      statusEl.className = "status-indicator reconnecting";
      label.textContent = "Reconnecting...";
    }
  });

  const saved = loadSensors();
  const persisted = loadHistory();
  for (const [id, points] of Object.entries(persisted)) {
    historyBuffers.set(id, points);
  }
  const persistedValues = loadLastValues();
  for (const [id, entry] of Object.entries(persistedValues)) {
    lastValues.set(id, entry.value);
    lastUpdated.set(id, entry.ts);
  }
  for (const cfg of saved) {
    createSensorCard(cfg);
  }

  if (saved.length === 0) {
    showEmptyState();
  }

  startTimestampRefresh();
}

function showEmptyState() {
  const grid = getGrid();
  grid.innerHTML = `
    <div class="empty-state">
      <svg class="empty-illustration" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="12" y="28" width="40" height="28" rx="4" stroke="currentColor" stroke-width="2"/>
        <path d="M8 28L32 8L56 28" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="32" cy="42" r="6" stroke="currentColor" stroke-width="2"/>
        <path d="M32 30V36" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <h2>No sensors configured</h2>
      <p>Add your first sensor to start monitoring your home in real time.</p>
      <button class="btn-primary" id="empty-add-btn">+ Add Your First Sensor</button>
    </div>
  `;
  const btn = document.getElementById("empty-add-btn") as HTMLButtonElement | null;
  if (btn) btn.addEventListener("click", openModal);
}

function hideEmptyState() {
  const grid = getGrid();
  const empty = grid.querySelector(".empty-state");
  if (empty) empty.remove();
}

function openModal() {
  getModal().classList.add("open");
  getOverlay().classList.add("open");
  (document.getElementById("input-topic") as HTMLInputElement).focus();
  updateModalPreview();
}

export function closeModal() {
  getModal().classList.remove("open");
  getOverlay().classList.remove("open");
  clearForm();
}

function clearForm() {
  (document.getElementById("input-topic") as HTMLInputElement).value = "";
  (document.getElementById("input-label") as HTMLInputElement).value = "";
  (document.getElementById("input-payload-type") as HTMLSelectElement).value = "plain";
  (document.getElementById("input-json-path") as HTMLInputElement).value = "";
  (document.getElementById("input-widget-type") as HTMLSelectElement).value = "text";
  (document.getElementById("input-unit") as HTMLInputElement).value = "";
  (document.getElementById("input-min") as HTMLInputElement).value = "0";
  (document.getElementById("input-max") as HTMLInputElement).value = "100";

  (document.getElementById("json-path-row") as HTMLElement).style.display = "none";
  (document.getElementById("min-max-row") as HTMLElement).style.display = "none";

  updateModalPreview();
}

function handleSave() {
  const topic = (document.getElementById("input-topic") as HTMLInputElement).value.trim();
  const label = (document.getElementById("input-label") as HTMLInputElement).value.trim() || topic;
  const payloadType = (document.getElementById("input-payload-type") as HTMLSelectElement).value as "plain" | "json";
  const jsonPath = (document.getElementById("input-json-path") as HTMLInputElement).value.trim();
  const widgetType = (document.getElementById("input-widget-type") as HTMLSelectElement).value as "text" | "gauge" | "switch";
  const unit = (document.getElementById("input-unit") as HTMLInputElement).value.trim();
  const min = parseFloat((document.getElementById("input-min") as HTMLInputElement).value) || 0;
  const max = parseFloat((document.getElementById("input-max") as HTMLInputElement).value) || 100;

  if (!topic) {
    alert("MQTT Topic is required.");
    return;
  }

  const config: SensorConfig = {
    id: crypto.randomUUID(),
    topic,
    label,
    payloadType,
    jsonPath,
    widgetType,
    unit,
    min,
    max,
  };

  addSensor(config);
  hideEmptyState();
  createSensorCard(config);
  closeModal();
}

function handleReset() {
  if (!confirm("Remove all sensors? This cannot be undone.")) return;
  for (const cfg of sensors.values()) {
    unsubscribe(cfg.topic);
  }
  sensors.clear();
  widgets.clear();
  lastUpdated.clear();
  lastValues.clear();
  historyBuffers.clear();
  clearHistory();
  clearLastValues();
  saveSensors([]);
  getGrid().innerHTML = "";
  showEmptyState();
}

function createSensorCard(config: SensorConfig) {
  if (sensors.has(config.id)) return;

  sensors.set(config.id, config);
  subscribe(config.topic);
  if (!historyBuffers.has(config.id)) {
    historyBuffers.set(config.id, []);
  }

  const widget = createWidget(config);
  widgets.set(config.id, widget);

  // Restore persisted value display
  const persistedValue = lastValues.get(config.id);
  const persistedTs = lastUpdated.get(config.id);
  if (persistedValue !== undefined && persistedTs !== undefined) {
    widget.update({ topic: config.topic, value: persistedValue, rawPayload: "", timestamp: persistedTs });
  }

  const card = widget.element;
  card.dataset.sensorId = config.id;
  card.style.cursor = "pointer";

  // Chart icon (visible on hover)
  const chartBtn = document.createElement("button");
  chartBtn.className = "card-chart-btn";
  chartBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  `;
  chartBtn.title = "View history chart";
  chartBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openChartOverlay(config.id);
  });
  card.appendChild(chartBtn);

  const removeBtn = document.createElement("button");
  removeBtn.className = "card-remove-btn";
  removeBtn.innerHTML = "&times;";
  removeBtn.title = "Remove sensor";
  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    removeCard(config.id);
  });
  card.appendChild(removeBtn);

  // Click card body (not buttons) to open chart
  card.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (
      target.closest(".card-chart-btn") ||
      target.closest(".card-remove-btn") ||
      target.closest("button")
    ) {
      return;
    }
    openChartOverlay(config.id);
  });

  const meta = document.createElement("div");
  meta.className = "sensor-meta";

  const liveSpan = document.createElement("span");
  liveSpan.style.display = "inline-flex";
  liveSpan.style.alignItems = "center";
  liveSpan.style.gap = "6px";

  const dot = document.createElement("span");
  dot.className = "sensor-live-dot";

  const time = document.createElement("span");
  time.className = "meta-time";
  const ts = lastUpdated.get(config.id);
  time.textContent = ts ? formatTimeAgo(Date.now() - ts) : "waiting...";

  liveSpan.appendChild(dot);
  liveSpan.appendChild(time);
  meta.appendChild(liveSpan);
  card.appendChild(meta);

  getGrid().appendChild(card);
}

function removeCard(id: string) {
  const cfg = sensors.get(id);
  if (!cfg) return;

  unsubscribe(cfg.topic);
  sensors.delete(id);
  widgets.delete(id);
  lastUpdated.delete(id);
  lastValues.delete(id);
  historyBuffers.delete(id);
  removeHistory(id);
  removeLastValue(id);
  removeSensor(id);

  const card = document.querySelector(`[data-sensor-id="${id}"]`);
  card?.remove();

  if (sensors.size === 0) {
    showEmptyState();
  }
}

function openChartOverlay(sensorId: string) {
  const cfg = sensors.get(sensorId);
  if (!cfg) return;

  const currentValue = lastValues.get(sensorId);
  const titleEl = document.getElementById("chart-overlay-title") as HTMLElement | null;
  const valueEl = document.getElementById("chart-overlay-value") as HTMLElement | null;
  const unitEl = document.getElementById("chart-overlay-unit") as HTMLElement | null;

  if (titleEl) titleEl.textContent = cfg.label;
  if (valueEl) {
    valueEl.textContent = currentValue !== undefined ? String(currentValue) : "—";
    valueEl.classList.remove("value-changed");
    void valueEl.offsetWidth;
    valueEl.classList.add("value-changed");
    setTimeout(() => valueEl.classList.remove("value-changed"), 400);
  }
  if (unitEl) unitEl.textContent = cfg.unit || "";

  renderChartInOverlay(sensorId);

  getChartOverlay().classList.add("open");
}

function closeChartOverlay() {
  getChartOverlay().classList.remove("open");
}

function renderChartInOverlay(sensorId: string) {
  const container = getChartOverlayInner();
  container.innerHTML = "";
  container.style.display = "block";

  const data = historyBuffers.get(sensorId) || [];
  const cfg = sensors.get(sensorId);

  const width = Math.min(container.clientWidth || 720, 800);
  const height = 340;

  renderChart(container, data, {
    width,
    height,
    minY: cfg?.widgetType === "gauge" ? cfg.min : undefined,
    maxY: cfg?.widgetType === "gauge" ? cfg.max : undefined,
  });
}

function handleMqttMessage(topic: string, payload: string) {
  for (const [id, cfg] of sensors) {
    if (cfg.topic !== topic) continue;

    const reading = extractValue(cfg, payload);
    const widget = widgets.get(id);
    if (widget) {
      widget.update(reading);

      const oldValue = lastValues.get(id);
      if (oldValue !== reading.value) {
        const textVal = widget.element.querySelector(".text-value") as HTMLElement | null;
        if (textVal) {
          textVal.classList.remove("value-changed");
          void textVal.offsetWidth;
          textVal.classList.add("value-changed");
          setTimeout(() => textVal.classList.remove("value-changed"), 400);
        }
        const gaugeVal = widget.element.querySelector(".gauge-value-below") as HTMLElement | null;
        if (gaugeVal) {
          gaugeVal.classList.remove("value-changed");
          void gaugeVal.offsetWidth;
          gaugeVal.classList.add("value-changed");
          setTimeout(() => gaugeVal.classList.remove("value-changed"), 400);
        }
      }
    }

    // Persist latest value + timestamp
    lastValues.set(id, reading.value);
    lastUpdated.set(id, Date.now());
    saveLastValue(id, reading.value, Date.now());

    // Store numeric history
    const num = Number(reading.value);
    if (!Number.isNaN(num)) {
      const point: DataPoint = { ts: Date.now(), value: num };
      const buffer = historyBuffers.get(id) || [];
      buffer.push(point);
      if (buffer.length > 120) buffer.shift();
      historyBuffers.set(id, buffer);
      addHistoryPoint(id, point);

      // If chart overlay is open for this sensor, re-render
      const chartOverlay = getChartOverlay();
      if (chartOverlay.classList.contains("open")) {
        const activeTitle = document.getElementById("chart-overlay-title")?.textContent;
        if (activeTitle === cfg.label) {
          renderChartInOverlay(id);
          const valueEl = document.getElementById("chart-overlay-value");
          const unitEl = document.getElementById("chart-overlay-unit");
          if (valueEl) valueEl.textContent = String(num);
          if (unitEl) unitEl.textContent = cfg.unit || "";
        }
      }
    }

    const card = document.querySelector(`[data-sensor-id="${id}"]`) as HTMLElement | null;
    if (card) {
      const timeEl = card.querySelector(".meta-time") as HTMLElement | null;
      if (timeEl) timeEl.textContent = "just now";
    }
  }
}

function startTimestampRefresh() {
  if (updateInterval) return;
  updateInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, ts] of lastUpdated) {
      const card = document.querySelector(`[data-sensor-id="${id}"]`) as HTMLElement | null;
      if (!card) continue;
      const timeEl = card.querySelector(".meta-time") as HTMLElement | null;
      if (timeEl) {
        timeEl.textContent = formatTimeAgo(now - ts);
      }
    }
  }, 1000);
}

function formatTimeAgo(diffMs: number): string {
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function updateModalPreview() {
  const previewContainer = document.getElementById("modal-preview") as HTMLElement | null;
  if (!previewContainer) return;

  const payloadType = (document.getElementById("input-payload-type") as HTMLSelectElement).value as "plain" | "json";
  const jsonPath = (document.getElementById("input-json-path") as HTMLInputElement).value.trim();
  const widgetType = (document.getElementById("input-widget-type") as HTMLSelectElement).value as "text" | "gauge" | "switch";
  const unit = (document.getElementById("input-unit") as HTMLInputElement).value.trim();
  const min = parseFloat((document.getElementById("input-min") as HTMLInputElement).value) || 0;
  const max = parseFloat((document.getElementById("input-max") as HTMLInputElement).value) || 100;

  const config: SensorConfig = {
    id: "preview-id",
    topic: "preview/topic",
    label: "Preview",
    payloadType,
    jsonPath,
    widgetType,
    unit,
    min,
    max,
  };

  const widget = createWidget(config);
  widget.element.style.animation = "none";
  widget.element.style.position = "relative";

  let dummyPayload: string;
  if (payloadType === "json") {
    if (jsonPath) {
      const keys = jsonPath.split(".");
      const obj: Record<string, unknown> = {};
      let current: Record<string, unknown> = obj;
      for (let i = 0; i < keys.length - 1; i++) {
        current[keys[i]] = {};
        current = current[keys[i]] as Record<string, unknown>;
      }
      current[keys[keys.length - 1]] = widgetType === "switch" ? "ON" : "45.2";
      dummyPayload = JSON.stringify(obj);
    } else {
      dummyPayload = JSON.stringify({ value: widgetType === "switch" ? "ON" : "45.2" });
    }
  } else {
    dummyPayload = widgetType === "switch" ? "ON" : "45.2";
  }

  const reading = extractValue(config, dummyPayload);
  widget.update(reading);

  previewContainer.innerHTML = "";
  previewContainer.appendChild(widget.element);
}
