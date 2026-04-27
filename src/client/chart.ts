export interface DataPoint {
  ts: number;
  value: number;
}

export interface ChartOptions {
  width: number;
  height: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  minY?: number;
  maxY?: number;
}

export function renderChart(
  container: HTMLElement,
  data: DataPoint[],
  options: ChartOptions
) {
  container.innerHTML = "";
  if (data.length < 2) {
    container.textContent = "Not enough data yet...";
    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.justifyContent = "center";
    container.style.color = "var(--text-muted)";
    container.style.fontSize = "0.9rem";
    return;
  }

  const padding = options.padding || { top: 20, right: 20, bottom: 32, left: 48 };
  const w = options.width - padding.left - padding.right;
  const h = options.height - padding.top - padding.bottom;

  const minTs = data[0].ts;
  const maxTs = data[data.length - 1].ts;
  const timeRange = maxTs - minTs || 1;

  const values = data.map((d) => d.value);
  let minVal = options.minY !== undefined ? options.minY : Math.min(...values);
  let maxVal = options.maxY !== undefined ? options.maxY : Math.max(...values);
  if (minVal === maxVal) {
    minVal -= 1;
    maxVal += 1;
  }
  const valRange = maxVal - minVal || 1;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${options.width} ${options.height}`);
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.display = "block";

  // Defs for gradient
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const grad = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
  grad.setAttribute("id", "area-gradient");
  grad.setAttribute("x1", "0");
  grad.setAttribute("y1", "0");
  grad.setAttribute("x2", "0");
  grad.setAttribute("y2", "1");
  const stop1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
  stop1.setAttribute("offset", "0%");
  stop1.setAttribute("stop-color", "var(--accent)");
  stop1.setAttribute("stop-opacity", "0.25");
  const stop2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
  stop2.setAttribute("offset", "100%");
  stop2.setAttribute("stop-color", "var(--accent)");
  stop2.setAttribute("stop-opacity", "0");
  grad.appendChild(stop1);
  grad.appendChild(stop2);
  defs.appendChild(grad);

  // Glow filter
  const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter.setAttribute("id", "line-glow");
  filter.setAttribute("x", "-20%");
  filter.setAttribute("y", "-20%");
  filter.setAttribute("width", "140%");
  filter.setAttribute("height", "140%");
  const feBlur = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
  feBlur.setAttribute("in", "SourceGraphic");
  feBlur.setAttribute("stdDeviation", "2");
  filter.appendChild(feBlur);
  defs.appendChild(filter);
  svg.appendChild(defs);

  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("transform", `translate(${padding.left}, ${padding.top})`);

  // Grid lines (horizontal)
  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const y = (i / gridCount) * h;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "0");
    line.setAttribute("y1", String(y));
    line.setAttribute("x2", String(w));
    line.setAttribute("y2", String(y));
    line.setAttribute("stroke", "var(--border)");
    line.setAttribute("stroke-dasharray", "3,3");
    g.appendChild(line);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", "-8");
    label.setAttribute("y", String(y + 4));
    label.setAttribute("text-anchor", "end");
    label.setAttribute("fill", "var(--text-muted)");
    label.setAttribute("font-size", "10");
    label.textContent = String(roundNice(maxVal - (i / gridCount) * valRange));
    g.appendChild(label);
  }

  // X-axis time labels
  const timeLabels = [minTs, Math.round((minTs + maxTs) / 2), maxTs];
  for (const t of timeLabels) {
    const x = ((t - minTs) / timeRange) * w;
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", String(x));
    label.setAttribute("y", String(h + 18));
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("fill", "var(--text-muted)");
    label.setAttribute("font-size", "10");
    label.textContent = formatTime(t);
    g.appendChild(label);
  }

  // Area path
  let areaPath = `M 0 ${h}`;
  for (let i = 0; i < data.length; i++) {
    const x = ((data[i].ts - minTs) / timeRange) * w;
    const y = h - ((data[i].value - minVal) / valRange) * h;
    areaPath += ` L ${x} ${y}`;
  }
  areaPath += ` L ${w} ${h} Z`;

  const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
  area.setAttribute("d", areaPath);
  area.setAttribute("fill", "url(#area-gradient)");
  g.appendChild(area);

  // Line path
  let linePath = "";
  for (let i = 0; i < data.length; i++) {
    const x = ((data[i].ts - minTs) / timeRange) * w;
    const y = h - ((data[i].value - minVal) / valRange) * h;
    linePath += `${i === 0 ? "M" : "L"} ${x} ${y}`;
  }

  const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line.setAttribute("d", linePath);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "var(--accent)");
  line.setAttribute("stroke-width", "2.5");
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-linejoin", "round");
  line.setAttribute("filter", "url(#line-glow)");
  g.appendChild(line);

  // Data point dots
  const dotsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  const dotElements: SVGCircleElement[] = [];
  const pointCoords: { x: number; y: number }[] = [];

  for (let i = 0; i < data.length; i++) {
    const x = ((data[i].ts - minTs) / timeRange) * w;
    const y = h - ((data[i].value - minVal) / valRange) * h;
    pointCoords.push({ x, y });

    const d = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    d.setAttribute("cx", String(x));
    d.setAttribute("cy", String(y));
    d.setAttribute("r", "3.5");
    d.setAttribute("fill", "var(--surface)");
    d.setAttribute("stroke", "var(--accent)");
    d.setAttribute("stroke-width", "2");
    d.style.transition = "r 0.15s ease, fill 0.15s ease";
    dotsGroup.appendChild(d);
    dotElements.push(d);
  }
  g.appendChild(dotsGroup);

  // Tooltip group (hidden by default)
  const tooltipGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
  tooltipGroup.style.opacity = "0";
  tooltipGroup.style.pointerEvents = "none";
  tooltipGroup.style.transition = "opacity 0.15s ease";

  const crosshair = document.createElementNS("http://www.w3.org/2000/svg", "line");
  crosshair.setAttribute("y1", "0");
  crosshair.setAttribute("y2", String(h));
  crosshair.setAttribute("stroke", "var(--text-secondary)");
  crosshair.setAttribute("stroke-width", "1");
  crosshair.setAttribute("stroke-dasharray", "4,4");
  tooltipGroup.appendChild(crosshair);

  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("r", "5");
  dot.setAttribute("fill", "var(--accent)");
  dot.setAttribute("stroke", "var(--surface)");
  dot.setAttribute("stroke-width", "2");
  tooltipGroup.appendChild(dot);

  const tooltipBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  tooltipBg.setAttribute("rx", "6");
  tooltipBg.setAttribute("ry", "6");
  tooltipBg.setAttribute("fill", "var(--surface)");
  tooltipBg.setAttribute("stroke", "var(--border)");
  tooltipBg.setAttribute("stroke-width", "1");
  tooltipBg.setAttribute("height", "40");
  tooltipGroup.appendChild(tooltipBg);

  const tooltipText = document.createElementNS("http://www.w3.org/2000/svg", "text");
  tooltipText.setAttribute("text-anchor", "middle");
  tooltipText.setAttribute("fill", "var(--text-primary)");
  tooltipText.setAttribute("font-size", "11");
  tooltipText.setAttribute("font-weight", "600");
  tooltipText.setAttribute("y", "15");
  tooltipGroup.appendChild(tooltipText);

  const tooltipTime = document.createElementNS("http://www.w3.org/2000/svg", "text");
  tooltipTime.setAttribute("text-anchor", "middle");
  tooltipTime.setAttribute("fill", "var(--text-muted)");
  tooltipTime.setAttribute("font-size", "9");
  tooltipTime.setAttribute("y", "30");
  tooltipGroup.appendChild(tooltipTime);

  g.appendChild(tooltipGroup);
  svg.appendChild(g);
  container.appendChild(svg);

  // Hover interaction
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("width", String(w));
  rect.setAttribute("height", String(h));
  rect.setAttribute("fill", "transparent");
  rect.style.cursor = "crosshair";
  g.appendChild(rect);

  rect.addEventListener("mousemove", (e) => {
    const bounds = svg.getBoundingClientRect();
    const scaleX = w / bounds.width;
    const mx = (e.clientX - bounds.left) * scaleX;
    const clampedX = Math.max(0, Math.min(w, mx));

    // Find nearest data point
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < data.length; i++) {
      const px = ((data[i].ts - minTs) / timeRange) * w;
      const dist = Math.abs(px - clampedX);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    const point = data[nearestIdx];
    const px = ((point.ts - minTs) / timeRange) * w;
    const py = h - ((point.value - minVal) / valRange) * h;

    // Highlight nearest dot
    for (let i = 0; i < dotElements.length; i++) {
      if (i === nearestIdx) {
        dotElements[i].setAttribute("r", "5.5");
        dotElements[i].setAttribute("fill", "var(--accent)");
      } else {
        dotElements[i].setAttribute("r", "3.5");
        dotElements[i].setAttribute("fill", "var(--surface)");
      }
    }

    crosshair.setAttribute("x1", String(px));
    crosshair.setAttribute("x2", String(px));
    dot.setAttribute("cx", String(px));
    dot.setAttribute("cy", String(py));

    const valText = String(roundNice(point.value));
    const timeText = formatFullTime(point.ts);
    tooltipText.textContent = valText;
    tooltipTime.textContent = timeText;

    const textWidth = Math.max(valText.length, timeText.length) * 7 + 20;
    tooltipBg.setAttribute("width", String(textWidth));

    let tx = px - textWidth / 2;
    if (tx < 0) tx = 4;
    if (tx + textWidth > w) tx = w - textWidth - 4;
    let ty = py - 52;
    if (ty < 0) ty = py + 14;

    tooltipBg.setAttribute("x", String(tx));
    tooltipBg.setAttribute("y", String(ty));
    tooltipText.setAttribute("x", String(tx + textWidth / 2));
    tooltipText.setAttribute("y", String(ty + 15));
    tooltipTime.setAttribute("x", String(tx + textWidth / 2));
    tooltipTime.setAttribute("y", String(ty + 30));

    tooltipGroup.style.opacity = "1";
  });

  rect.addEventListener("mouseleave", () => {
    tooltipGroup.style.opacity = "0";
    for (const d of dotElements) {
      d.setAttribute("r", "3.5");
      d.setAttribute("fill", "var(--surface)");
    }
  });
}

function roundNice(n: number): string {
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  if (Math.abs(n) >= 1) return n.toFixed(2);
  return n.toFixed(3);
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function formatFullTime(ts: number): string {
  const d = new Date(ts);
  const datePart = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });
  return `${datePart}, ${timePart}`;
}
