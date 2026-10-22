import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';

/**
 * Phase 4 refusal codes. Every refusal is a structured 400/403/404/409/503
 * body `{ statusCode, code, message, ...details }`; codes with a remediation
 * entry are thrown as RemediationException instead (see remediation.registry).
 * Messages are written for the person reading the dialog. Details carry ids
 * and codes only.
 */
export const TRANSITION_CODE = {
  FEATURE_NOT_AVAILABLE: 'FEATURE_NOT_AVAILABLE',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  REASON_REQUIRED: 'REASON_REQUIRED',

  // Transfers
  TRANSFER_SELF: 'TRANSFER_SELF',
  TRANSFER_SUPER_ADMIN_TARGET: 'TRANSFER_SUPER_ADMIN_TARGET',
  TRANSFER_NO_CHANGE: 'TRANSFER_NO_CHANGE',
  TRANSFER_TARGET_INVALID: 'TRANSFER_TARGET_INVALID',
  TRANSFER_USER_NOT_ACTIVE: 'TRANSFER_USER_NOT_ACTIVE',
  TRANSFER_EXIT_CASE_OPEN: 'TRANSFER_EXIT_CASE_OPEN',
  TRANSFER_PENDING_EXISTS: 'TRANSFER_PENDING_EXISTS',
  TRANSFER_PREVIEW_STALE: 'TRANSFER_PREVIEW_STALE',
  TRANSFER_EFFECTIVE_DATE_INVALID: 'TRANSFER_EFFECTIVE_DATE_INVALID',
  TRANSFER_TODAY_NOT_CLEAN: 'TRANSFER_TODAY_NOT_CLEAN',
  TRANSFER_STATE_CHANGED: 'TRANSFER_STATE_CHANGED',
  TRANSFER_STALE_AT_ACTIVATION: 'TRANSFER_STALE_AT_ACTIVATION',
  TRANSFER_EFFECTIVE_DAY_NOT_CLEAN: 'TRANSFER_EFFECTIVE_DAY_NOT_CLEAN',
  USE_TRANSFER_WORKFLOW: 'USE_TRANSFER_WORKFLOW',

  // Exit
  EXIT_USER_NOT_ELIGIBLE: 'EXIT_USER_NOT_ELIGIBLE',
  EXIT_NO_EMPLOYMENT_PERIOD: 'EXIT_NO_EMPLOYMENT_PERIOD',
  EXIT_CASE_ALREADY_OPEN: 'EXIT_CASE_ALREADY_OPEN',
  EXIT_RESIGNATION_DATE_INVALID: 'EXIT_RESIGNATION_DATE_INVALID',
  EXIT_BACKDATE_NOT_ALLOWED: 'EXIT_BACKDATE_NOT_ALLOWED',
  EXIT_BACKDATE_REFERENCE_REQUIRED: 'EXIT_BACKDATE_REFERENCE_REQUIRED',
  PROBATION_STATUS_UNVERIFIED: 'PROBATION_STATUS_UNVERIFIED',
  EXIT_CASE_STATE_CHANGED: 'EXIT_CASE_STATE_CHANGED',
  EXIT_NOTICE_ADJUSTMENT_INVALID: 'EXIT_NOTICE_ADJUSTMENT_INVALID',
  RESIGNATION_WITHDRAWAL_CLOSED: 'RESIGNATION_WITHDRAWAL_CLOSED',
  OPEN_EXIT_CASE: 'OPEN_EXIT_CASE',

  // Clearance
  CLEARANCE_TRANSITION_INVALID: 'CLEARANCE_TRANSITION_INVALID',
  CLEARANCE_EVIDENCE_REQUIRED: 'CLEARANCE_EVIDENCE_REQUIRED',
  CLEARANCE_EVIDENCE_REF_INVALID: 'CLEARANCE_EVIDENCE_REF_INVALID',
  CLEARANCE_OWNER_INVALID: 'CLEARANCE_OWNER_INVALID',

  // F&F
  FNF_NOT_RELEASABLE: 'FNF_NOT_RELEASABLE',
  FNF_RELEASE_REFERENCE_REQUIRED: 'FNF_RELEASE_REFERENCE_REQUIRED',
  FNF_ADJUSTMENT_INVALID: 'FNF_ADJUSTMENT_INVALID',
  FNF_ADJUSTMENT_SAME_PERSON: 'FNF_ADJUSTMENT_SAME_PERSON',
  FNF_ADJUSTMENT_STATE_CHANGED: 'FNF_ADJUSTMENT_STATE_CHANGED',
  FNF_SETTLEMENT_CLOSED: 'FNF_SETTLEMENT_CLOSED',

  // Compliance
  RETENTION_PROPOSAL_INVALID: 'RETENTION_PROPOSAL_INVALID',
  RETENTION_PROPOSAL_PENDING: 'RETENTION_PROPOSAL_PENDING',
  RETENTION_PROPOSAL_STALE: 'RETENTION_PROPOSAL_STALE',
  RETENTION_PROPOSAL_SAME_PERSON: 'RETENTION_PROPOSAL_SAME_PERSON',
  RETENTION_PROPOSAL_STATE_CHANGED: 'RETENTION_PROPOSAL_STATE_CHANGED',
  LEGAL_HOLD_SAME_PERSON: 'LEGAL_HOLD_SAME_PERSON',
  LEGAL_HOLD_STATE_CHANGED: 'LEGAL_HOLD_STATE_CHANGED',
  LEGAL_HOLD_INVALID: 'LEGAL_HOLD_INVALID',

  // Payroll
  PAYROLL_UNRESOLVED_ACK_REQUIRED: 'PAYROLL_UNRESOLVED_ACK_REQUIRED',

  // Change requests / users
  CHANGE_REQUEST_FIELD_NOT_ALLOWED: 'CHANGE_REQUEST_FIELD_NOT_ALLOWED',
} as const;
export type TransitionCode = (typeof TRANSITION_CODE)[keyof typeof TRANSITION_CODE];

