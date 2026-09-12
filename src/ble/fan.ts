import { z } from 'zod';
import { FAN_MODES, type FanMode, type FanState } from './telink.js';

const ProfileSchema = z.custom<FanMode>(
  (value) => typeof value === 'string' && Object.hasOwn(FAN_MODES, value),
  'Unknown fan mode'
);
export const FanSettingSchema = z
  .object({
    mode: ProfileSchema,
    rpm: z.number().int().min(0).max(65535).optional(),
  })
  .strict()
  .superRefine((setting, context) => {
    if ((setting.mode === 'manual') !== (setting.rpm !== undefined))
      context.addIssue({ code: 'custom', message: 'Only manual fan mode requires an explicit RPM setpoint' });
  });
export const FanStateSchema = z.object({
  mode: z.number().int().min(0).max(255),
  speed: z.number().int().min(0).max(65535),
  temperature: z.number().int().min(0).max(255),
  highTemperature: z.boolean(),
  supported: z.object({
    silent: z.boolean(),
    low: z.boolean(),
    medium: z.boolean(),
    high: z.boolean(),
    off: z.boolean(),
    max: z.boolean(),
    smart: z.boolean(),
    manual: z.boolean(),
  }),
  allowedModes: z.array(ProfileSchema).optional(),
  modeName: z.string().optional(),
  rpmStatus: z.enum(['zero-reported', 'rotation-reported']).optional(),
}) satisfies z.ZodType<FanState>;

export const FanStatesSchema = z.object({
  states: z.record(FanStateSchema).refine((states) => Object.keys(states).length > 0, 'No fan states returned'),
});

export function describeFan(state: FanState): FanState {
  return {
    ...state,
    modeName: Object.entries(FAN_MODES).find(([, code]) => code === state.mode)?.[0] ?? 'unknown',
    rpmStatus: state.speed === 0 ? 'zero-reported' : 'rotation-reported',
    allowedModes: state.highTemperature
      ? []
      : (Object.keys(FAN_MODES) as FanMode[]).filter((name) => state.supported[name]),
  };
}
