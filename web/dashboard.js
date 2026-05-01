const WS_URL = `ws://${location.host}/ws`;
let ws;
let reconnectTimer;
const historyStore = {};

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

    let existing = document.getElementById('sensor-' + sensor.id);
    if (existing) existing.remove();

    const card = document.createElement('div');
    card.className = 'sensor-card';
    card.id = 'sensor-' + sensor.id;
    card.dataset.sensorId = sensor.id;
    card.dataset.widgetType = sensor.widget_type;
    card.dataset.unit = sensor.unit || '';
    card.dataset.topic = sensor.topic;
    card.dataset.broker = sensor.broker;
    card.dataset.allowPublish = sensor.allow_publish ? 'true' : 'false';
    card.dataset.publishTopic = sensor.publish_topic || '';
    card.dataset.alertMin = sensor.alert_min !== undefined ? sensor.alert_min : '';
    card.dataset.alertMax = sensor.alert_max !== undefined ? sensor.alert_max : '';
    card.dataset.lastValue = '';

    // Card accent color
    if (sensor.card_accent) {
        card.style.setProperty('--card-accent', sensor.card_accent);
        card.style.borderColor = sensor.card_accent;
    }

    // Card size
    if (sensor.card_size && sensor.card_size !== 'medium') {
        card.classList.add('card-' + sensor.card_size);
    }

    const header = document.createElement('div');
    header.className = 'sensor-header';
    const metaStyle = sensor.show_meta === false ? 'display:none' : '';
    header.innerHTML = `
        <span class="sensor-name">${sensor.name}</span>
        <span class="sensor-meta" style="${metaStyle}">${sensor.broker} · ${sensor.topic}</span>
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
            setupSwitchClick(widgetArea, sensor);
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

    // Initialize history for chart widgets
    if (sensor.widget_type === 'chart') {
        const key = 'pi-sense-history-' + sensor.id;
        const stored = localStorage.getItem(key);
        if (stored) {
            try {
                const history = JSON.parse(stored);
                historyStore[sensor.id] = history;
                PiSenseWidgets.updateChart(widgetArea, history, sensor.unit || '');
            } catch (e) {}
        } else {
            historyStore[sensor.id] = [];
        }
    }
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
            sensor_id: sensor.id,
            value: newValue
        }));
    });
}

function updateWidget(sensor) {
    const card = document.getElementById('sensor-' + sensor.id);
    if (!card) return;

    // Update sensor data attributes
    card.dataset.unit = sensor.unit || '';
    card.dataset.allowPublish = sensor.allow_publish ? 'true' : 'false';
    card.dataset.publishTopic = sensor.publish_topic || '';
    card.dataset.alertMin = sensor.alert_min !== undefined ? sensor.alert_min : '';
    card.dataset.alertMax = sensor.alert_max !== undefined ? sensor.alert_max : '';

    // Update accent
    if (sensor.card_accent) {
        card.style.setProperty('--card-accent', sensor.card_accent);
        card.style.borderColor = sensor.card_accent;
    }

    // Update card size class
    card.classList.remove('card-small', 'card-large');
    if (sensor.card_size && sensor.card_size !== 'medium') {
        card.classList.add('card-' + sensor.card_size);
    }

    // Update header
    const header = card.querySelector('.sensor-header');
    header.innerHTML = `
        <span class="sensor-name">${sensor.name}</span>
        <span class="sensor-meta">${sensor.broker} · ${sensor.topic}</span>
    `;

    // Re-render widget if type changed
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
        case 'chart':
            PiSenseWidgets.renderChart(widgetArea, sensor);
            break;
        default:
            PiSenseWidgets.renderText(widgetArea, sensor);
    }
}

function removeWidget(id) {
    const el = document.getElementById('sensor-' + id);
    if (el) {
        el.remove();
        const historyKey = 'pi-sense-history-' + id;
        localStorage.removeItem(historyKey);
        delete historyStore[id];
    }

    const dashboard = document.getElementById('dashboard');
    if (dashboard.children.length === 0) {
        document.getElementById('empty-state').style.display = 'flex';
    }
}

function handleHistoryData(sensorId, readings) {
    const history = readings.reverse().map(r => ({ value: r.value, timestamp: r.timestamp }));
    historyStore[sensorId] = history;
    localStorage.setItem('pi-sense-history-' + sensorId, JSON.stringify(history));

    const card = document.getElementById('sensor-' + sensorId);
    if (!card) return;

    const widgetArea = document.getElementById('widget-' + sensorId);
    if (card.dataset.widgetType === 'chart') {
        const unit = card.dataset.unit;
        PiSenseWidgets.updateChart(widgetArea, history, unit);
    }
}

function updateValue(sensorId, value, timestamp, alert) {
    const card = document.getElementById('sensor-' + sensorId);
    if (!card) return;

    card.dataset.lastValue = value;

    const widgetType = card.dataset.widgetType;
    const unit = card.dataset.unit;
    const widgetArea = document.getElementById('widget-' + sensorId);

    // Update history for charts
    if (widgetType === 'chart') {
        if (!historyStore[sensorId]) historyStore[sensorId] = [];
        historyStore[sensorId].push({ value, timestamp });
        const maxPoints = 120;
        if (historyStore[sensorId].length > maxPoints) {
            historyStore[sensorId] = historyStore[sensorId].slice(-maxPoints);
        }
        localStorage.setItem('pi-sense-history-' + sensorId, JSON.stringify(historyStore[sensorId]));
        PiSenseWidgets.updateChart(widgetArea, historyStore[sensorId], unit);
    }

    switch (widgetType) {
        case 'gauge':
            PiSenseWidgets.updateGauge(widgetArea, value, unit);
            break;
        case 'switch':
            PiSenseWidgets.updateSwitch(widgetArea, value);
            break;
        case 'chart':
            break;
        default:
            PiSenseWidgets.updateText(widgetArea, value, unit);
    }

    // Handle alert
    const hasAlert = alert === true || alert === 'true';
    card.classList.toggle('card-alert', hasAlert);

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