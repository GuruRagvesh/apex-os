/**
 * Policy continuity (Phase 3): the one answer to "which version governs date D?"
 *
 * Every reader -- onboarding, punch, leave, attendance evaluation and the
 * calendar -- resolves through this, so a gap, an overlap or a missing
 * baseline is decided the same way everywhere and never becomes a general
 * access failure.
 *
 * The rules, in order:
 *
 *   1. COVERED   exactly one version covers D: it governs.
 *   2. OVERLAP   several cover D: the latest effectiveFrom governs (then the
 *                highest version, then id), and an OVERLAP warning is raised.
 *   3. GAP       none covers D but an earlier version exists: the most recent
 *                earlier version continues, and a GAP warning is raised.
 *   4. BASELINE  none covers D or precedes it, D is on or after the company
 *                baseline (1 Dec 2020), and a later version exists: the
 *                earliest version is applied as the baseline, and a
 *                MISSING_BASELINE warning is raised so Admin can correct its
 *                start date.
 *   5. NONE      nothing at all: POLICY_SETUP_PENDING. Never an exception.
 *
 * A future version never governs before its own effectiveFrom, because it does
 * not cover those dates and is never "earlier" than them. Dates before the
 * baseline are outside company policy history and resolve to nothing.
 *
 * Pure: candidates are passed in, dates are company business dates
 * (yyyy-MM-dd), and nothing here reads the clock or the database.
 */

/** Company policy history begins here. Nothing is applicable before it. */
export const POLICY_BASELINE_DATE = '2020-12-01';

export type PolicyContinuityHealth = 'GAP' | 'OVERLAP' | 'MISSING_BASELINE' | 'NO_POLICY';

export interface ContinuityCandidate {
  id: string;
  /** yyyy-MM-dd company date. */
  effectiveFrom: string;
  /** yyyy-MM-dd company date, inclusive, or null for open-ended. */
  effectiveTo: string | null;
  version?: number | null;
}

export interface ContinuityResolution<T extends ContinuityCandidate = ContinuityCandidate> {
  policy: T | null;
  health: PolicyContinuityHealth | null;
  /** Candidates involved in the finding (for the health record). */
  involvedIds: string[];
  /** The date range the finding concerns, where it has one. */
  rangeFrom: string | null;
  rangeTo: string | null;
}

function newestFirst<T extends ContinuityCandidate>(a: T, b: T): number {
  if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
  const va = a.version ?? 0;
  const vb = b.version ?? 0;
  if (va !== vb) return vb - va;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function resolveContinuousPolicy<T extends ContinuityCandidate>(
  candidates: readonly T[],
  businessDate: string,
): ContinuityResolution<T> {
  if (businessDate < POLICY_BASELINE_DATE) {
    return { policy: null, health: null, involvedIds: [], rangeFrom: null, rangeTo: null };
  }
  if (candidates.length === 0) {
    return { policy: null, health: 'NO_POLICY', involvedIds: [], rangeFrom: null, rangeTo: null };
  }

  const covering = candidates
    .filter((c) => c.effectiveFrom <= businessDate && (c.effectiveTo === null || c.effectiveTo >= businessDate))
    .sort(newestFirst);
  if (covering.length === 1) {
    return { policy: covering[0], health: null, involvedIds: [covering[0].id], rangeFrom: null, rangeTo: null };
  }
  if (covering.length > 1) {
    const ends = covering.map((c) => c.effectiveTo).filter((v): v is string => v !== null).sort();
    return {
      policy: covering[0],
      health: 'OVERLAP',
      involvedIds: covering.map((c) => c.id),
      rangeFrom: covering.map((c) => c.effectiveFrom).sort().reverse()[0],
      rangeTo: ends.length === covering.length ? ends[0] : null,
    };
  }

  const earlier = candidates.filter((c) => c.effectiveTo !== null && c.effectiveTo < businessDate).sort(
    (a, b) => (a.effectiveTo! < b.effectiveTo! ? 1 : a.effectiveTo! > b.effectiveTo! ? -1 : newestFirst(a, b)),
  );
  if (earlier.length > 0) {
    const prior = earlier[0];
    const next = candidates
      .filter((c) => c.effectiveFrom > businessDate)
      .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0];
    return {
      policy: prior,
      health: 'GAP',
      involvedIds: [prior.id, ...(next ? [next.id] : [])],
      rangeFrom: addDays(prior.effectiveTo!, 1),
      rangeTo: next ? addDays(next.effectiveFrom, -1) : null,
    };
  }

  const later = candidates
    .filter((c) => c.effectiveFrom > businessDate)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : newestFirst(a, b)));
  const baseline = later[0];
  return {
    policy: baseline,
    health: 'MISSING_BASELINE',
    involvedIds: [baseline.id],
    rangeFrom: POLICY_BASELINE_DATE,
    rangeTo: addDays(baseline.effectiveFrom, -1),
  };
}

/** The dedupe key for one finding, so a repeated read updates one health row. */
export function policyHealthDedupeKey(
  family: string,
  resolution: Pick<ContinuityResolution, 'health' | 'involvedIds' | 'rangeFrom'>,
): string | null {
  if (!resolution.health) return null;
  const ids = [...resolution.involvedIds].sort().join(',');
  return `${family}:${resolution.health}:${resolution.rangeFrom ?? '-'}:${ids}`;
}

/**
 * The previous company date, for closing a predecessor when its successor
 * starts. Company dates, not instants: a timestamp minus 24 hours lands on the
 * wrong day either side of a timezone boundary.
 */
export function previousCompanyDate(businessDate: string): string {
  return addDays(businessDate, -1);
}

/**
 * Lifecycle states whose versions can govern a date. SCHEDULED is included so
 * a future version takes over on its own date even when no job has run; the
 * date window, not the status label, decides which one applies.
 */
export const GOVERNING_POLICY_STATUSES = ['ACTIVE', 'SUPERSEDED', 'SCHEDULED'] as const;
