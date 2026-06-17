import type { AutomationConfig } from '../../src/automation/types';

export const config: AutomationConfig = {
  slug: 'water-tank-low-alert',
  label: 'Water Tank Low Alert',
  topic: 'esp/water-level',
  valueKey: 'water_level',
  enabled: true,
  description: 'Turns the Front Door Hue light red when water level drops to 15% or below.',
};
