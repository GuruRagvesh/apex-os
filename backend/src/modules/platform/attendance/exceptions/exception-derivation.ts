/**
 * Attendance Exception Queue — the derivation rules (EQ-1).
 *
 * Dependency-free on purpose: no Prisma, no Nest, no clock. Everything here is
 * a pure function of records that were already written by somebody else, so the
 * rules can be tested exhaustively without a database and so it is impossible
 * for this file to become a second place where attendance is decided.
 *
 * THE QUEUE IS DERIVED. It stores nothing. There is no exception table, no
 * "resolved" flag and no acknowledgement — an item exists exactly as long as
 * the authoritative records that produced it still say something is wrong, and
 * it disappears the moment they stop saying it:
 *
 *   normal attendance            -> no item
 *   ambiguous / failed day       -> derived item
 *   authorized resolution        -> existing action, existing service
 *   attendance recalculated      -> the item is simply no longer derived
 *
 * That is the whole point. A stored queue would immediately become a second
 * opinion about payroll-relevant facts, and would need its own reconciliation
 * with the record it was supposed to be describing.
 *
 * WHAT THIS CANNOT SEE. A punch that failed on the employee's device never
 * reached a server, so no row exists to derive from: a denied camera, a refused
 * location permission, a dead network. Those are invisible here and are NOT
 * invented. The durable shadow they leave is either an abandoned handoff or,
 * the next time the evaluator runs, a missing punch — both of which are
 * derived. Full attempt-level traceability would need a durable punch-attempt
 * record, which does not exist and is not faked here.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary
// ─────────────────────────────────────────────────────────────────────────────

export type ExceptionCategory =
  | 'MISSING_PUNCH_IN'
  | 'MISSING_PUNCH_OUT'
  | 'OUTSIDE_GEOFENCE'
  | 'LOW_ACCURACY_LOCATION'
  | 'LOCATION_UNVERIFIED'
  | 'PHOTO_MISSING'
  | 'NEEDS_REVIEW'
  | 'PENDING_REGULARIZATION'
  | 'MANUAL_RECOVERY_AWAITING_HR'
  | 'FAILED_OR_EXPIRED_HANDOFF';

/**
 * Where the resolution stands — NOT whether the day is wrong.
 *
 * OPEN means nobody has started. The two AWAITING states mean a correction is
 * already in flight and is sitting on a named desk, which is the difference
 * between "this needs attention" and "this is waiting on you".
 */
export type ResolutionState = 'OPEN' | 'AWAITING_MANAGER' | 'AWAITING_HR';

/** Who has the authority to end this. Descriptive; enforcement lives in the
 *  services that actually perform the action. */
export type ResolverRole =
  | 'EMPLOYEE_THEN_APPROVAL'
  | 'MANAGER_OR_HR'
  | 'MANAGER_THEN_HR'
  | 'HR_ONLY';

/**
 * What actually ends this item.
 *
 * `kind` names an action that ALREADY EXISTS. The queue performs none of them:
 * it is a read surface that points at the authorised path. Adding a write here
 * would create a second way to change attendance, which is the failure mode
 * this whole module is shaped to avoid.
 */
export type ResolvingActionKind =
  | 'RAISE_REGULARIZATION'
  | 'MANUAL_RECOVERY'
  | 'MANAGER_DECISION'
  | 'HR_DECISION'
  | 'REVIEW_AND_FINALIZE'
  | 'RETRY_PUNCH';

export interface ResolvingAction {
  kind: ResolvingActionKind;
  /** Plain-language instruction. Written for the person who has to act. */
  label: string;
  /** The regularization this action decides, when there is one. */
  regularizationId?: string;
}

export interface ExceptionItem {
  /** Stable across refreshes: one employee-day is one item. */
  key: string;
  userId: string;
  employee: EmployeeRef | null;
  businessDate: string;

  /** The most blocking thing wrong with the day. Used for display and sorting. */
  category: ExceptionCategory;
  /**
   * EVERY category that applies, primary included.
   *
   * A day can be several things at once — no punch out AND outside the
   * geofence. Emitting one row per flag would put the same day in the queue
   * three times and let it be "resolved" twice; collapsing to a single
   * category would make the day invisible to a filter for the other two. So
   * one row carries them all, and filters match this list.
   */
  categories: ExceptionCategory[];

