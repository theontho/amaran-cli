import type { FixtureState } from './telink.js';

export function interpolateState(from: FixtureState, to: FixtureState, fraction: number): FixtureState {
  if (from.mode === 'effect' || to.mode === 'effect') throw new Error('Transitions require steady CCT or HSI states');
  const start = from.sleep ? 0 : from.intensity;
  const end = to.sleep ? 0 : to.intensity;
  const mix = (a: number, b: number) => a + (b - a) * fraction;
  if (from.mode !== to.mode) {
    const state = fraction < 0.5 ? from : to;
    const intensity = fraction < 0.5 ? start * (1 - fraction * 2) : end * (fraction * 2 - 1);
    return { ...state, sleep: false, intensity: Math.round(intensity / 10) * 10 };
  }
  const state: FixtureState = { ...to, sleep: false, intensity: Math.round(mix(start, end) / 10) * 10 };
  if (to.mode === 'cct') {
    if (from.cct === undefined || to.cct === undefined) throw new Error('CCT transition is missing Kelvin');
    state.cct = Math.round(mix(from.cct, to.cct) / 100) * 100;
    state.gm = Math.round(mix(from.gm ?? 0, to.gm ?? 0) / 10) * 10;
  } else {
    if (from.hue === undefined || to.hue === undefined || from.sat === undefined || to.sat === undefined)
      throw new Error('HSI transition is missing hue/saturation');
    const delta = ((to.hue - from.hue + 540) % 360) - 180;
    state.hue = Math.round((from.hue + delta * fraction + 360) % 360) % 360;
    state.sat = Math.round(mix(from.sat, to.sat));
  }
  return state;
}
