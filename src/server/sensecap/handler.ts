import { publish, subscribeMqtt, onSensorValue, onMqttMessage, onMqttConnect } from '../bridge/mqtt';
import { applyScene, publishCurrentSceneState } from '../services/scenes';

const WATER_LEVEL_SOURCE_TOPIC = 'esp/water-level';
const WATER_LEVEL_PUBLISH_TOPIC = 'pi-sense/water-level';
const WATER_LEVEL_RAW_MAX = 4095;

const BRIGHT_COMMAND_TOPIC = 'sensecap/bright_switch';
const RELAX_COMMAND_TOPIC = 'sensecap/relax_switch';

function handleCommand(topic: string, payload: Buffer): void {
  const command = payload.toString();
  if (command !== '1' && command !== '0') return;

  if (topic === BRIGHT_COMMAND_TOPIC && command === '1') {
    console.log('🎛️ SenseCap: Bright selected');
    applyScene('bright').catch(err =>
      console.error('SenseCap bright scene failed:', err),
    );
  }

  if (topic === RELAX_COMMAND_TOPIC && command === '1') {
    console.log('🎛️ SenseCap: Relax selected');
    applyScene('relax').catch(err =>
      console.error('SenseCap relax scene failed:', err),
    );
  }

  // '0' commands are intentionally ignored — they mirror the dashboard scene buttons,
  // which only change brightness of currently-on lights and never turn scenes off.
}

function publishWaterLevel(rawValue: number): void {
  const pct = Math.round((rawValue / WATER_LEVEL_RAW_MAX) * 1000) / 10; // 1 decimal
  const clamped = Math.max(0, Math.min(100, pct));
  publish(
    WATER_LEVEL_PUBLISH_TOPIC,
    { water_level: clamped },
    { qos: 1, retain: true },
  );
}

export function initSenseCapHandler(): void {
  subscribeMqtt(BRIGHT_COMMAND_TOPIC, 1);
  subscribeMqtt(RELAX_COMMAND_TOPIC, 1);
  onMqttConnect(() => publishCurrentSceneState());

  onMqttMessage((topic, payload) => {
    if (topic === BRIGHT_COMMAND_TOPIC || topic === RELAX_COMMAND_TOPIC) {
      handleCommand(topic, payload);
    }
  });

  onSensorValue((topic, value) => {
    if (topic === WATER_LEVEL_SOURCE_TOPIC) {
      publishWaterLevel(value);
    }
  });

  console.log('🎛️ SenseCap handler initialized');
}
