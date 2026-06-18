import { subscribeMqtt, onMqttMessage } from '../mqtt/mqtt';
import { applyScene } from './scenes';

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

export function initSenseCapHandler(): void {
  subscribeMqtt(BRIGHT_COMMAND_TOPIC, 1);
  subscribeMqtt(RELAX_COMMAND_TOPIC, 1);

  onMqttMessage((topic, payload) => {
    if (topic === BRIGHT_COMMAND_TOPIC || topic === RELAX_COMMAND_TOPIC) {
      handleCommand(topic, payload);
    }
  });

  console.log('🎛️ SenseCap handler initialized');
}
