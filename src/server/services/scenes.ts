import { publish } from '../bridge/mqtt';
import { getHueLights, setHueLightState, type HueLight } from './hue';

const BRIGHT_STATE_TOPIC = 'sensecap/bright_switch/state';
const RELAX_STATE_TOPIC = 'sensecap/relax_switch/state';
const RELAX_BRI = 80;
const BRIGHT_BRI = 254;

const SCENE_EXCLUDED = new Set([
  'micah desk',
  'micah bed',
  'connie desk',
  'connie bed',
  'bathroom',
]);

function sceneTargets(lights: HueLight[]): HueLight[] {
  return lights.filter(
    l => l.on && l.reachable && !SCENE_EXCLUDED.has(l.name.toLowerCase()),
  );
}

function publishState(active: 'bright' | 'relax'): void {
  if (active === 'bright') {
    publish(BRIGHT_STATE_TOPIC, '1', { qos: 1, retain: true });
    publish(RELAX_STATE_TOPIC, '0', { qos: 1, retain: true });
  } else {
    publish(BRIGHT_STATE_TOPIC, '0', { qos: 1, retain: true });
    publish(RELAX_STATE_TOPIC, '1', { qos: 1, retain: true });
  }
}

function detectActiveScene(lights: HueLight[]): 'bright' | 'relax' | null {
  const targets = sceneTargets(lights);
  if (targets.length === 0) return null;
  const avgBri =
    targets.reduce((sum, l) => sum + l.brightness, 0) / targets.length;
  return avgBri > (RELAX_BRI + BRIGHT_BRI) / 2 ? 'bright' : 'relax';
}

/** Apply a scene to all currently-on, reachable, non-excluded Hue lights and publish SenseCap state. */
export async function applyScene(name: 'bright' | 'relax'): Promise<{ changed: number }> {
  const lights = await getHueLights();
  const targets = sceneTargets(lights);
  const bri = name === 'bright' ? BRIGHT_BRI : RELAX_BRI;

  if (targets.length === 0) {
    console.log(`🌅 Scene ${name}: no eligible lights are currently on`);
    publishState(name);
    return { changed: 0 };
  }

  await Promise.all(targets.map(l => setHueLightState(l.id, { bri })));
  publishState(name);
  console.log(`🌅 Scene ${name} applied to ${targets.length} lights`);
  return { changed: targets.length };
}

/** Publish retained state matching the current Hue scene so external devices boot in sync. */
export async function publishCurrentSceneState(): Promise<void> {
  const lights = await getHueLights();
  const active = detectActiveScene(lights);
  if (active) {
    publishState(active);
    console.log(`🌅 Published SenseCap state for current scene: ${active}`);
  }
}