  /** What is wrong. */
  problem: string;
  /** Why the system flagged it — which stored record and which value. */
  whyFlagged: string;
  /** The numbers a human needs to judge it without opening four screens. */
  evidence: Record<string, unknown>;

  resolvableBy: ResolverRole;
  resolvingAction: ResolvingAction;
  state: ResolutionState;

  /** When the underlying record appeared. Null when unknown; never guessed. */
  raisedAt: string | null;
  sourceIds: {
    dailyAttendanceId?: string;
    regularizationId?: string;
    handoffId?: string;
  };
}

export interface EmployeeRef {
  id: string;
  name: string;
  employeeId: string | null;
  department: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inputs — deliberately the shapes the existing tables already have
// ─────────────────────────────────────────────────────────────────────────────

export interface DailyAttendanceFacts {
  id: string;
  userId: string;
  businessDate: string;
  status: string;
  evaluationState: string;
  exceptionFlags: string[];
  punchInAt: string | null;
  punchOutAt: string | null;
  calculationReason: string | null;
  updatedAt: string | null;
}

export interface RegularizationFacts {
  id: string;
  userId: string;
  businessDate: string;
  status: string;
  requestType: string;
  entrySource: string;
  reason: string;
  recoveryReason: string | null;
  createdAt: string | null;
}

export interface HandoffFacts {
  id: string;
  userId: string;
  /** Company business date of createdAt, resolved by the caller through TVA. */
  businessDate: string;
  intent: string;
  status: string;
  expiredByClock: boolean;
  hasEvidence: boolean;
  createdAt: string | null;
}

/** One punch that actually reached the server, for handoff reconciliation. */
export interface PunchFacts {
  userId: string;
  businessDate: string;
  type: string;
}

export interface DerivationInput {
  attendance: DailyAttendanceFacts[];
  regularizations: RegularizationFacts[];
  handoffs: HandoffFacts[];
  punches: PunchFacts[];
  employees: Record<string, EmployeeRef>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flag mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stored evaluator flag -> queue category.
 *
 * The evaluator's vocabulary is not changed to suit the queue. This is a
 * translation table in one direction only, so a new flag appearing upstream
 * cannot silently become a category nobody designed.
 */
const FLAG_TO_CATEGORY: Record<string, ExceptionCategory> = {
  MISSING_PUNCH: 'MISSING_PUNCH_IN',
  NO_ATTENDANCE_EVIDENCE: 'MISSING_PUNCH_IN',
  MISSING_PUNCH_OUT: 'MISSING_PUNCH_OUT',
  LOCATION_OUTSIDE_GEOFENCE: 'OUTSIDE_GEOFENCE',
  LOCATION_LOW_ACCURACY: 'LOW_ACCURACY_LOCATION',
  LOCATION_UNAVAILABLE: 'LOCATION_UNVERIFIED',
  PHOTO_MISSING: 'PHOTO_MISSING',
};

/**
 * Most blocking first.
 *
 * A day with no punch in cannot be judged on its geofence, so the missing
 * punch is what the queue should say out loud. NEEDS_REVIEW is last because it
 * means "something is wrong and nothing more specific was recorded" — showing
 * it in preference to a known cause would hide the cause.
 */
const PRECEDENCE: ExceptionCategory[] = [
  'MISSING_PUNCH_IN',
  'MISSING_PUNCH_OUT',
  'OUTSIDE_GEOFENCE',
  'LOW_ACCURACY_LOCATION',
  'LOCATION_UNVERIFIED',
  'PHOTO_MISSING',
  'FAILED_OR_EXPIRED_HANDOFF',
  'MANUAL_RECOVERY_AWAITING_HR',
  'PENDING_REGULARIZATION',
  'NEEDS_REVIEW',
];

/**
 * Flags that explain a result without demanding a second look.
 *
 * Mirrors NON_REVIEW_FLAGS in the evaluator. An approved correction is a
 * decision that has already been made; re-queuing the day it just settled
 * would make the queue impossible to empty.
 */
const NON_REVIEW_FLAGS = new Set(['CORRECTED_BY_REGULARIZATION']);

const rank = (c: ExceptionCategory) => {
  const i = PRECEDENCE.indexOf(c);
  return i === -1 ? PRECEDENCE.length : i;
};

const dayKey = (userId: string, businessDate: string) => `${userId}|${businessDate}`;

// ─────────────────────────────────────────────────────────────────────────────
// Descriptions
// ─────────────────────────────────────────────────────────────────────────────

const PROBLEM: Record<ExceptionCategory, string> = {
  MISSING_PUNCH_IN: 'No punch in was recorded for this working day.',
  MISSING_PUNCH_OUT:
    'A punch in exists but no punch out, so presence cannot be measured for the day.',
  OUTSIDE_GEOFENCE: 'A punch was recorded outside the approved location.',
  LOW_ACCURACY_LOCATION:
    'The location was too imprecise to place the punch inside or outside the approved area.',
  LOCATION_UNVERIFIED:
    'The punch was accepted without a usable location, so it was never checked against a location.',
  PHOTO_MISSING: 'A punch was recorded without the photo evidence the policy expects.',
  NEEDS_REVIEW: 'The evaluator could not settle this day on its own.',
  PENDING_REGULARIZATION: 'A correction has been requested and is waiting for a decision.',
  MANUAL_RECOVERY_AWAITING_HR:
    'Attendance was entered by hand during an outage and is waiting for HR to approve it.',
  FAILED_OR_EXPIRED_HANDOFF:
    'A phone handoff was started to finish a punch and expired without one being recorded.',
};

const RESOLVER: Record<ExceptionCategory, ResolverRole> = {
  MISSING_PUNCH_IN: 'EMPLOYEE_THEN_APPROVAL',
  MISSING_PUNCH_OUT: 'EMPLOYEE_THEN_APPROVAL',
  OUTSIDE_GEOFENCE: 'MANAGER_OR_HR',
  LOW_ACCURACY_LOCATION: 'MANAGER_OR_HR',
  LOCATION_UNVERIFIED: 'MANAGER_OR_HR',
  PHOTO_MISSING: 'MANAGER_OR_HR',
  NEEDS_REVIEW: 'MANAGER_OR_HR',
  PENDING_REGULARIZATION: 'MANAGER_THEN_HR',
  MANUAL_RECOVERY_AWAITING_HR: 'HR_ONLY',
  FAILED_OR_EXPIRED_HANDOFF: 'EMPLOYEE_THEN_APPROVAL',
};

/** The action that ends the item when no correction is in flight yet. */
function openAction(category: ExceptionCategory): ResolvingAction {
  switch (category) {
    case 'MISSING_PUNCH_IN':
    case 'MISSING_PUNCH_OUT':
    case 'FAILED_OR_EXPIRED_HANDOFF':
      return {
        kind: 'RAISE_REGULARIZATION',
        label:
          'The employee raises a correction for this date, or an authorised person records a ' +
          'manual recovery. Both then need approval.',
      };
    case 'OUTSIDE_GEOFENCE':
    case 'LOW_ACCURACY_LOCATION':
    case 'LOCATION_UNVERIFIED':
    case 'PHOTO_MISSING':
      return {
        kind: 'REVIEW_AND_FINALIZE',
        label:
          'Check the evidence. Finalize the day if it is acceptable, or have a correction raised ' +
          'if the record is wrong.',
      };
    default:
      return {
        kind: 'REVIEW_AND_FINALIZE',
        label: 'Open the day, decide what happened, and finalize it.',
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Derivation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Corrections that are still in flight, indexed by employee-day.
 *
 * Only PENDING and MANAGER_APPROVED count. An HR_APPROVED correction has
 * already rewritten the official record, and a REJECTED one settled the
 * question in the other direction; neither is an open exception.
 */
function inFlight(regularizations: RegularizationFacts[]) {
  const map = new Map<string, RegularizationFacts>();
  for (const r of regularizations) {
    if (r.status !== 'PENDING' && r.status !== 'MANAGER_APPROVED') continue;
    const k = dayKey(r.userId, r.businessDate);
    const existing = map.get(k);
    // Furthest along wins: if a day somehow has two, the one already with HR is
    // the one a human is actually waiting on.
    if (!existing || (existing.status === 'PENDING' && r.status === 'MANAGER_APPROVED')) {
      map.set(k, r);
    }
  }
  return map;
}

function stateFor(reg: RegularizationFacts | undefined): ResolutionState {
  if (!reg) return 'OPEN';
  return reg.status === 'MANAGER_APPROVED' ? 'AWAITING_HR' : 'AWAITING_MANAGER';
}

function actionFor(reg: RegularizationFacts, category: ExceptionCategory): ResolvingAction {
  if (reg.status === 'MANAGER_APPROVED') {
    return {
      kind: 'HR_DECISION',
      label:
        category === 'MANUAL_RECOVERY_AWAITING_HR'
          ? 'HR approves or rejects the manual entry. Approving rewrites the official record.'
          : 'HR approves or rejects this correction. Approving rewrites the official record.',
      regularizationId: reg.id,
    };
  }
  return {
    kind: reg.entrySource === 'MANUAL_RECOVERY' ? 'MANUAL_RECOVERY' : 'MANAGER_DECISION',
    label: "The employee's reporting manager approves or rejects it first.",
    regularizationId: reg.id,
  };
}

/**
 * Categories a stored attendance row is asking about.
 *
 * A day qualifies when the evaluator marked it NEEDS_REVIEW, or when it carries
 * a flag that maps to a category, or when its status is MISSING_PUNCH. A day
 * whose ONLY flags are non-review ones is not an exception.
 */
function categoriesForDay(row: DailyAttendanceFacts): ExceptionCategory[] {
  const found = new Set<ExceptionCategory>();

  for (const flag of row.exceptionFlags ?? []) {
    if (NON_REVIEW_FLAGS.has(flag)) continue;
    const mapped = FLAG_TO_CATEGORY[flag];
    if (mapped) found.add(mapped);
  }

  // The status is authoritative about the punch pair even when the flags are
  // absent — an older row written before a flag existed still has to surface.
  if (row.status === 'MISSING_PUNCH') {
    if (!row.punchInAt) found.add('MISSING_PUNCH_IN');
    else if (!row.punchOutAt) found.add('MISSING_PUNCH_OUT');
  }

  const reviewable = (row.exceptionFlags ?? []).some((f) => !NON_REVIEW_FLAGS.has(f));
  if (found.size === 0 && (row.evaluationState === 'NEEDS_REVIEW' || reviewable)) {
    found.add('NEEDS_REVIEW');
  }

  return [...found].sort((a, b) => rank(a) - rank(b));
}

/**
 * An expired handoff is only an exception if the punch it was meant to produce
 * still has not happened.
 *
 * CANCELLED is deliberately excluded: creating a new handoff cancels the
 * previous WAITING one, so a cancelled row is usually a retry, not a failure,
 * and reporting it as one would fill the queue with successes.
 */
function unresolvedHandoffs(handoffs: HandoffFacts[], punches: PunchFacts[]): HandoffFacts[] {
  const landed = new Set(punches.map((p) => `${p.userId}|${p.businessDate}|${p.type}`));
  return handoffs.filter((h) => {
    if (h.hasEvidence) return false;
    const abandoned = h.status === 'EXPIRED' || (h.status === 'WAITING' && h.expiredByClock);
    if (!abandoned) return false;
    return !landed.has(`${h.userId}|${h.businessDate}|${h.intent}`);
  });
}

export function deriveExceptions(input: DerivationInput): ExceptionItem[] {
  const corrections = inFlight(input.regularizations);
  const items = new Map<string, ExceptionItem>();

  // 1. Days the evaluator itself is unsure about.
  for (const row of input.attendance) {
    const categories = categoriesForDay(row);
    if (categories.length === 0) continue;

    const k = dayKey(row.userId, row.businessDate);
    const reg = corrections.get(k);
    const primary = categories[0];
    const otherFlags = (row.exceptionFlags ?? []).filter(
      (f) => !NON_REVIEW_FLAGS.has(f) && !FLAG_TO_CATEGORY[f],
    );

    items.set(k, {
      key: `${k}|${primary}`,
      userId: row.userId,
      employee: input.employees[row.userId] ?? null,
      businessDate: row.businessDate,
      category: primary,
      categories,
      problem: PROBLEM[primary],
      whyFlagged:
        row.exceptionFlags?.length > 0
          ? `Stored attendance is ${row.evaluationState} with ${row.exceptionFlags.join(', ')}.`
          : `Stored attendance is ${row.status} (${row.evaluationState}).`,
      evidence: {
        status: row.status,
        evaluationState: row.evaluationState,
        punchInAt: row.punchInAt,
        punchOutAt: row.punchOutAt,
        calculationReason: row.calculationReason,
        exceptionFlags: row.exceptionFlags ?? [],
        unmappedFlags: otherFlags,
      },
      resolvableBy: RESOLVER[primary],
      resolvingAction: reg ? actionFor(reg, primary) : openAction(primary),
      state: stateFor(reg),
      raisedAt: row.updatedAt,
      sourceIds: { dailyAttendanceId: row.id, ...(reg ? { regularizationId: reg.id } : {}) },
    });
  }

  // 2. Corrections in flight for days the evaluator has NOT flagged.
  //
  // Merged into the day above when one exists, so a day never appears twice.
  // Standing alone here because a correction can be raised for a day that
  // evaluated cleanly, or one the evaluator has not reached yet — and either
  // way somebody owes a decision.
  for (const reg of corrections.values()) {
    const k = dayKey(reg.userId, reg.businessDate);
    if (items.has(k)) continue;

    const manualAwaitingHr =
      reg.entrySource === 'MANUAL_RECOVERY' && reg.status === 'MANAGER_APPROVED';
    const category: ExceptionCategory = manualAwaitingHr
      ? 'MANUAL_RECOVERY_AWAITING_HR'
      : 'PENDING_REGULARIZATION';

    items.set(k, {
      key: `${k}|${category}`,
      userId: reg.userId,
      employee: input.employees[reg.userId] ?? null,
      businessDate: reg.businessDate,
      category,
      categories: [category],
      problem: PROBLEM[category],
      whyFlagged:
        reg.entrySource === 'MANUAL_RECOVERY'
          ? `Manual recovery entered${reg.recoveryReason ? ` (${reg.recoveryReason})` : ''}, now ${reg.status}.`
          : `${reg.requestType} correction requested by the employee, now ${reg.status}.`,
      evidence: {
        requestType: reg.requestType,
        entrySource: reg.entrySource,
        recoveryReason: reg.recoveryReason,
        employeeReason: reg.reason,
      },
      resolvableBy: RESOLVER[category],
      resolvingAction: actionFor(reg, category),
      state: stateFor(reg),
      raisedAt: reg.createdAt,
      sourceIds: { regularizationId: reg.id },
    });
  }

  // 3. Phone handoffs that expired without producing a punch.
  //
  // Where the day is already in the queue this only adds the explanation: the
  // problem is still the missing punch, and the handoff says why it is missing.
  for (const h of unresolvedHandoffs(input.handoffs, input.punches)) {
    const k = dayKey(h.userId, h.businessDate);
    const existing = items.get(k);

    if (existing) {
      if (!existing.categories.includes('FAILED_OR_EXPIRED_HANDOFF')) {
        const merged: ExceptionCategory[] = [...existing.categories, 'FAILED_OR_EXPIRED_HANDOFF'];
        existing.categories = merged.sort((a, b) => rank(a) - rank(b));
      }
      existing.evidence = {
        ...existing.evidence,
        expiredHandoff: { id: h.id, intent: h.intent, createdAt: h.createdAt },
      };
      existing.sourceIds = { ...existing.sourceIds, handoffId: h.id };
      continue;
    }

    // A correction in flight for this day would already have produced an item
    // above, so this is normally OPEN. Read it anyway rather than assuming, so
    // the state stays right if the order of these passes ever changes.
    const reg = corrections.get(k);

    items.set(k, {
      key: `${k}|FAILED_OR_EXPIRED_HANDOFF`,
      userId: h.userId,
      employee: input.employees[h.userId] ?? null,
      businessDate: h.businessDate,
      category: 'FAILED_OR_EXPIRED_HANDOFF',
      categories: ['FAILED_OR_EXPIRED_HANDOFF'],
      problem: PROBLEM.FAILED_OR_EXPIRED_HANDOFF,
      whyFlagged: `A ${h.intent} handoff expired and no ${h.intent} evidence exists for the day.`,
      evidence: { intent: h.intent, handoffStatus: h.status, createdAt: h.createdAt },
      resolvableBy: RESOLVER.FAILED_OR_EXPIRED_HANDOFF,
      resolvingAction: reg
        ? actionFor(reg, 'FAILED_OR_EXPIRED_HANDOFF')
        : {
            kind: 'RETRY_PUNCH',
            label:
              'If the day is still open the employee can punch again. Otherwise it needs a ' +
              'correction or a manual recovery.',
          },
      state: stateFor(reg),
      raisedAt: h.createdAt,
      sourceIds: { handoffId: h.id, ...(reg ? { regularizationId: reg.id } : {}) },
    });
  }

  // Newest day first, then most blocking, then by employee so the order is
  // stable between refreshes rather than following whatever the database
  // happened to return.
  return [...items.values()].sort(
    (a, b) =>
      b.businessDate.localeCompare(a.businessDate) ||
      rank(a.category) - rank(b.category) ||
      (a.employee?.name ?? a.userId).localeCompare(b.employee?.name ?? b.userId),
  );
}

/** Counts for the compact "today" strip. Derived from the same items, so a
 *  total can never disagree with the list underneath it. */
export function summariseExceptions(items: ExceptionItem[]) {
  const byCategory: Record<string, number> = {};
  const byState: Record<ResolutionState, number> = {
    OPEN: 0,
    AWAITING_MANAGER: 0,
    AWAITING_HR: 0,
  };

  for (const item of items) {
    // Counted under every category that applies, so a filter and the strip
    // above it agree. The totals therefore sum to more than `total`, which is
    // why `total` is reported separately rather than inferred.
    for (const c of item.categories) byCategory[c] = (byCategory[c] ?? 0) + 1;
    byState[item.state] += 1;
  }

  return {
    total: items.length,
    employees: new Set(items.map((i) => i.userId)).size,
    byCategory,
    byState,
  };
}

/** Filter applied AFTER derivation, never instead of scope. */
export function filterExceptions(
  items: ExceptionItem[],
  filters: {
    category?: string;
    state?: string;
    userId?: string;
    department?: string;
  } = {},
): ExceptionItem[] {
  return items.filter((item) => {
    if (filters.category && !item.categories.includes(filters.category as ExceptionCategory)) {
      return false;
    }
    if (filters.state && item.state !== filters.state) return false;
    if (filters.userId && item.userId !== filters.userId) return false;
    if (filters.department && item.employee?.department !== filters.department) return false;
    return true;
  });
}

/**
 * What this queue structurally cannot report, stated in the API itself.
 *
 * Returned alongside the items so the gap is visible to whoever is looking at
 * an empty queue, rather than living only in a comment. An HR user staring at
 * "0 exceptions" after an employee complained their camera failed needs to know
 * that no such record exists — not to conclude nothing happened.
 */
export const UNREPRESENTABLE: Array<{ what: string; why: string }> = [
  {
    what: 'A punch abandoned because the camera would not produce a usable frame',
    why: 'The capture is refused on the device before anything is sent, so no server record exists.',
  },
  {
    what: 'A punch abandoned because location permission was denied or timed out',
    why: 'Acquisition fails on the device before the punch is submitted, so no server record exists.',
  },
  {
    what: 'A punch lost to a network failure',
    why: 'The request never arrived. It surfaces later as a missing punch, not as a failed attempt.',
  },
];
