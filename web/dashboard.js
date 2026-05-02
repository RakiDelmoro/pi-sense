const WS_URL = `ws://${location.host}/ws`;
let ws;
let reconnectTimer;
const sensorData = {};

function connect() {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        clearTimeout(reconnectTimer);
        document.getElementById('connection-status').className = 'connected';
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleDashboardMessage(msg);
    };

    ws.onclose = () => {
        document.getElementById('connection-status').className = 'disconnected';
        reconnectTimer = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
        document.getElementById('connection-status').className = 'disconnected';
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
        case 'widget:update':
            updateWidget(msg.sensor);
            break;
        case 'value:update':
            updateValue(msg.sensor_id, msg.value, msg.timestamp, msg.alert);
            break;
        case 'history:data':
            handleHistoryData(msg.sensor_id, msg.readings);
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

    let existing = document.getElementById('sensor-' + sensor.name);
    if (existing) existing.remove();

    sensorData[sensor.name] = sensor;

    const card = document.createElement('div');
    card.className = 'sensor-card';
    card.id = 'sensor-' + sensor.name;
    card.dataset.sensorName = sensor.name;
    card.dataset.widgetType = sensor.widget_type;
    card.dataset.unit = sensor.unit || '';
    card.dataset.topic = sensor.topic;
    card.dataset.broker = sensor.broker;
    card.dataset.allowPublish = sensor.allow_publish ? 'true' : 'false';
    card.dataset.publishTopic = sensor.publish_topic || '';
    card.dataset.alertMin = sensor.alert_min !== undefined ? sensor.alert_min : '';
    card.dataset.alertMax = sensor.alert_max !== undefined ? sensor.alert_max : '';
    card.dataset.lastValue = '';
    card.dataset.chartColor = sensor.chart_color || '#4fc3f7';

    if (sensor.card_accent) {
        card.style.setProperty('--card-accent', sensor.card_accent);
        card.style.borderColor = sensor.card_accent;
    }

    if (sensor.card_size && sensor.card_size !== 'medium') {
        card.classList.add('card-' + sensor.card_size);
    }

    const header = document.createElement('div');
    header.className = 'sensor-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'sensor-header-left';
    headerLeft.innerHTML = `
        <span class="sensor-name">${sensor.name}</span>
        <span class="sensor-meta">${sensor.broker} · ${sensor.topic}</span>
    `;
    header.appendChild(headerLeft);

    if (sensor.history_chart) {
        const chartBtn = document.createElement('button');
        chartBtn.className = 'chart-icon-btn';
        chartBtn.innerHTML = '&#x1F4C8;';
        chartBtn.title = 'View history';
        chartBtn.addEventListener('click', () => openChartOverlay(sensor.name));
        header.appendChild(chartBtn);
    }

    card.appendChild(header);

    const valueContainer = document.createElement('div');
    valueContainer.className = 'sensor-value-container';

    const widgetArea = document.createElement('div');
    widgetArea.className = 'sensor-widget';
    widgetArea.id = 'widget-' + sensor.name;

    switch (sensor.widget_type) {
        case 'gauge':
            PiSenseWidgets.renderGauge(widgetArea, sensor);
            break;
        case 'switch':
            PiSenseWidgets.renderSwitch(widgetArea, sensor);
            setupSwitchClick(widgetArea, sensor);
            break;
        default:
            PiSenseWidgets.renderText(widgetArea, sensor);
    }

    valueContainer.appendChild(widgetArea);

    const timestamp = document.createElement('div');
    timestamp.className = 'sensor-timestamp';
    timestamp.id = 'ts-' + sensor.name;
    timestamp.textContent = 'waiting for data...';

    card.appendChild(valueContainer);
    card.appendChild(timestamp);
    dashboard.appendChild(card);
}

function setupSwitchClick(widgetArea, sensor) {
    const track = widgetArea.querySelector('.switch-track');
    if (!track || !sensor.allow_publish || !sensor.publish_topic) return;

    track.style.cursor = 'pointer';
    track.addEventListener('click', () => {
        const card = widgetArea.closest('.sensor-card');
        const lastValue = card.dataset.lastValue;
        const newValue = (lastValue === '1' || lastValue.toLowerCase() === 'on' || lastValue.toLowerCase() === 'true') ? '0' : '1';

        ws.send(JSON.stringify({
            type: 'sensor:publish',
            sensor_id: sensor.name,
            value: newValue
        }));
    });
}

