import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TVAService } from './tva.service';

export const ACTIVE_WORKDAY_REQUIRED = 'ACTIVE_WORKDAY_REQUIRED';
export const ACTIVE_WORKDAY_REQUIRED_MESSAGE = 'Punch In before creating a ticket.';

/**
 * Work-session statuses that mean the person is punched in. A break or an idle
 * pause is still inside the workday. LOGGED_IN (a session row that never
 * started work) and ON_LEAVE are not punched in, and LOGGED_OUT / AUTO_CLOSED
 * are closed.
 */
export const PUNCHED_IN_SESSION_STATUSES = ['WORKING', 'ON_BREAK', 'IDLE'] as const;

/** Pure form of the rule for a session already loaded for the current company date. */
export function isPunchedInSession(session: { logoutAt: Date | null; status: string } | null | undefined): boolean {
  return !!session && !session.logoutAt && (PUNCHED_IN_SESSION_STATUSES as readonly string[]).includes(session.status);
}

/** What GET /workday/today reports, so the UI gates creation on the same rule the API enforces. */
export function ticketCreationState(punchedIn: boolean) {
  return punchedIn
    ? { allowed: true as const }
    : { allowed: false as const, code: ACTIVE_WORKDAY_REQUIRED, message: ACTIVE_WORKDAY_REQUIRED_MESSAGE };
}

export interface ActiveWorkday {
  sessionId: string;
  status: string;
}

/**
 * The single rule for "is this person punched in right now": their latest work
 * session dated the current company business date is open (no logoutAt) and in
 * a punched-in status. An older session that a newer one superseded never
 * counts, and neither does user.currentStatus: the session ledger decides.
 * Used to gate human ticket creation; GET /workday/today reports the same rule
 * through isPunchedInSession().
 */
@Injectable()
export class ActiveWorkdayPolicyService {
  constructor(
    private readonly tva: TVAService,
  ) {}

  /**
   * Requires an active workday inside the caller's transaction and holds a
   * share lock on the latest session row until the transaction ends.
   *
   * Every session close (Punch Out, End Day, scheduler auto-close, idle
   * logout) row-locks the session FOR UPDATE before writing it, so it waits
   * for this transaction, and this one waits for a close already in progress.
   * After such a wait PostgreSQL returns the row's committed version, so a
   * session the transaction ahead of us closed is read as closed.
   */
  async assertActiveWorkdayLocked(
    tx: Prisma.TransactionClient,
    userId: string,
    message: string = ACTIVE_WORKDAY_REQUIRED_MESSAGE,
  ): Promise<ActiveWorkday> {
    const companyDate = this.tva.companyBusinessDate();
    const [latest] = await tx.$queryRaw<Array<{ id: string; status: string; logoutAt: Date | null }>>`
      SELECT id, status, "logoutAt"
      FROM "work_sessions"
      WHERE "userId" = ${userId}
        AND "date" = ${companyDate}::date
      ORDER BY "createdAt" DESC, id DESC
      LIMIT 1
      FOR SHARE
    `;
    if (!isPunchedInSession(latest)) throw activeWorkdayRequired(message);
    return { sessionId: latest.id, status: latest.status };
  }
}

export function activeWorkdayRequired(message: string = ACTIVE_WORKDAY_REQUIRED_MESSAGE) {
  return new ConflictException({
    statusCode: 409,
    code: ACTIVE_WORKDAY_REQUIRED,
    message,
  });
}
