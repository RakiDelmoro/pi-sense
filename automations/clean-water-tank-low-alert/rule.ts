import type { AutomationContext, AutomationRule } from '../../src/automation/types';
import { config } from './config';

/**
 * When clean water tank level drops to 15% or below, turns the Battery Hue light red.
 * Toggling the light off/on at the physical switch restores its normal power-on state.
 * The automation won't re-trigger until the clean water level recovers above 15% and drops again.
 */

/** Calibrated raw ADC range from sensors/clean-water-tank/config.ts */
const RAW_MIN = 480;
const RAW_MAX = 950;
const THRESHOLD_PCT = 15;
const THRESHOLD_RAW = Math.round(RAW_MIN + (RAW_MAX - RAW_MIN) * THRESHOLD_PCT / 100); // 550
const HUE_LIGHT_ID = 18; // Battery

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
