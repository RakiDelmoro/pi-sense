interface SensorReading {
  value: number;
  unit: string;
  status: 'online' | 'offline' | 'warning';
  lastUpdate: Date;
  battery: number;
}

interface Sensor {
  id: string;
  name: string;
  location: string;
  type: 'temperature' | 'humidity' | 'motion' | 'airQuality' | 'doorWindow';
  reading: SensorReading;
}

const icons: Record<Sensor['type'], string> = {
  temperature: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>`,
  humidity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`,
  motion: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
  airQuality: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>`,
  doorWindow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>`,
};

const sensors: Sensor[] = [
  {
    id: 'temp-01',
    name: 'Temperature',
    location: 'Living Room',
    type: 'temperature',
    reading: {
      value: 22.4,
      unit: '°C',
      status: 'online',
      lastUpdate: new Date(),
      battery: 87,
    },
  },
  {
    id: 'hum-01',
    name: 'Humidity',
    location: 'Living Room',
    type: 'humidity',
    reading: {
      value: 48,
      unit: '%',
      status: 'online',
      lastUpdate: new Date(),
      battery: 92,
    },
  },
  {
    id: 'mot-01',
    name: 'Motion',
    location: 'Front Hall',
    type: 'motion',
    reading: {
      value: 0,
      unit: 'events',
      status: 'online',
      lastUpdate: new Date(),
      battery: 64,
    },
  },
  {
    id: 'aq-01',
    name: 'Air Quality',
    location: 'Kitchen',
    type: 'airQuality',
    reading: {
      value: 42,
      unit: 'AQI',
      status: 'warning',
      lastUpdate: new Date(),
      battery: 78,
    },
  },
  {
    id: 'dw-01',
    name: 'Front Door',
    location: 'Entrance',
    type: 'doorWindow',
    reading: {
      value: 1,
      unit: 'closed',
      status: 'online',
      lastUpdate: new Date(),
      battery: 55,
    },
  },
  {
    id: 'dw-02',
    name: 'Back Window',
    location: 'Kitchen',
    type: 'doorWindow',
    reading: {
      value: 0,
      unit: 'open',
      status: 'online',
      lastUpdate: new Date(),
      battery: 91,
    },
  },
];

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diff < 10) return 'Just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function createSensorCard(sensor: Sensor): HTMLElement {
  const card = document.createElement('div');
  card.className = 'sensor-card';
  card.setAttribute('data-sensor-id', sensor.id);

  const reading = sensor.reading;
  const statusClass = reading.status;
  const displayValue = sensor.type === 'doorWindow'
    ? (reading.value === 1 ? 'Closed' : 'Open')
    : reading.value.toFixed(sensor.type === 'temperature' ? 1 : 0);
  const displayUnit = sensor.type === 'doorWindow' ? '' : reading.unit;

  card.innerHTML = `
    <div class="sensor-card-header">
      <div class="sensor-icon-wrap">
        ${icons[sensor.type]}
      </div>
      <span class="sensor-status-badge ${statusClass}">${reading.status}</span>
    </div>
    <div class="sensor-info">
      <div class="sensor-name">${sensor.name}</div>
      <div class="sensor-location">${sensor.location}</div>
    </div>
    <div class="sensor-value-wrap">
      <span class="sensor-value">${displayValue}</span>
      ${displayUnit ? `<span class="sensor-unit">${displayUnit}</span>` : ''}
    </div>
    <div class="sensor-footer">
      <span class="sensor-last-update" data-timestamp="${reading.lastUpdate.toISOString()}">${formatTimeAgo(reading.lastUpdate)}</span>
      <div class="sensor-battery">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="16" height="10" rx="2" ry="2"/><line x1="22" y1="11" x2="22" y2="13"/></svg>
        ${reading.battery}%
      </div>
    </div>
  `;

  return card;
}

function renderSensors(): void {
  const grid = document.getElementById('sensor-grid');
  const count = document.getElementById('sensor-count');
  if (!grid || !count) return;

  grid.innerHTML = '';
  sensors.forEach(sensor => {
    grid.appendChild(createSensorCard(sensor));
  });

  const activeCount = sensors.filter(s => s.reading.status !== 'offline').length;
  count.textContent = `${activeCount} active`;
}

function updateLastSync(): void {
  const syncEl = document.getElementById('last-sync');
  if (syncEl) {
    syncEl.textContent = 'Synced just now';
  }
}

function tickTimestamps(): void {
  document.querySelectorAll<HTMLElement>('.sensor-last-update').forEach(el => {
    const ts = el.getAttribute('data-timestamp');
    if (ts) {
      el.textContent = formatTimeAgo(new Date(ts));
    }
  });
}

function init(): void {
  renderSensors();
  updateLastSync();

  const yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear().toString();

  // Update relative timestamps every 30s
  setInterval(tickTimestamps, 30000);

  // Simulate a value update every 10s for interactivity demo
  setInterval(() => {
    const tempSensor = sensors.find(s => s.id === 'temp-01');
    if (tempSensor) {
      const variation = (Math.random() - 0.5) * 0.4;
      tempSensor.reading.value = Math.max(18, Math.min(26, tempSensor.reading.value + variation));
      tempSensor.reading.lastUpdate = new Date();
      renderSensors();
    }
  }, 10000);
}

init();
