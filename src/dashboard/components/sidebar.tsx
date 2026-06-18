import { useState } from 'preact/hooks';
import '../styles/sidebar.css';

interface SidebarProps {
  sections: string[];
  activeSection: string;
  onSelect: (section: string) => void;
}

const sectionLabels: Record<string, string> = {
  sensors: 'Sensors',
  lights: 'Lights',
  scenes: 'Scenes',
  automations: 'Automations',
};

const sectionIcons: Record<string, string> = {
  sensors: 'M3 12h2l3-8 4 16 3-8h6',
  lights: 'M9 18h6M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z',
  scenes: 'M4 6h2l2 10h8l2-10h2',
  automations: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z',
};

export function Sidebar({ sections, activeSection, onSelect }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <nav class={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      {/* Logo row: logo + text + toggle */}
      <div class="sidebar-logo">
        <img class="sidebar-logo-img" src="/public/logo.png" alt="Pi" />
        <span class="sidebar-logo-text">Sense</span>
        <button
          class="sidebar-toggle"
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg class="sidebar-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            {collapsed
              ? <polyline points="9 18 15 12 9 6" />
              : <polyline points="15 18 9 12 15 6" />
            }
          </svg>
        </button>
      </div>

      {/* Nav items */}
      <ul class="sidebar-nav">
        {sections.map(section => (
          <li
            key={section}
            class={`sidebar-nav-item ${section === activeSection ? 'sidebar-nav-item--active' : ''}`}
            onClick={() => onSelect(section)}
            title={collapsed ? sectionLabels[section] ?? section : undefined}
          >
            <svg class="sidebar-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d={sectionIcons[section] ?? ''} />
            </svg>
            <span class="sidebar-nav-label">{sectionLabels[section] ?? section}</span>
          </li>
        ))}
      </ul>
    </nav>
  );
}
