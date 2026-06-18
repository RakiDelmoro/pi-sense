/** Hue bridge helpers used by both the dashboard API and the SenseCap handler. */

function bridgeUrl(path: string): string {
  const ip = (process.env.HUE_BRIDGE_IP ?? '').trim();
  const key = (process.env.HUE_API_KEY ?? '').trim();
  return `http://${ip}/api/${key}${path}`;
}

export async function hueFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    const res = await fetch(bridgeUrl(path), init);
    const data = (await res.json()) as unknown;
    if (Array.isArray(data) && data[0]?.error) {
      return new Response(JSON.stringify({ error: data[0].error.description }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Hue bridge unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export interface HueLight {
  id: string;
  name: string;
  on: boolean;
  brightness: number;
  reachable: boolean;
  hue?: number;
  sat?: number;
  colormode?: string;
  ct?: number;
  xy?: [number, number];
  type: string;
}

function parseLight(id: string, raw: any): HueLight {
  return {
    id,
    name: raw.name ?? `Light ${id}`,
    on: raw.state?.on ?? false,
    brightness: raw.state?.bri ?? 0,
    reachable: raw.state?.reachable ?? true,
    hue: raw.state?.hue,
    sat: raw.state?.sat,
    colormode: raw.state?.colormode,
    ct: raw.state?.ct,
    xy: raw.state?.xy,
    type: raw.type ?? 'Extended color light',
  };
}

/** Fetch all lights from the Hue bridge. */
export async function getHueLights(): Promise<HueLight[]> {
  const res = await hueFetch('/lights');
  if (!res.ok) {
    throw new Error(`Hue bridge error: ${await res.text()}`);
  }
  const data = (await res.json()) as Record<string, any>;
  if (data.error) {
    throw new Error(data.error);
  }
  return Object.entries(data).map(([id, raw]) => parseLight(id, raw));
}

async function hueRequest(path: string, init: RequestInit, description?: string): Promise<unknown> {
  const res = await hueFetch(path, init);
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok || (Array.isArray(body) && body[0]?.error)) {
    const msg = Array.isArray(body) && body[0]?.error ? body[0].error.description : JSON.stringify(body);
    throw new Error(`${description ?? 'Hue request'} failed: ${msg}`);
  }
  console.log(`💡 Hue ${description ?? path} → ok`);
  return body;
}

/** Set the state of a single Hue light. */
export async function setHueLightState(
  lightId: string | number,
  state: Record<string, unknown>,
): Promise<unknown> {
  return hueRequest(
    `/lights/${lightId}/state`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    },
    `light ${lightId}`,
  );
}