type Details = Record<string, unknown>;

export function badRequest(code: TransitionCode, message: string, details: Details = {}): never {
  throw new BadRequestException({ statusCode: 400, code, message, ...details });
}
export function forbidden(code: TransitionCode, message: string, details: Details = {}): never {
  throw new ForbiddenException({ statusCode: 403, code, message, ...details });
}
export function notFound(message = 'Not found.', details: Details = {}): never {
  throw new NotFoundException({ statusCode: 404, code: TRANSITION_CODE.NOT_FOUND, message, ...details });
}
export function conflict(code: TransitionCode, message: string, details: Details = {}): never {
  throw new ConflictException({ statusCode: 409, code, message, ...details });
}
export function unavailable(capability: string): never {
  throw new HttpException(
    { statusCode: 503, code: TRANSITION_CODE.FEATURE_NOT_AVAILABLE, capability, message: 'This feature is not enabled on this server yet.' },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

/** The fields every controller reads off `req.user`. */
export interface TransitionActor {
  id: string;
  roleName: string;
  isHR: boolean;
}

export function actorFrom(req: any): TransitionActor {
  const u = req?.user ?? {};
  return { id: u.id ?? u.sub, roleName: String(u.role?.name ?? u.role ?? ''), isHR: Boolean(u.isHR) };
}

export const isAdmin = (a: TransitionActor) => a.roleName === 'ADMIN' || a.roleName === 'SUPER_ADMIN';
export const isSuperAdmin = (a: TransitionActor) => a.roleName === 'SUPER_ADMIN';
export const isHrOrAdmin = (a: TransitionActor) => a.isHR || isAdmin(a);

export function requireAdmin(a: TransitionActor): void {
  if (!isAdmin(a)) forbidden(TRANSITION_CODE.FORBIDDEN, 'Only an Admin or Super Admin can do this.');
}
export function requireHrOrAdmin(a: TransitionActor): void {
  if (!isHrOrAdmin(a)) forbidden(TRANSITION_CODE.FORBIDDEN, 'Only HR, an Admin or a Super Admin can do this.');
}

/** A required free-text reason, trimmed and bounded. */
export function requireText(value: unknown, field: string, max = 500): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) badRequest(TRANSITION_CODE.REASON_REQUIRED, `${field} is required.`, { field });
  if (s.length > max) badRequest(TRANSITION_CODE.REASON_REQUIRED, `${field} must be at most ${max} characters.`, { field });
  return s;
}

export function optionalText(value: unknown, max = 500): string | null {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return null;
  return s.slice(0, max);
}

/** A YYYY-MM-DD business date, or a 400. */
export function businessDate(value: unknown, field: string): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(new Date(`${s}T00:00:00.000Z`).getTime())) {
    badRequest(TRANSITION_CODE.EXIT_RESIGNATION_DATE_INVALID, `${field} must be a date (YYYY-MM-DD).`, { field });
  }
  return s;
}

export function dateOnly(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function dayOf(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = dateOnly(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
