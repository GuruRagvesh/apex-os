import { canonicalBundle, diffCanonical, hashCanonical } from './bundle-canonical';
import type { IdentityResolution } from './identity-map';
import type { ReferenceCheck } from './reference-check';
import { dayWindow, hasOpenSession, recoveryWindowBlockers } from './safety-window';
import { matchingTombstones } from './tombstone';
import type {
  AttendanceDayBundle,
  DayClassification,
  LegacySubtype,
  RecoveryTombstone,
} from './recovery.types';

/**
 * One employee-day: the target's stored bundle vs. the recovery bundle.
 * Classifies; never writes. The action vocabulary has no UPDATE or DELETE.
 *
 * First match wins:
 *
 *   recovery bundle structurally invalid               → INVALID_BUNDLE      REJECT
 *   both present, hashes equal                         → IN_SYNC             NO_ACTION
 *   both present, hashes differ                        → DIFFERENT           MANUAL_REVIEW (never overwrite)
 *   only the target holds it                           → PRODUCTION_ONLY     MIRROR_CANDIDATE when historical
 *                                                                            and closed, else NO_ACTION
 *   only the recovery source holds it:
 *     no DailyAttendance (sessions only)               → LEGACY_FORMAT       MANUAL_REVIEW (no synthesis)
 *     employee unmapped                                → MISSING_REFERENCE   MANUAL_REVIEW
 *     employeeId ambiguous                             → MANUAL_REVIEW
 *     matching tombstone                               → MANUAL_REVIEW       (removed on purpose)
 *     a reference missing in the target                → MISSING_REFERENCE   MANUAL_REVIEW
 *     any safety check fails                           → MANUAL_REVIEW
 *     otherwise                                        → RECOVERY_ONLY       AUTO_REPAIR_ELIGIBLE,
 *                                                                            action RECOVERY_PREVIEW
 *
 * RECOVERY_ONLY is never itself an insert: it is a preview. Phase 1 writes
 * nothing, and auto-repair is off.
 */

export interface ClassifyInput {
  employeeId: string;
  businessDate: string;
  current: AttendanceDayBundle | null;
  recovery: AttendanceDayBundle | null;
  /** Structural problems found when the recovery bundle was read (INVALID_BUNDLE). */
  recoveryProblems?: string[];
  identity: IdentityResolution;
  references: ReferenceCheck;
  tombstones: RecoveryTombstone[];
  companyToday: string;
  monthCloseStatus: string | null;
  /** Ids in the recovery bundle already used in the target under ANOTHER day. */
  idCollisions?: string[];
  /** True when the whole month is session-only in the recovery source. */
  legacyMonth?: boolean;
}

export function classifyDay(input: ClassifyInput): DayClassification {
  const base = { employeeId: input.employeeId, businessDate: input.businessDate };
  const hashOf = (b: AttendanceDayBundle | null) => (b ? hashCanonical(canonicalBundle(b)) : null);
  const done = (
    state: DayClassification['state'],
    action: DayClassification['action'],
    reasons: string[],
    extra: Partial<DayClassification> = {},
  ): DayClassification => ({
    ...base,
    state,
    action,
    eligibility: 'NOT_APPLICABLE',
    reasons,
    differingFields: [],
    currentHash: null,
    recoveryHash: null,
    ...extra,
  });

  if (input.recovery && input.recoveryProblems && input.recoveryProblems.length) {
    return done('INVALID_BUNDLE', 'REJECT', [...input.recoveryProblems], { currentHash: hashOf(input.current) });
  }

  const currentHash = hashOf(input.current);
  const recoveryHash = hashOf(input.recovery);
  const hashes = { currentHash, recoveryHash };

  if (input.current && input.recovery) {
    if (currentHash === recoveryHash) return done('IN_SYNC', 'NO_ACTION', [], hashes);
    return done('DIFFERENT', 'MANUAL_REVIEW', ['CONTENT_DIFFERS'], {
      ...hashes,
      differingFields: diffCanonical(canonicalBundle(input.current) as any, canonicalBundle(input.recovery) as any),
    });
  }

  if (input.current && !input.recovery) {
    const historical = dayWindow(input.businessDate, input.companyToday) === 'HISTORICAL';
    const open = hasOpenSession(input.current);
    if (historical && !open) return done('PRODUCTION_ONLY', 'MIRROR_CANDIDATE', [], hashes);
    return done('PRODUCTION_ONLY', 'NO_ACTION', [historical ? 'OPEN_SESSION' : 'NOT_YET_HISTORICAL'], hashes);
  }

  if (!input.recovery) return done('MANUAL_REVIEW', 'MANUAL_REVIEW', ['NOTHING_TO_CLASSIFY']);

  // ── recovery only ────────────────────────────────────────────────────────
  const r = input.recovery;
  if (!r.dailyAttendance && r.workSessions.length > 0) {
    const legacySubtype: LegacySubtype = input.legacyMonth ? 'LEGACY_SESSION_ONLY' : 'SESSION_WITHOUT_DAILY_ATTENDANCE';
    return done('LEGACY_FORMAT', 'MANUAL_REVIEW', ['NO_DAILY_ATTENDANCE_IN_SOURCE', 'NO_SYNTHESIS'], { ...hashes, legacySubtype });
  }
  if (input.identity.state === 'MISSING_REFERENCE') return done('MISSING_REFERENCE', 'MANUAL_REVIEW', ['EMPLOYEE_MISSING'], hashes);
  if (input.identity.state === 'CONFLICT') return done('MANUAL_REVIEW', 'MANUAL_REVIEW', ['EMPLOYEE_ID_AMBIGUOUS'], hashes);

  const tombs = matchingTombstones(r, input.tombstones);
  if (tombs.length) {
    return done('MANUAL_REVIEW', 'MANUAL_REVIEW', ['TOMBSTONED', ...tombs.map((t) => `TOMBSTONE:${t.recordType}`)], {
      ...hashes,
      eligibility: 'NOT_ELIGIBLE',
    });
  }
  if (input.references.missing.length) {
    return done('MISSING_REFERENCE', 'MANUAL_REVIEW', [...input.references.missing], { ...hashes, eligibility: 'NOT_ELIGIBLE' });
  }

  const blockers = [
    ...recoveryWindowBlockers({ bundle: r, companyToday: input.companyToday, monthCloseStatus: input.monthCloseStatus }),
    ...input.references.review,
    ...(input.idCollisions && input.idCollisions.length ? ['NATURAL_KEY_TAKEN'] : []),
  ];
  if (blockers.length) return done('MANUAL_REVIEW', 'MANUAL_REVIEW', blockers, { ...hashes, eligibility: 'NOT_ELIGIBLE' });

  return done('RECOVERY_ONLY', 'RECOVERY_PREVIEW', ['ALL_SAFETY_CHECKS_PASSED'], { ...hashes, eligibility: 'AUTO_REPAIR_ELIGIBLE' });
}

/** Months the recovery source holds as sessions only (no DailyAttendance at all). */
export function legacySessionOnlyMonths(stats: Array<{ month: string; dailyAttendance: number; workSessions: number }>): Set<string> {
  return new Set(stats.filter((s) => s.dailyAttendance === 0 && s.workSessions > 0).map((s) => s.month));
}
