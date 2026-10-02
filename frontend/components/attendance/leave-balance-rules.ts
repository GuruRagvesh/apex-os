/**
 * The shapes and the one date rule behind personal leave entitlement.
 *
 * Split out of leave-balance-api.ts so that a screen's pure presentation logic
 * can reuse this WITHOUT importing the authenticated HTTP client that file
 * carries. The backend test suite exercises the pure modules directly, and a
 * transport import in the chain pulls axios into a test that has no business
 * with it. leave-balance-api.ts re-exports everything here, so every existing
 * consumer keeps its own import untouched.
 *
 * No network, no clock of its own: expiringSoon is handed "now".
 */

/** What GET /leave/balance returns for one leave type. */
export interface LeaveBalance {
  allocation: number;
  approved: number;
  pending: number;
  balance: number;
}

export interface CompOffCredit {
  id: string;
  earnedFromBusinessDate: string;
  earnedAt: string;
  expiresAt: string;
  status: string;
}

/** The leave types an employee sees on their own attendance page. */
export const PERSONAL_LEAVE_TYPES = ['CASUAL', 'EMERGENCY'] as const;
export type PersonalLeaveType = (typeof PERSONAL_LEAVE_TYPES)[number];

export const LEAVE_TYPE_LABEL: Record<PersonalLeaveType, string> = {
  CASUAL: 'Casual Leave',
  EMERGENCY: 'Emergency Leave',
};

/**
 * Credits expiring within `days`, soonest first.
 *
 * Comp off is consumed oldest-expiry-first, so the nearest expiry is the one
 * an employee actually needs to act on.
 */
export function expiringSoon(credits: CompOffCredit[], now: Date, days = 30): CompOffCredit[] {
  const limit = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return credits
    .filter((c) => {
      const at = new Date(c.expiresAt);
      return !Number.isNaN(at.getTime()) && at <= limit;
    })
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
}
