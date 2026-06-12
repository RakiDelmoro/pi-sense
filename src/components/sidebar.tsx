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
};

const sectionIcons: Record<string, string> = {
  sensors: 'M3 12h2l3-8 4 16 3-8h6',
  lights: 'M9 18h6M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z',
  scenes: 'M4 6h2l2 10h8l2-10h2',
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
