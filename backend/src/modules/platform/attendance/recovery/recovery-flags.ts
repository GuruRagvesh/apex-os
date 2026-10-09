import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';
import { sanitizeDamageLimits, type DamageLimits } from './damage-limits';

/**
 * Runtime kill switches for attendance recovery, in AppSetting — the same
 * mechanism as `attendance_v2` — so they can be turned off without a deploy.
 * Environment variables are reserved for credentials.
 *
 * Every flag defaults to OFF, and only a literal `true` turns one on: a missing
 * row, a typo, a string "true" or a number all read as OFF.
 *
 * Phase 1 reads these and nothing consults them to write: there is no write path
 * yet. They exist so the later phases are born behind a switch that is already
 * off.
 */

export const ATTENDANCE_RECOVERY_SETTING_KEY = 'attendance_recovery';

export const ATTENDANCE_RECOVERY_DEFAULTS = {
  ATTENDANCE_RECOVERY_ENABLED: false,
  ATTENDANCE_RECOVERY_R2_ENABLED: false,
  ATTENDANCE_RECONCILIATION_ENABLED: false,
  ATTENDANCE_AUTO_REPAIR_ENABLED: false,
} as const;

export type RecoveryFlagName = keyof typeof ATTENDANCE_RECOVERY_DEFAULTS;
export type RecoveryFlags = Record<RecoveryFlagName, boolean>;

export interface RecoveryConfig {
  flags: RecoveryFlags;
  damageLimits: DamageLimits;
}

/** Pure reading of the stored JSON value. */
export function readRecoveryConfig(stored: unknown): RecoveryConfig {
  const v = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const flags = {} as RecoveryFlags;
  for (const k of Object.keys(ATTENDANCE_RECOVERY_DEFAULTS) as RecoveryFlagName[]) {
    flags[k] = (v[k] ?? ATTENDANCE_RECOVERY_DEFAULTS[k]) === true;
  }
  // Auto-repair is meaningless without recovery itself; it can never be on alone.
  if (!flags.ATTENDANCE_RECOVERY_ENABLED) flags.ATTENDANCE_AUTO_REPAIR_ENABLED = false;
  return { flags, damageLimits: sanitizeDamageLimits(v.damageLimits) };
}

@Injectable()
export class RecoveryFlagsService {
  constructor(private readonly settings: SettingsService) {}

  async config(): Promise<RecoveryConfig> {
    return readRecoveryConfig(await this.settings.get(ATTENDANCE_RECOVERY_SETTING_KEY));
  }
}
