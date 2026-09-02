/**
 * The monthly Finance handoff: what it is called, what it says, and how a
 * retry is stopped from sending it twice.
 *
 * Dependency-free on purpose. Every rule here is about a message that leaves
 * the company and lands in an accountant's inbox, so each one is worth being
 * able to test without a mail provider, a database, or a Nest container.
 *
 * WHAT THIS FILE DOES NOT DO
 *
 * It does not decide whether a month may be sent. That is settled by the close
 * status and the data fingerprint, inside the month lock, and it stays there.
 */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

function parseMonth(month: string): { year: number; index: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error(`Not a yyyy-MM month: ${month}`);
  const index = Number(match[2]) - 1;
  if (index < 0 || index > 11) throw new Error(`Not a real month: ${month}`);
  return { year: Number(match[1]), index };
}

/** `2026-09` -> `September 2026`. For people, never for a key. */
export function monthLabel(month: string): string {
  const { year, index } = parseMonth(month);
  return `${MONTHS[index]} ${year}`;
}

/** `2026-09` -> `Sep_2026`. For the filename. */
export function monthFileToken(month: string): string {
  const { year, index } = parseMonth(month);
  return `${MONTHS[index].slice(0, 3)}_${year}`;
}

/**
 * The name Finance will file it under.
 *
 * "Final" is in the name deliberately: only a finalized month is ever sent, and
 * an accountant with several attachments open should not have to remember which
 * of them was the settled one.
 */
export function attachmentFileName(month: string): string {
  return `APEX_OS_Final_Attendance_Register_${monthFileToken(month)}.xlsx`;
}

export function reportSubject(month: string): string {
  return `APEX OS | Final Attendance Register – ${monthLabel(month)}`;
}

/**
 * The provider-side duplicate guard.
 *
 * Deterministic in the two things that identify THIS report: which month close
 * it is, and the fingerprint of the attendance data it was finalized from. A
 * retry of the same report therefore reuses the same key and Resend collapses
 * it; a genuinely different report cannot collide with it.
 *
 * NOT a random id per attempt. That is the whole point -- a fresh key on every
 * retry is exactly the bug this prevents, and it is what a well-meaning
 * "add idempotency" change usually does.
 *
 * Resend retains keys for 24 hours, which covers ordinary network and
 * restart-driven retries. It does NOT make this safe to call repeatedly for a
 * month that already sent successfully -- that is refused locally, before the
 * provider is reached at all.
 */
export function idempotencyKeyFor(input: {
  monthCloseId: string;
  reportSha256: string | null | undefined;
}): string {
  if (!input.monthCloseId) throw new Error('An idempotency key needs the month close id');
  if (!input.reportSha256) {
    // A month with no stored fingerprint has not been finalized, and an
    // unfinalized month is never sent. Refusing here rather than inventing a
    // key keeps "the key identifies the report" true.
    throw new Error('An idempotency key needs the finalized report fingerprint');
  }
  return `attendance-final-report/${input.monthCloseId}/${input.reportSha256}`;
}

// ── Delivery outcome ────────────────────────────────────────────────────────

/**
 * Three states, because two is a lie.
 *
 *   SENT      the provider accepted it and gave us an id.
 *   REJECTED  the provider understood the request and refused it. Nothing was
 *             sent, and a retry is safe.
 *   UNKNOWN   we do not know. A timeout, a dropped connection, an unrecognised
 *             failure. The mail may or may not have gone.
 *
 * Collapsing UNKNOWN into REJECTED is how a system ends up sending a second
 * copy of a payroll report -- or telling HR nothing was delivered when it was.
 * The retry for UNKNOWN reuses the same idempotency key, so the provider
 * settles the ambiguity rather than this code guessing at it.
 */
export type DeliveryOutcome = 'SENT' | 'REJECTED' | 'UNKNOWN';

export interface DeliveryResult {
  outcome: DeliveryOutcome;
  /** The provider's message id, when it gave one. */
  providerId?: string | null;
  /** Provider error code or transport message, for the audit trail. */
  reason?: string | null;
}

/**
 * Provider error codes that mean the request was UNDERSTOOD AND REFUSED.
 *
 * Nothing was sent for any of these, so a retry is safe and the local state can
 * honestly say so. Anything not on this list is treated as UNKNOWN, which is
 * the conservative direction: assuming a failure sent nothing is how duplicates
 * happen.
 */
const REFUSED_CODES = new Set([
  'validation_error',
  'missing_api_key',
  'restricted_api_key',
  'invalid_api_key',
  'invalid_from_address',
  'invalid_attachment',
  'invalid_access',
  'invalid_parameter',
  'invalid_region',
  'missing_required_field',
  'not_found',
  'method_not_allowed',
  'invalid_idempotency_key',
  // Same key, materially different payload. A real bug on our side: the key is
  // supposed to identify the report. Refused, and loudly.
  'invalid_idempotent_request',
  'security_error',
]);

/**
 * Codes that mean "ask again later", where a second differently-keyed request
 * would be actively wrong.
 *
 * concurrent_idempotent_requests is another attempt at THIS report already in
 * flight -- the correct response is to leave it alone, not to race it.
 */
