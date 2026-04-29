const PiSenseWidgets = {
    renderText(container, sensor) {
        container.innerHTML = `
            <div class="widget-text">
                <span class="widget-text-value" id="val-${sensor.id}">--</span>
                <span class="widget-text-unit">${sensor.unit}</span>
            </div>
        `;
    },

    updateText(container, value, unit) {
        const valEl = container.querySelector('.widget-text-value');
        if (valEl) valEl.textContent = value;
    },

    renderGauge(container, sensor) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 200 120');
        svg.setAttribute('class', 'gauge-svg');
        svg.innerHTML = `
            <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#2a2a3a" stroke-width="16" stroke-linecap="round"/>
            <path id="gauge-arc-${sensor.id}" d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#4fc3f7" stroke-width="16" stroke-linecap="round" stroke-dasharray="0 251"/>
            <text x="100" y="95" text-anchor="middle" fill="#e0e0e0" font-size="28" font-weight="bold" id="gauge-val-${sensor.id}">--</text>
            <text x="100" y="112" text-anchor="middle" fill="#888" font-size="12" id="gauge-unit-${sensor.id}">${sensor.unit}</text>
        `;
        container.appendChild(svg);
    },

    updateGauge(container, value, unit) {
        const num = parseFloat(value);
        if (isNaN(num)) return;

        const card = container.closest('.sensor-card');
        const min = 0;
        const max = 100;
        const pct = Math.max(0, Math.min(1, (num - min) / (max - min)));
        const arcLength = 251;
        const filled = pct * arcLength;

        const arc = document.getElementById(container.id.replace('widget-', 'gauge-arc-'));
        if (arc) arc.setAttribute('stroke-dasharray', `${filled} ${arcLength - filled}`);

        const valEl = document.getElementById(container.id.replace('widget-', 'gauge-val-'));
        if (valEl) valEl.textContent = Number.isInteger(num) ? num : num.toFixed(1);

        const color = pct < 0.3 ? '#4caf50' : pct < 0.7 ? '#4fc3f7' : '#ef5350';
        if (arc) arc.setAttribute('stroke', color);
    },

    renderSwitch(container, sensor) {
        container.innerHTML = `
            <div class="widget-switch">
                <div class="switch-track" id="switch-${sensor.id}">
                    <div class="switch-thumb"></div>
                </div>
                <span class="switch-label" id="switch-label-${sensor.id}">OFF</span>
            </div>
        `;
    },

    updateSwitch(container, value) {
        const track = container.querySelector('.switch-track');
        const label = container.querySelector('.switch-label');
        const isOn = value === '1' || value.toLowerCase() === 'on' || value.toLowerCase() === 'true';
        if (track) track.classList.toggle('active', isOn);
        if (label) label.textContent = isOn ? 'ON' : 'OFF';
    },

    renderChart(container, sensor) {
        const canvas = document.createElement('canvas');
        canvas.className = 'chart-canvas';
        canvas.id = 'chart-' + sensor.id;
        container.appendChild(canvas);
    },

    updateChart(container, history, unit) {
        const canvas = container.querySelector('.chart-canvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width || 200;
        canvas.height = rect.height || 100;

        const w = canvas.width;
        const h = canvas.height;
        const padding = 20;

        ctx.clearRect(0, 0, w, h);

        const values = history.map(p => parseFloat(p.value)).filter(v => !isNaN(v));
        if (values.length < 2) return;

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
        }

        ctx.beginPath();
        ctx.strokeStyle = '#4fc3f7';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';

        values.forEach((v, i) => {
            const x = padding + (i / (values.length - 1)) * (w - 2 * padding);
            const y = h - padding - ((v - min) / range) * (h - 2 * padding);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        ctx.fillStyle = '#888';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(max.toFixed(1) + unit, w - 5, padding + 4);
        ctx.fillText(min.toFixed(1) + unit, w - 5, h - padding + 12);
    }
};