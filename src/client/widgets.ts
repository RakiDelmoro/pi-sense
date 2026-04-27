import type { SensorConfig, SensorReading } from "./types";

export interface Widget {
  element: HTMLElement;
  update(reading: SensorReading): void;
}

function createCard(label: string, unit: string): { card: HTMLElement; body: HTMLElement } {
  const card = document.createElement("div");
  card.className = "sensor-card";

  const header = document.createElement("div");
  header.className = "sensor-header";

  const title = document.createElement("span");
  title.className = "sensor-title";
  title.textContent = label;

  const unitSpan = document.createElement("span");
  unitSpan.className = "sensor-unit";
  unitSpan.textContent = unit;

  header.appendChild(title);
  if (unit) header.appendChild(unitSpan);

  const body = document.createElement("div");
  body.className = "sensor-body";

  card.appendChild(header);
  card.appendChild(body);

  return { card, body };
}

export function createTextWidget(config: SensorConfig): Widget {
  const { card, body } = createCard(config.label, "");
  body.classList.add("widget-text");

  const valueEl = document.createElement("span");
  valueEl.className = "text-value";
  valueEl.textContent = "—";

  const unitEl = document.createElement("span");
  unitEl.className = "text-unit-inline";
  unitEl.textContent = config.unit;

  const trendEl = document.createElement("span");
  trendEl.className = "trend-indicator";
  trendEl.style.opacity = "0";

  body.appendChild(valueEl);
  if (config.unit) body.appendChild(unitEl);
  body.appendChild(trendEl);

  let lastValue: number | string | boolean | undefined;

  return {
    element: card,
    update(reading) {
      const val = reading.value;
      valueEl.textContent = String(val);

      // Trend indicator for numeric values
      const num = Number(val);
      if (!Number.isNaN(num) && lastValue !== undefined) {
        const lastNum = Number(lastValue);
        if (!Number.isNaN(lastNum)) {
          if (num > lastNum) {
            trendEl.textContent = "↑";
            trendEl.className = "trend-indicator trend-up";
            trendEl.style.opacity = "1";
          } else if (num < lastNum) {
            trendEl.textContent = "↓";
            trendEl.className = "trend-indicator trend-down";
            trendEl.style.opacity = "1";
          } else {
            trendEl.style.opacity = "0";
          }
        }
      } else {
        trendEl.style.opacity = "0";
      }
      lastValue = val;
    },
  };
}

function gaugeColor(pct: number): string {
  if (pct >= 0.9) return "var(--danger)";
  if (pct >= 0.75) return "var(--warning)";
  return "var(--accent)";
}

export function createGaugeWidget(config: SensorConfig): Widget {
  const { card, body } = createCard(config.label, "");
  body.classList.add("widget-gauge");

  const min = config.min;
  const max = config.max;
  const range = max - min || 1;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 70");
  svg.classList.add("gauge-svg");

  const track = document.createElementNS("http://www.w3.org/2000/svg", "path");
  track.setAttribute("d", "M 10 60 A 50 50 0 0 1 110 60");
  track.setAttribute("fill", "none");
  track.setAttribute("stroke", "var(--surface-hover)");
  track.setAttribute("stroke-width", "10");
  track.setAttribute("stroke-linecap", "round");
  svg.appendChild(track);

  const bar = document.createElementNS("http://www.w3.org/2000/svg", "path");
  bar.setAttribute("fill", "none");
  bar.setAttribute("stroke-width", "10");
  bar.setAttribute("stroke-linecap", "round");
  svg.appendChild(bar);

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", "60");
  text.setAttribute("y", "55");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("fill", "var(--text-primary)");
  text.setAttribute("font-size", "14");
  text.setAttribute("font-weight", "bold");
  text.textContent = "—";
  svg.appendChild(text);

  body.appendChild(svg);

  const valueBelow = document.createElement("div");
  valueBelow.className = "gauge-value-below";
  valueBelow.textContent = "—";
  if (config.unit) {
    const u = document.createElement("span");
    u.className = "gauge-unit-inline";
    u.textContent = config.unit;
    valueBelow.appendChild(u);
  }
  body.appendChild(valueBelow);

  function arcPath(percent: number): string {
    const angle = Math.PI + percent * Math.PI;
    const x = 60 + 50 * Math.cos(angle);
    const y = 60 + 50 * Math.sin(angle);
    const largeArc = percent > 0.5 ? 1 : 0;
    return `M 10 60 A 50 50 0 ${largeArc} 1 ${x} ${y}`;
  }

  return {
    element: card,
    update(reading) {
      const num = Number(reading.value);
      if (Number.isNaN(num)) {
        text.textContent = String(reading.value);
        bar.setAttribute("d", "");
        valueBelow.textContent = String(reading.value);
        return;
      }
      const clamped = Math.max(min, Math.min(max, num));
      const pct = (clamped - min) / range;
      bar.setAttribute("d", arcPath(pct));
      bar.setAttribute("stroke", gaugeColor(pct));
      text.textContent = String(num);
      valueBelow.childNodes[0].textContent = String(num);
    },
  };
}

export function createSwitchWidget(config: SensorConfig): Widget {
  const { card, body } = createCard(config.label, "");
  body.classList.add("widget-switch");

  const toggle = document.createElement("label");
  toggle.className = "switch-toggle";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.disabled = true;

  const slider = document.createElement("span");
  slider.className = "switch-slider";

  const labels = document.createElement("span");
  labels.className = "switch-labels";
  labels.innerHTML = "<span>OFF</span><span>ON</span>";

  toggle.appendChild(input);
  toggle.appendChild(slider);
  toggle.appendChild(labels);
  body.appendChild(toggle);

  return {
    element: card,
    update(reading) {
      const val = String(reading.value).toLowerCase();
      const on = val === "on" || val === "true" || val === "1";
      input.checked = on;
    },
  };
}

export function createWidget(config: SensorConfig): Widget {
  switch (config.widgetType) {
    case "gauge":
      return createGaugeWidget(config);
    case "switch":
      return createSwitchWidget(config);
    default:
      return createTextWidget(config);
  }
}
