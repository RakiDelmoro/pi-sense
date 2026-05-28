import { Header } from './components/header';
import { Welcome } from './components/welcome';
import { Starfield } from './components/starfield';

// Auto-discovered sensor registry — generated at build time by server.ts
// Contains static imports for all sensors/*/sensor.tsx files
import sensorRegistry from './sensor-registry';

const sensorCards = sensorRegistry.map(({ slug, Component }) => (
  <Component key={slug} />
));

export function App() {
  return (
    <div class="dashboard">
      <Starfield />
      <Header />
      <main class="dashboard-content">
        {sensorCards.length > 0 ? (
          <div class="sensor-grid">
            {sensorCards}
          </div>
        ) : (
          <Welcome />
        )}
      </main>
    </div>
  );
}
