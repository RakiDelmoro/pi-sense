import { getHueLights, setHueLightState, type HueLight } from './hue';

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

/** Apply a scene to all currently-on, reachable, non-excluded Hue lights. */
export async function applyScene(name: 'bright' | 'relax'): Promise<{ changed: number }> {
  const lights = await getHueLights();
  const targets = sceneTargets(lights);
  const bri = name === 'bright' ? BRIGHT_BRI : RELAX_BRI;

  if (targets.length === 0) {
    console.log(`🌅 Scene ${name}: no eligible lights are currently on`);
    return { changed: 0 };
  }

  await Promise.all(targets.map(l => setHueLightState(l.id, { bri })));
  console.log(`🌅 Scene ${name} applied to ${targets.length} lights`);
  return { changed: targets.length };
}
