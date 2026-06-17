import type { AutomationContext, AutomationRule } from '../../src/automation/types';
import { config } from './config';

/**
 * When water level drops to 15% or below, turns the Front Door Hue light red.
 * Toggling the light off/on at the physical switch restores its normal power-on state.
 * The automation won't re-trigger until the water level recovers above 15% and drops again.
 */

const RAW_MAX = 4095;
const THRESHOLD_PCT = 15;
const THRESHOLD_RAW = Math.round(RAW_MAX * THRESHOLD_PCT / 100); // 614
const HUE_LIGHT_ID = 17; // Front Door

let triggered = false;

const rule: AutomationRule = {
  ...config,

  evaluate(ctx: AutomationContext) {
    if (!triggered && ctx.value <= THRESHOLD_RAW) {
      triggered = true;
      return {
        type: 'hue',
        lightId: HUE_LIGHT_ID,
        state: { on: true, bri: 254, hue: 0, sat: 254 }, // bright red
      };
    }

    if (triggered && ctx.value > THRESHOLD_RAW) {
      triggered = false;
    }

    return null;
  },
};

export default rule;