const UNCERTAIN_CODES = new Set([
  'concurrent_idempotent_requests',
  'rate_limit_exceeded',
  'daily_quota_exceeded',
  'monthly_quota_exceeded',
  'application_error',
  'internal_server_error',
]);

export function classifyProviderResult(result: {
  id?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  threw?: boolean;
}): DeliveryResult {
  if (result.threw) {
    // The request left this process and we never heard back. It may well have
    // been delivered.
    return { outcome: 'UNKNOWN', reason: result.errorMessage ?? 'transport failure' };
  }
  if (result.errorCode || result.errorMessage) {
    const code = result.errorCode ?? '';
    if (REFUSED_CODES.has(code)) {
      return { outcome: 'REJECTED', reason: code || result.errorMessage };
    }
    if (UNCERTAIN_CODES.has(code)) {
      return { outcome: 'UNKNOWN', reason: code };
    }
    // An unrecognised provider error. Conservative: we do not know.
    return { outcome: 'UNKNOWN', reason: code || result.errorMessage };
  }
  if (result.id) return { outcome: 'SENT', providerId: result.id };
  // Accepted with no id is not an acceptance we can evidence.
  return { outcome: 'UNKNOWN', reason: 'provider returned no message id' };
}

// ── Local delivery state ────────────────────────────────────────────────────

/**
 * What the close row's deliveryStatus means.
 *
 * Stored in the existing nullable String column -- no schema change. NULL is
 * load-bearing: it is "nobody has tried", which is a different fact from "it
 * was tried and failed".
 */
export const DELIVERY_NEVER_ATTEMPTED = null;
export const DELIVERY_SENT = 'SENT';
export const DELIVERY_FAILED = 'FAILED';
export const DELIVERY_UNKNOWN = 'UNKNOWN';

export function deliveryStatusFor(outcome: DeliveryOutcome): string {
  return outcome === 'SENT'
    ? DELIVERY_SENT
    : outcome === 'REJECTED'
      ? DELIVERY_FAILED
      : DELIVERY_UNKNOWN;
}

/**
 * Whether send() may contact the provider at all.
 *
 * A month that has already been delivered is refused HERE, before any request
 * is made. Provider idempotency is a safety net for retries inside a 24-hour
 * window, not a licence to call send() again next week and rely on it.
 *
 * FAILED and UNKNOWN are both retryable, and both reuse the same key -- for
 * UNKNOWN that is precisely what resolves the ambiguity.
 */
export function mayContactProvider(close: {
  status: string;
  deliveryStatus?: string | null;
}): { allowed: boolean; reason?: string } {
  if (close.status === 'SENT' && close.deliveryStatus === DELIVERY_SENT) {
    return {
      allowed: false,
      reason:
        'This month has already been sent to Finance. Sending it again would deliver a second ' +
        'copy of the same report; a deliberate resend is a separate, audited action.',
    };
  }
  if (close.status !== 'FINALIZED' && close.status !== 'SENT') {
    return {
      allowed: false,
      reason: 'This month must be finalized before it can be sent to Finance.',
    };
  }
  return { allowed: true };
}

// ── Body ────────────────────────────────────────────────────────────────────

export interface HandoffFacts {
  month: string;
  finalizedAt: Date | string | null;
  finalizedByName: string | null;
  /** The month close id, quoted so a reply can name which handoff it is about. */
  reference: string | null;
  employees: number;
  unresolvedDays: number;
  employeesWithUnresolved: number;
}

/** `2026-09-01T06:00:00Z` -> `01 September 2026, 11:30 IST`-ish, or a dash. */
export function formatTimestamp(value: Date | string | null | undefined, timeZone = 'Asia/Kolkata'): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')}`;
}

/**
 * The lines Finance reads before opening the attachment.
 *
 * Returned as data rather than HTML so the wording is testable without parsing
 * markup, and so the same facts could be rendered somewhere else later.
 */
export function handoffSummaryRows(facts: HandoffFacts): { label: string; value: string }[] {
  const rows = [
    { label: 'Attendance period', value: monthLabel(facts.month) },
    { label: 'Finalized', value: formatTimestamp(facts.finalizedAt) },
    { label: 'Finalized by', value: facts.finalizedByName || 'HR' },
    { label: 'Employees included', value: String(facts.employees) },
    { label: 'Prepared by', value: 'Apex OS — TechnoEdge' },
  ];
  if (facts.reference) rows.splice(3, 0, { label: 'Reference', value: facts.reference });
  return rows;
}

/**
 * The sentence that must never be softened.
 *
 * Apex OS states attendance facts. It does not compute a deduction, and it has
 * not run payroll. An accountant reading this needs to know the arithmetic is
 * still theirs.
 */
export const NO_PAYROLL_STATEMENT =
  'This register states attendance facts only. Apex OS has not calculated any salary, ' +
  'deduction or payment, and no payroll has been processed. Leave balances are unaffected ' +
  'by this handoff.';

export function unresolvedWarning(facts: HandoffFacts): string | null {
  if (facts.employeesWithUnresolved <= 0) return null;
  return (
    `${facts.employeesWithUnresolved} employee(s) have ${facts.unresolvedDays} unresolved ` +
    'attendance day(s) in this period. Those rows are not a settled attendance result and ' +
    'should be confirmed with HR before they are used.'
  );
}
