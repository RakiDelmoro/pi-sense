import type { AutomationConfig } from '../../src/automation/types';

export const config: AutomationConfig = {
  slug: 'clean-water-tank-low-alert',
  label: 'Clean Water Tank Low Alert',
  topic: 'esp/clean-tank',
  valueKey: 'water_level',
  enabled: false,
  description: 'Turns the Battery Hue light red when clean water tank drops to 15% or below.',
};
