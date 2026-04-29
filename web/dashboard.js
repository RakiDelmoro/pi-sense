const WS_URL = `ws://${location.host}/ws`;
let ws;
let reconnectTimer;

function connect() {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        clearTimeout(reconnectTimer);
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleDashboardMessage(msg);
    };

    ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
        ws.close();
    };
}

function handleDashboardMessage(msg) {
    switch (msg.type) {
        case 'state:full':
            renderFullState(msg.sensors);
            break;
        case 'widget:add':
            addWidget(msg.sensor);
            break;
        case 'widget:remove':
            removeWidget(msg.id);
            break;
        case 'value:update':
            updateValue(msg.sensor_id, msg.value, msg.timestamp);
            break;
    }
}

function renderFullState(sensors) {
    const dashboard = document.getElementById('dashboard');
    dashboard.innerHTML = '';
    const empty = document.getElementById('empty-state');

    if (!sensors || sensors.length === 0) {
        empty.style.display = 'flex';
        return;
    }

    empty.style.display = 'none';
    sensors.forEach(s => addWidget(s));
}

function addWidget(sensor) {
    const empty = document.getElementById('empty-state');
    empty.style.display = 'none';

    const dashboard = document.getElementById('dashboard');

    let existing = document.getElementById('sensor-' + sensor.id);
    if (existing) existing.remove();

    const card = document.createElement('div');
    card.className = 'sensor-card';
    card.id = 'sensor-' + sensor.id;
    card.dataset.sensorId = sensor.id;
    card.dataset.widgetType = sensor.widget_type;
    card.dataset.unit = sensor.unit;
    card.dataset.topic = sensor.topic;
    card.dataset.broker = sensor.broker;

    const header = document.createElement('div');
    header.className = 'sensor-header';
    header.innerHTML = `
        <span class="sensor-name">${sensor.name}</span>
        <span class="sensor-meta">${sensor.broker} · ${sensor.topic}</span>
    `;
    card.appendChild(header);

    const valueContainer = document.createElement('div');
    valueContainer.className = 'sensor-value-container';

    const widgetArea = document.createElement('div');
    widgetArea.className = 'sensor-widget';
    widgetArea.id = 'widget-' + sensor.id;

    switch (sensor.widget_type) {
        case 'gauge':
            PiSenseWidgets.renderGauge(widgetArea, sensor);
            break;
        case 'switch':
            PiSenseWidgets.renderSwitch(widgetArea, sensor);
            break;
        case 'chart':
            PiSenseWidgets.renderChart(widgetArea, sensor);
            break;
        default:
            PiSenseWidgets.renderText(widgetArea, sensor);
    }

    valueContainer.appendChild(widgetArea);

    const timestamp = document.createElement('div');
    timestamp.className = 'sensor-timestamp';
    timestamp.id = 'ts-' + sensor.id;
    timestamp.textContent = 'waiting for data...';

    card.appendChild(valueContainer);
    card.appendChild(timestamp);
    dashboard.appendChild(card);
}

function removeWidget(id) {
    const el = document.getElementById('sensor-' + id);
    if (el) {
        el.remove();
        const historyKey = 'pi-sense-history-' + id;
        localStorage.removeItem(historyKey);
    }

    const dashboard = document.getElementById('dashboard');
    if (dashboard.children.length === 0) {
        document.getElementById('empty-state').style.display = 'flex';
    }
}

function updateValue(sensorId, value, timestamp) {
    const card = document.getElementById('sensor-' + sensorId);
    if (!card) return;

    const widgetType = card.dataset.widgetType;
    const unit = card.dataset.unit;
    const widgetArea = document.getElementById('widget-' + sensorId);

    const historyKey = 'pi-sense-history-' + sensorId;
    let history = JSON.parse(localStorage.getItem(historyKey) || '[]');
    history.push({ value, timestamp });
    if (history.length > 120) history = history.slice(-120);
    localStorage.setItem(historyKey, JSON.stringify(history));

    switch (widgetType) {
        case 'gauge':
            PiSenseWidgets.updateGauge(widgetArea, value, unit);
            break;
        case 'switch':
            PiSenseWidgets.updateSwitch(widgetArea, value);
            break;
        case 'chart':
            PiSenseWidgets.updateChart(widgetArea, history, unit);
            break;
        default:
            PiSenseWidgets.updateText(widgetArea, value, unit);
    }

    const tsEl = document.getElementById('ts-' + sensorId);
    if (tsEl) {
        tsEl.textContent = formatTimeAgo(timestamp);
    }
}

function formatTimeAgo(ts) {
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 5) return 'just now';
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    return Math.floor(diff / 3600) + 'h ago';
}

setInterval(() => {
    document.querySelectorAll('.sensor-timestamp').forEach(el => {
        const card = el.closest('.sensor-card');
        if (!card) return;
    });
}, 1000);

connect();