function updateWidget(sensor) {
    const card = document.getElementById('sensor-' + sensor.name);
    if (!card) return;

    sensorData[sensor.name] = sensor;

    card.dataset.unit = sensor.unit || '';
    card.dataset.allowPublish = sensor.allow_publish ? 'true' : 'false';
    card.dataset.publishTopic = sensor.publish_topic || '';
    card.dataset.alertMin = sensor.alert_min !== undefined ? sensor.alert_min : '';
    card.dataset.alertMax = sensor.alert_max !== undefined ? sensor.alert_max : '';
    card.dataset.chartColor = sensor.chart_color || '#4fc3f7';

    if (sensor.card_accent) {
        card.style.setProperty('--card-accent', sensor.card_accent);
        card.style.borderColor = sensor.card_accent;
    }

    card.classList.remove('card-small', 'card-large');
    if (sensor.card_size && sensor.card_size !== 'medium') {
        card.classList.add('card-' + sensor.card_size);
    }

    const header = card.querySelector('.sensor-header');
    const headerLeft = header.querySelector('.sensor-header-left');
    headerLeft.innerHTML = `
        <span class="sensor-name">${sensor.name}</span>
        <span class="sensor-meta">${sensor.broker} · ${sensor.topic}</span>
    `;

    let chartBtn = header.querySelector('.chart-icon-btn');
    if (sensor.history_chart && !chartBtn) {
        chartBtn = document.createElement('button');
        chartBtn.className = 'chart-icon-btn';
        chartBtn.innerHTML = '&#x1F4C8;';
        chartBtn.title = 'View history';
        chartBtn.addEventListener('click', () => openChartOverlay(sensor.name));
        header.appendChild(chartBtn);
    } else if (!sensor.history_chart && chartBtn) {
        chartBtn.remove();
    }

    const widgetArea = card.querySelector('.sensor-widget');
    widgetArea.innerHTML = '';

    switch (sensor.widget_type) {
        case 'gauge':
            PiSenseWidgets.renderGauge(widgetArea, sensor);
            break;
        case 'switch':
            PiSenseWidgets.renderSwitch(widgetArea, sensor);
            setupSwitchClick(widgetArea, sensor);
            break;
        default:
            PiSenseWidgets.renderText(widgetArea, sensor);
    }

    const lastValue = card.dataset.lastValue;
    if (lastValue) {
        updateValue(sensor.name, lastValue, Math.floor(Date.now() / 1000), false);
    }
}

function removeWidget(name) {
    const el = document.getElementById('sensor-' + name);
    if (el) el.remove();
    delete sensorData[name];

    const dashboard = document.getElementById('dashboard');
    if (dashboard.children.length === 0) {
        document.getElementById('empty-state').style.display = 'flex';
    }
}

function handleHistoryData(sensorName, readings) {
    if (chartOverlaySensor === sensorName) {
        const sensor = sensorData[sensorName];
        const color = sensor ? (sensor.chart_color || '#4fc3f7') : '#4fc3f7';
        requestAnimationFrame(() => {
            PiSenseWidgets.renderChartOverlay(sensor || { name: sensorName, unit: '' }, readings, color);
        });
    }
}

let chartOverlaySensor = null;

function openChartOverlay(sensorName) {
    chartOverlaySensor = sensorName;
    const overlay = document.getElementById('chart-overlay');
    overlay.classList.remove('hidden');

    ws.send(JSON.stringify({
        type: 'history:request',
        sensor_id: sensorName
    }));
}

function closeChartOverlay() {
    const overlay = document.getElementById('chart-overlay');
    overlay.classList.add('hidden');
    chartOverlaySensor = null;
}

document.getElementById('chart-overlay-close').addEventListener('click', closeChartOverlay);
document.getElementById('chart-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'chart-overlay') closeChartOverlay();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeChartOverlay();
});

function updateValue(sensorName, value, timestamp, alert) {
    const card = document.getElementById('sensor-' + sensorName);
    if (!card) return;

    card.dataset.lastValue = value;

    const widgetType = card.dataset.widgetType;
    const unit = card.dataset.unit;
    const widgetArea = document.getElementById('widget-' + sensorName);

    switch (widgetType) {
        case 'gauge':
            PiSenseWidgets.updateGauge(widgetArea, value, unit);
            break;
        case 'switch':
            PiSenseWidgets.updateSwitch(widgetArea, value);
            break;
        default:
            PiSenseWidgets.updateText(widgetArea, value, unit);
    }

    const hasAlert = alert === true || alert === 'true';
    card.classList.toggle('card-alert', hasAlert);

    const tsEl = document.getElementById('ts-' + sensorName);
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