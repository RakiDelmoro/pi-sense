import { useState } from 'preact/hooks';
import { Header } from './components/header';
import { Sidebar } from './components/sidebar';
import { Starfield } from './components/starfield';
import { LightCard } from './components/light-card';
import { AutomationsSection } from './components/automation-section';
import { useHueLights } from './hooks/use-hue';

import sensorRegistry from './sensor-registry';
import './styles/light-card.css';
import './styles/scene.css';
import './styles/automation-section.css';

/** Fixed navigation sections in the sidebar. */
const SECTIONS = ['sensors', 'lights', 'scenes', 'automations'] as const;

const sortedRegistry = [...sensorRegistry].sort((a, b) => {
  const weightA = a.config.layoutWeight ?? 999;
  const weightB = b.config.layoutWeight ?? 999;
  return weightA - weightB;
});

/** Lights excluded from scene control — these keep their current brightness. */
const SCENE_EXCLUDED = new Set([
  'micah desk', 'micah bed',
  'connie desk', 'connie bed',
  'bathroom',
]);

function ScenesSection() {
  const { lights, applyScene } = useHueLights();
  const [busy, setBusy] = useState<string | null>(null);

  // Determine active scene from current light states
  const sceneLights = lights.filter(l => l.on && l.reachable && !SCENE_EXCLUDED.has(l.name.toLowerCase()));
  const avgBri = sceneLights.length > 0
    ? sceneLights.reduce((sum, l) => sum + l.brightness, 0) / sceneLights.length
    : 0;
  const activeScene = busy ?? (avgBri <= (80 + 254) / 2 ? 'relax' : 'bright');

  const handleScene = async (name: 'bright' | 'relax') => {
    setBusy(name);
    try {
      await applyScene(name);
    } catch (err) {
      console.error('Scene failed:', err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="scene-grid">
      <button
        class={`scene-btn scene-btn--relax ${activeScene === 'relax' ? 'scene-btn--active' : ''}`}
        disabled={busy !== null}
        onClick={() => handleScene('relax')}
      >
        <span class="scene-btn__dot" />
        <div class="scene-btn__icon-wrap">
          <svg class="scene-btn__svg" viewBox="0 0 32 32" fill="none">
            <path d="M24 17A11 11 0 0 1 10 6.5 11 11 0 1 0 24 17z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
          </svg>
        </div>
        <span class="scene-btn__label">Relax</span>
        <span class="scene-btn__desc">Dim non-bedroom lights</span>
        {busy === 'relax' && <span class="scene-btn__spinner" />}
      </button>
      <button
        class={`scene-btn scene-btn--bright ${activeScene === 'bright' ? 'scene-btn--active' : ''}`}
        disabled={busy !== null}
        onClick={() => handleScene('bright')}
      >
        <span class="scene-btn__dot" />
        <div class="scene-btn__icon-wrap">
          <svg class="scene-btn__svg" viewBox="0 0 32 32" fill="none">
            <path d="M16 3v4M16 25v4M3 16h4M25 16h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            <path d="M16 10a6 6 0 1 0 0 12 6 6 0 0 0 0-12z" fill="currentColor" opacity="0.15" stroke="currentColor" stroke-width="1.5" />
            <path d="M7.5 7.5l2.8 2.8M21.7 21.7l2.8 2.8M7.5 24.5l2.8-2.8M21.7 10.3l2.8-2.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </div>
        <span class="scene-btn__label">Bright</span>
        <span class="scene-btn__desc">Full brightness on non-bedroom lights</span>
        {busy === 'bright' && <span class="scene-btn__spinner" />}
      </button>
    </div>
  );
}
function LightsSection() {
  const { lights, loading, error, setLightState } = useHueLights();

  if (loading) return <div class="section-status">Loading…</div>;
  if (error) return <div class="section-status section-status--error">{error}</div>;
  if (lights.length === 0) return <div class="section-status">No lights found</div>;

  return (
    <div class="sensor-grid">
      {lights.map(light => (
        <LightCard
          key={light.id}
          light={light}
          onSetState={setLightState}
        />
      ))}
    </div>
  );
}

export function App() {
  const [activeSection, setActiveSection] = useState<string>('sensors');

  const sensorCards = sortedRegistry
    .filter(entry => (entry.config.section ?? 'sensors') === activeSection)
    .map(({ slug, Component }) => <Component key={slug} />);

  return (
    <div class="dashboard">
      <Starfield />
      <Header />
      <main class="dashboard-content">
        <Sidebar
          sections={[...SECTIONS]}
          activeSection={activeSection}
          onSelect={setActiveSection}
        />
        <div class="dashboard-main">
          {activeSection === 'lights' ? (
            <LightsSection />
          ) : activeSection === 'scenes' ? (
            <ScenesSection />
          ) : activeSection === 'automations' ? (
            <AutomationsSection />
          ) : sensorCards.length > 0 ? (
            <div class="sensor-grid">
              {sensorCards}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
