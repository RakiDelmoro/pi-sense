import { useState } from 'preact/hooks';
import { Header } from './components/header';
import { Sidebar } from './components/sidebar';
import { Starfield } from './components/starfield';
import { LightCard } from './components/light-card';
import { useHueLights } from './hooks/use-hue';

import sensorRegistry from './sensor-registry';
import './styles/light-card.css';

/** Fixed navigation sections in the sidebar. */
const SECTIONS = ['sensors', 'lights'] as const;

const sortedRegistry = [...sensorRegistry].sort((a, b) => {
  const weightA = a.config.layoutWeight ?? 999;
  const weightB = b.config.layoutWeight ?? 999;
  return weightA - weightB;
});

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
