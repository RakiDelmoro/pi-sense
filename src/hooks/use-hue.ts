import { useState, useEffect, useCallback } from 'preact/hooks';

export interface HueLight {
  id: string;
  name: string;
  on: boolean;
  brightness: number; // 0–254
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

export function useHueLights() {
  const [lights, setLights] = useState<HueLight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLights = useCallback(async () => {
    try {
      const res = await fetch('/api/hue/lights');
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setLights([]);
      } else {
        setError(null);
        const parsed = Object.entries(data).map(([id, raw]) =>
          parseLight(id, raw as any)
        );
        setLights(parsed);
      }
    } catch {
      setError('Failed to fetch lights');
      setLights([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLights();
  }, [fetchLights]);

  const setLightState = useCallback(async (id: string, state: Record<string, any>) => {
    const res = await fetch(`/api/hue/lights/${id}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error ?? 'Failed to set light state');
    }

    // Optimistically update local state so the UI responds instantly
    setLights(prev =>
      prev.map(l => {
        if (l.id !== id) return l;
        const next = { ...l };
        if ('on' in state) next.on = state.on;
        if ('bri' in state) next.brightness = state.bri;
        return next;
      })
    );
  }, []);

  return { lights, loading, error, refresh: fetchLights, setLightState };
}
