import { getHueLights, hueFetch, setHueLightState, type HueLight } from './hue';

/** Bridge scene IDs (GroupScene on the "Home" zone). Edit these to point at
 * different scenes without touching the rest of the logic. */
const BRIGHT_SCENE_ID = 'iSDKiwUQrINmKDi';
const RELAX_SCENE_ID = 'skJC3ZU-HHyYVO8';

const SCENE_EXCLUDED = new Set([
  'micah desk',
  'micah bed',
  'connie desk',
  'connie bed',
  'bathroom',
]);

interface SceneLightState {
  on?: boolean;
  bri?: number;
  ct?: number;
  xy?: [number, number];
  hue?: number;
  sat?: number;
}

/** Fetch the per-light states stored on a bridge scene. */
async function getSceneLightstates(
  sceneId: string,
): Promise<Record<string, SceneLightState>> {
  const res = await hueFetch(`/scenes/${sceneId}`);
  if (!res.ok) {
    throw new Error(`Hue scene fetch failed: ${await res.text()}`);
  }
  const data = (await res.json()) as Record<string, any>;
  if (data.error) {
    throw new Error(data.error);
  }
  return (data.lightstates ?? {}) as Record<string, SceneLightState>;
}

/** IDs of lights whose names match the exclusion list. */
function excludedLightIds(lights: HueLight[]): Set<string> {
  return new Set(
    lights
      .filter(l => SCENE_EXCLUDED.has(l.name.toLowerCase()))
      .map(l => l.id),
  );
}

/** Apply a bridge scene to all currently-on, reachable, non-excluded lights.
 *
 * Reads the scene's stored lightstates fresh from the bridge each call, so
 * edits made to the scene in the Hue app are picked up automatically. Only
 * the scene's per-light state (bri, ct, xy, hue, sat, on) is forwarded —
 * excluded lights are never addressed. */
export async function applyScene(name: 'bright' | 'relax'): Promise<{ changed: number }> {
  const sceneId = name === 'bright' ? BRIGHT_SCENE_ID : RELAX_SCENE_ID;
  const [lights, lightstates] = await Promise.all([
    getHueLights(),
    getSceneLightstates(sceneId),
  ]);

  const excluded = excludedLightIds(lights);
  const eligible = new Set(
    lights
      .filter(l => l.on && l.reachable && !excluded.has(l.id))
      .map(l => l.id),
  );

  const targets = Object.entries(lightstates).filter(
    ([id]) => eligible.has(id),
  );

  if (targets.length === 0) {
    console.log(`🌅 Scene ${name}: no eligible lights are currently on`);
    return { changed: 0 };
  }

  await Promise.all(
    targets.map(([id, state]) => setHueLightState(id, state as Record<string, unknown>)),
  );
  console.log(`🌅 Scene ${name} applied to ${targets.length} lights (recall ${sceneId})`);
  return { changed: targets.length };
}
