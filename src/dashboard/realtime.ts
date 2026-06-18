import { onMqttMessage, subscribeMqtt } from '../mqtt/mqtt';
import { queryLatest } from '../influx/influx';
import { broadcastUpdate } from './websocket';
import { setAutomationEnabledState } from './automation-state';

// Dashboard-side MQTT listener. Subscribes to DB-update notifications and
// automation control state. The dashboard never sees raw sensor values — it
// always requeries InfluxDB on a notification, so the DB remains the only
// source of truth for what the browser displays.

const UPDATE_TOPIC_PREFIX = 'pi-sense/updates/';

export function startRealtimeListener() {
  subscribeMqtt('pi-sense/updates/#', 1);
  subscribeMqtt('automations/+/enabled', 1);

  onMqttMessage((topic, payload) => {
    if (topic.startsWith(UPDATE_TOPIC_PREFIX)) {
      const sensorTopic = topic.slice(UPDATE_TOPIC_PREFIX.length);
      queryLatest(sensorTopic).then(latest => {
        if (latest) {
          broadcastUpdate(sensorTopic, latest.value, latest.timestamp, latest.timeOffsetMs);
        }
      }).catch(err => console.error('realtime queryLatest error:', err));
      return;
    }

    const autoMatch = topic.match(/^automations\/([^/]+)\/enabled$/);
    if (autoMatch) {
      try {
        const data = JSON.parse(payload.toString());
        if (typeof data.enabled === 'boolean') {
          setAutomationEnabledState(autoMatch[1], data.enabled);
        }
      } catch { /* ignore invalid control payload */ }
      return;
    }
  });

  console.log('📡 Realtime listener started');
}
