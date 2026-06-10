import { useCallback, useState, useRef, useEffect } from 'preact/hooks';
import type { HueLight } from '../hooks/use-hue';
import '../styles/light-card.css';

interface LightCardProps {
  light: HueLight;
  onSetState: (id: string, state: Record<string, any>) => Promise<void>;
}

export function LightCard({ light, onSetState }: LightCardProps) {
  const { id, name, on, brightness, reachable } = light;
  const [busy, setBusy] = useState(false);
  const [localBri, setLocalBri] = useState(brightness);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pct = on ? Math.round((localBri / 254) * 100) : 0;
  const glow = on ? pct / 100 : 0; // 0–1

  // Sync local slider when bridge state changes
  useEffect(() => { setLocalBri(brightness); }, [brightness]);

  // Computed bulb colors
  const glassFill = on
    ? `rgba(250, 204, 21, ${0.08 + 0.52 * glow})`
    : 'rgba(255, 255, 255, 0.02)';
  const glassStroke = on
    ? `rgba(250, 204, 21, ${0.25 + 0.75 * glow})`
    : '#52525b';
  const filamentColor = on
    ? `rgba(250, 204, 21, ${0.25 + 0.75 * glow})`
    : '#3f3f46';
  const glowOpacity = glow * 0.18;

  const send = useCallback(async (state: Record<string, any>) => {
    if (busy) return;
    setBusy(true);
    try {
      await onSetState(id, state);
    } catch {
      // State will self-correct on next refresh
    } finally {
      setBusy(false);
    }
  }, [id, busy, onSetState]);

  const togglePower = useCallback(() => {
    send({ on: !on });
  }, [on, send]);

  const handleBrightness = useCallback((e: Event) => {
    const target = e.target as HTMLInputElement;
    const bri = parseInt(target.value, 10);
    if (isNaN(bri)) return;
    setLocalBri(bri);

    // Debounce API call — slider stays smooth, bridge gets updates after pause
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSetState(id, { on: true, bri });
    }, 120);
  }, [id, onSetState]);

  return (
    <div class={`sensor-card light-card ${!reachable ? 'light-card--unreachable' : ''}`}>
      <div class="sensor-card__header">
        <span class="sensor-card__label">{name}</span>
        {!reachable && <span class="light-card__badge">offline</span>}
      </div>
      <div class="sensor-card__body">
        {/* Bulb — click to toggle on/off */}
        <button
          type="button"
          class="light-card__bulb"
          onClick={togglePower}
          disabled={!reachable || busy}
          aria-label={on ? 'Turn off' : 'Turn on'}
        >
          <div
            class="light-card__bulb-radiance"
            style={{ opacity: glowOpacity }}
          />
          <svg class="light-card__bulb-icon" viewBox="0 0 64 80" fill="none">
            <path
              class="light-card__bulb-glass"
              d="M22 38 C22 38 18 34 18 24 C18 13 24 8 32 8 C40 8 46 13 46 24 C46 34 42 38 42 38 L42 44 L22 44 Z"
              style={{ fill: glassFill, stroke: glassStroke }}
            />
            <path
              class="light-card__bulb-filament"
              d="M28 30 Q30 22 32 30 Q34 22 36 30"
              stroke-linecap="round"
              stroke-linejoin="round"
              style={{ stroke: filamentColor }}
            />
            <rect class="light-card__bulb-base" x="22" y="44" width="20" height="4" rx="1" />
            <rect class="light-card__bulb-base" x="24" y="49" width="16" height="3" rx="1" />
            <rect class="light-card__bulb-base" x="22" y="53" width="20" height="4" rx="1" />
            <path class="light-card__bulb-base" d="M27 57 L37 57 L34 63 L30 63 Z" />
          </svg>
        </button>
      </div>
      {on && (
        <div class="light-card__brightness">
          <input
            type="range"
            min="1"
            max="254"
            value={localBri}
            class="light-card__slider"
            style={{ '--slider-fill': `${pct}%` } as any}
            onInput={handleBrightness}
            disabled={!reachable}
          />
        </div>
      )}
    </div>
  );
}
