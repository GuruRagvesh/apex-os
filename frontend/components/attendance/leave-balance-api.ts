import { api, unwrap as r } from '@apex/shared-auth';

/**
 * Personal leave entitlement, for the employee's own view.
 *
 * Company holidays and personal leave are different things and are kept apart
 * deliberately: a holiday is a date the company does not work, an entitlement
 * is days this employee may take. Calling the second "holidays available"
 * conflates them, so nothing here uses that word.
 *
 * The response interceptor in `@apex/shared-auth` already returns
 * `response.data`, so these must NOT unwrap a second `.data`.
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

export async function getMyLeaveBalance(type: PersonalLeaveType): Promise<LeaveBalance> {
  return r(api.get('/leave/balance', { params: { type } }));
}

export async function getMyCompOffCredits(): Promise<CompOffCredit[]> {
  const rows = await r<CompOffCredit[]>(api.get('/leave/comp-off/me'));
  return Array.isArray(rows) ? rows : [];
}

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
