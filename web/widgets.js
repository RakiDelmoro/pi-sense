const PiSenseWidgets = {
    renderText(container, sensor) {
        const precision = sensor.display_precision || 1;
        container.innerHTML = `
            <div class="widget-text">
                <span class="widget-text-value" data-precision="${precision}">--</span>
                <span class="widget-text-unit">${sensor.unit || ''}</span>
            </div>
        `;
    },

    updateText(container, value, unit) {
        const valEl = container.querySelector('.widget-text-value');
        if (!valEl) return;
        const precision = parseInt(valEl.dataset.precision) || 1;
        const num = parseFloat(value);
        valEl.textContent = isNaN(num) ? value : (Number.isInteger(num) ? num : num.toFixed(precision));
    },

    renderGauge(container, sensor) {
        const min = sensor.gauge_min !== undefined ? sensor.gauge_min : 0;
        const max = sensor.gauge_max !== undefined ? sensor.gauge_max : 100;
        const colorLow = sensor.gauge_color_low || '#4caf50';
        const colorMid = sensor.gauge_color_mid || '#4fc3f7';
        const colorHigh = sensor.gauge_color_high || '#ef5350';
        const threshLow = sensor.gauge_threshold_low !== undefined ? sensor.gauge_threshold_low : 30;
        const threshHigh = sensor.gauge_threshold_high !== undefined ? sensor.gauge_threshold_high : 70;

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 200 120');
        svg.setAttribute('class', 'gauge-svg');
        svg.dataset.min = min;
        svg.dataset.max = max;
        svg.dataset.threshLow = threshLow;
        svg.dataset.threshHigh = threshHigh;
        svg.dataset.colorLow = colorLow;
        svg.dataset.colorMid = colorMid;
        svg.dataset.colorHigh = colorHigh;

        const sid = sensor.name.replace(/[^a-zA-Z0-9_-]/g, '_');

        svg.innerHTML = `
            <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#2a2a3a" stroke-width="16" stroke-linecap="round"/>
            <path class="gauge-arc" d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="${colorMid}" stroke-width="16" stroke-linecap="round" stroke-dasharray="0 251"/>
            <text x="100" y="95" text-anchor="middle" fill="#e0e0e0" font-size="28" font-weight="bold" class="gauge-val">--</text>
            <text x="100" y="112" text-anchor="middle" fill="#888" font-size="12" class="gauge-unit">${sensor.unit || ''}</text>
        `;
        container.appendChild(svg);
    },

    updateGauge(container, value, unit) {
        const svg = container.querySelector('svg');
        if (!svg) return;

        const min = parseFloat(svg.dataset.min) || 0;
        const max = parseFloat(svg.dataset.max) || 100;
        const threshLow = parseFloat(svg.dataset.threshLow) || 30;
        const threshHigh = parseFloat(svg.dataset.threshHigh) || 70;
        const colorLow = svg.dataset.colorLow || '#4caf50';
        const colorMid = svg.dataset.colorMid || '#4fc3f7';
        const colorHigh = svg.dataset.colorHigh || '#ef5350';

        const num = parseFloat(value);
        if (isNaN(num)) return;

        const range = max - min;
        const pct = Math.max(0, Math.min(1, (num - min) / range));
        const arcLength = 251;
        const filled = pct * arcLength;

        const arc = svg.querySelector('.gauge-arc');
        if (arc) arc.setAttribute('stroke-dasharray', `${filled} ${arcLength - filled}`);

        let color = colorMid;
        if (pct * 100 <= threshLow) color = colorLow;
        else if (pct * 100 >= threshHigh) color = colorHigh;
        if (arc) arc.setAttribute('stroke', color);

        const valEl = svg.querySelector('.gauge-val');
        if (valEl) valEl.textContent = Number.isInteger(num) ? num : num.toFixed(1);
    },

    renderSwitch(container, sensor) {
        const payloadOn = sensor.publish_payload_on || '1';
        const payloadOff = sensor.publish_payload_off || '0';
        const canPublish = sensor.allow_publish && sensor.publish_topic;

        container.innerHTML = `
            <div class="widget-switch">
                <div class="switch-track${canPublish ? ' clickable' : ''}">
                    <div class="switch-thumb"></div>
                </div>
                <span class="switch-label">OFF</span>
            </div>
        `;
        container.dataset.payloadOn = payloadOn;
        container.dataset.payloadOff = payloadOff;
        container.dataset.canPublish = canPublish ? 'true' : 'false';
    },

    updateSwitch(container, value) {
        const track = container.querySelector('.switch-track');
        const label = container.querySelector('.switch-label');
        const isOn = value === '1' || value.toLowerCase() === 'on' || value.toLowerCase() === 'true';
        if (track) track.classList.toggle('active', isOn);
        if (label) label.textContent = isOn ? 'ON' : 'OFF';
    },

    renderChartOverlay(sensor, readings, chartColor) {
        const canvas = document.getElementById('chart-overlay-canvas');
        const title = document.getElementById('chart-overlay-title');
        const tooltip = document.getElementById('chart-tooltip');
        if (!canvas || !title) return;

        title.textContent = sensor.name + (sensor.unit ? ` (${sensor.unit})` : '');

        const color = chartColor || '#4fc3f7';
        const ctx = canvas.getContext('2d');

        const parentWidth = canvas.parentElement.clientWidth;
        if (parentWidth === 0) {
            requestAnimationFrame(() => this.renderChartOverlay(sensor, readings, chartColor));
            return;
        }

        canvas.width = parentWidth;
        canvas.height = 300;

        const w = canvas.width;
        const h = canvas.height;
        const padding = 50;

        ctx.clearRect(0, 0, w, h);

        const sorted = [...readings].reverse();
        const points = sorted
            .map(r => ({ value: parseFloat(r.value), timestamp: r.timestamp }))
            .filter(p => !isNaN(p.value));
        if (points.length < 2) {
            ctx.fillStyle = '#666';
            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Not enough data', w / 2, h / 2);
            return;
        }

        const values = points.map(p => p.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = max - min || 1;

        ctx.strokeStyle = '#2a2a3a';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = padding + (i / 4) * (h - 2 * padding);
            ctx.beginPath();
            ctx.moveTo(padding, y);
            ctx.lineTo(w - padding, y);
            ctx.stroke();

            ctx.fillStyle = '#666';
            ctx.font = '10px monospace';
            ctx.textAlign = 'right';
            const labelVal = max - (i / 4) * range;
            ctx.fillText(labelVal.toFixed(1), padding - 6, y + 4);
        }

        const xOf = (i) => padding + (i / (points.length - 1)) * (w - 2 * padding);
        const yOf = (v) => h - padding - ((v - min) / range) * (h - 2 * padding);

        const grad = ctx.createLinearGradient(0, padding, 0, h - padding);
        grad.addColorStop(0, color + '40');
        grad.addColorStop(1, color + '05');

        ctx.beginPath();
        points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(xOf(i), yOf(p.value));
            else ctx.lineTo(xOf(i), yOf(p.value));
        });
        ctx.lineTo(xOf(points.length - 1), h - padding);
        ctx.lineTo(xOf(0), h - padding);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(xOf(i), yOf(p.value));
            else ctx.lineTo(xOf(i), yOf(p.value));
        });
        ctx.stroke();

        points.forEach((p, i) => {
            ctx.beginPath();
            ctx.arc(xOf(i), yOf(p.value), 3, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        });

        const chartData = { points, color, sensor, xOf, yOf, w, h, padding, min, max, range };

        canvas.onmousemove = (e) => {
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            let nearest = 0;
            let nearestDist = Infinity;
            for (let i = 0; i < chartData.points.length; i++) {
                const dist = Math.abs(chartData.xOf(i) - mx);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearest = i;
                }
            }
            if (nearestDist > 30) {
                if (tooltip) tooltip.classList.add('hidden');
                return;
            }

            const p = chartData.points[nearest];
            const date = new Date(p.timestamp * 1000);
            const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

            if (tooltip) {
                tooltip.innerHTML = `<span class="chart-tooltip-value">${p.value}${sensor.unit ? ' ' + sensor.unit : ''}</span><span class="chart-tooltip-time">${dateStr} ${timeStr}</span>`;
                tooltip.classList.remove('hidden');
                const tx = Math.min(chartData.xOf(nearest) + 10, chartData.w - 160);
                const ty = Math.max(chartData.yOf(p.value) - 50, 5);
                tooltip.style.left = tx + 'px';
                tooltip.style.top = ty + 'px';
            }

            ctx.clearRect(0, 0, w, h);
            this._drawChart(ctx, chartData);

            ctx.beginPath();
            ctx.arc(chartData.xOf(nearest), chartData.yOf(p.value), 6, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(chartData.xOf(nearest), chartData.yOf(p.value), 4, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        };

        canvas.onmouseleave = () => {
            if (tooltip) tooltip.classList.add('hidden');
            ctx.clearRect(0, 0, w, h);
            this._drawChart(ctx, chartData);
        };
    },

    _drawChart(ctx, d) {
        const { points, color, w, h, padding, min, max, range } = d;
        const xOf = d.xOf;
        const yOf = d.yOf;

        ctx.strokeStyle = '#2a2a3a';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = padding + (i / 4) * (h - 2 * padding);
            ctx.beginPath();
            ctx.moveTo(padding, y);
            ctx.lineTo(w - padding, y);
            ctx.stroke();
            ctx.fillStyle = '#666';
            ctx.font = '10px monospace';
            ctx.textAlign = 'right';
            const labelVal = max - (i / 4) * range;
            ctx.fillText(labelVal.toFixed(1), padding - 6, y + 4);
        }

        const grad = ctx.createLinearGradient(0, padding, 0, h - padding);
        grad.addColorStop(0, color + '40');
        grad.addColorStop(1, color + '05');
        ctx.beginPath();
        points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(xOf(i), yOf(p.value));
            else ctx.lineTo(xOf(i), yOf(p.value));
        });
        ctx.lineTo(xOf(points.length - 1), h - padding);
        ctx.lineTo(xOf(0), h - padding);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(xOf(i), yOf(p.value));
            else ctx.lineTo(xOf(i), yOf(p.value));
        });
        ctx.stroke();

        points.forEach((p, i) => {
            ctx.beginPath();
            ctx.arc(xOf(i), yOf(p.value), 3, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
        });
    }
};