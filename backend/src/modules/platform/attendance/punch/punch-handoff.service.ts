import { createHash, randomBytes } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PunchType } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { TVAService } from '../../../../common/services/tva.service';

/**
 * One-time handoff so an employee can finish a punch on their phone.
 *
 * A laptop without a working camera or location cannot produce attendance
 * evidence. Rather than lowering what evidence means, the punch moves to a
 * device that can produce it.
 *
 * THE TOKEN IS NOT AN AUTHENTICATION. It is a bearer string, and anyone who
 * photographs the QR from across a desk holds it. So the phone must ALSO be
 * signed in as the same employee, and every completion re-checks
 * `authenticatedUserId === handoff.userId`. The token proves which punch is
 * being finished; the session proves who is finishing it.
 *
 * userId and intent are columns, not inputs. There is no code path that lets a
 * request change either, so a token cannot be turned into a different
 * employee's punch or flipped from in to out.
 *
 * Reading a handoff does NOT mutate it. An earlier design moved it to
 * PROCESSING when the page opened, which meant a scan someone closed
 * immediately left the handoff stuck and the employee unable to retry.
 */

/** Long enough that guessing is hopeless, short enough for a dense QR. */
const TOKEN_BYTES = 32;

/** A punch is happening now. Minutes, not hours. */
export const HANDOFF_TTL_MS = 5 * 60_000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreatedHandoff {
  handoffId: string;
  /** Returned exactly once. Never stored, never logged, never re-derivable. */
  token: string;
  intent: PunchType;
  expiresAt: Date;
  idempotencyKey: string;
}

export interface HandoffView {
  handoffId: string;
  intent: PunchType;
  status: string;
  expiresAt: Date;
  employeeName: string | null;
}

@Injectable()
export class PunchHandoffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tva: TVAService,
  ) {}

  /**
   * Opens a handoff for the authenticated employee.
   *
   * The idempotency key is minted HERE, before the QR exists, and shared with
   * whichever device submits. That is what makes the desktop/phone race safe:
   * both carry the same key, and unique(userId, idempotencyKey) means the
   * second submission returns the first punch instead of creating another.
   */
  async create(userId: string, intent: PunchType): Promise<CreatedHandoff> {
    if (!userId) throw new ForbiddenException('Not authenticated');
    if (intent !== 'PUNCH_IN' && intent !== 'PUNCH_OUT') {
      throw new BadRequestException('intent must be PUNCH_IN or PUNCH_OUT');
    }

    // Any earlier open handoff for this employee is abandoned: two live QR
    // codes for one person is a race nobody asked for.
    await this.prisma.attendancePunchHandoff.updateMany({
      where: { userId, status: 'WAITING' },
      data: { status: 'CANCELLED', cancelledAt: this.tva.now() },
    });

    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(this.tva.now().getTime() + HANDOFF_TTL_MS);
    const idempotencyKey = `handoff:${randomBytes(16).toString('hex')}`;

    const row = await this.prisma.attendancePunchHandoff.create({
      data: {
        userId,
        intent,
        tokenHash: hashToken(token),
        idempotencyKey,
        expiresAt,
      },
      select: { id: true, intent: true, expiresAt: true, idempotencyKey: true },
    });

    return {
      handoffId: row.id,
      token,
      intent: row.intent,
      expiresAt: row.expiresAt,
      idempotencyKey: row.idempotencyKey,
    };
  }

  /**
   * Validates a handoff for the phone WITHOUT changing it.
   *
   * `sessionUserId` may be null: the token is the credential here, not the
   * session. See load() for why a session that IS present is still checked.
   */
  async view(
    handoffId: string,
    token: string,
    sessionUserId: string | null,
  ): Promise<HandoffView> {
    const row = await this.load(handoffId, token, sessionUserId);

    return {
      handoffId: row.id,
      intent: row.intent,
      status: row.status,
      expiresAt: row.expiresAt,
      employeeName: row.user?.name ?? null,
    };
  }

  /**
   * The shared checks, in an order chosen so the message is useful.
   *
   * THE TOKEN IS THE CREDENTIAL. A phone with no Apex OS session may complete
   * the punch, which is the entire point of the QR: an employee in a doorway
   * whose laptop camera failed must not be sent through a login screen to
   * record a punch their laptop already authorised. The token is single-use,
   * expires in minutes, is stored only as a hash, and names the employee and
   * the punch type itself -- none of which the phone can influence.
   *
   * A session that belongs to SOMEBODY ELSE is still refused. "Signed out" and
   * "signed in as a different employee" are different facts: the first is an
   * ordinary employee, the second is a colleague holding a QR that is not
   * theirs, which is the likeliest way this would be abused. Refusing it costs
   * the honest employee nothing.
   *
   * Identity is verified before expiry: telling the wrong person that somebody
   * else's handoff has expired is a small leak.
   */
  private async load(handoffId: string, token: string, sessionUserId: string | null) {
    if (!handoffId || !token) throw new BadRequestException('Handoff reference is incomplete');

    const row = await this.prisma.attendancePunchHandoff.findUnique({
      where: { id: handoffId },
      include: { user: { select: { name: true } } },
    });
    if (!row) throw new NotFoundException('This punch link is not valid');

    // Constant work regardless of outcome; the hash comparison is on digests
    // of equal length.
    if (row.tokenHash !== hashToken(token)) {
      throw new NotFoundException('This punch link is not valid');
    }

    if (sessionUserId && row.userId !== sessionUserId) {
      throw new ForbiddenException(
        'This punch link belongs to a different employee. It cannot be used from this account.',
      );
    }

    if (row.status === 'COMPLETED') {
      throw new BadRequestException('This punch has already been completed');
    }
    if (row.status === 'CANCELLED') {
      throw new BadRequestException('This punch link was cancelled');
    }
    if (row.status === 'EXPIRED' || row.expiresAt.getTime() <= this.tva.now().getTime()) {
      throw new BadRequestException('This punch link has expired. Start again from your computer.');
    }

    return row;
  }

  /**
   * WHO this handoff belongs to, without consuming it.
   *
   * The phone must upload its photo BEFORE it submits the punch, and that
   * upload has to be attributed to somebody. Using claim() here would burn the
   * single use on the photo and leave the punch itself unable to claim
   * anything -- so this runs exactly the same checks and mutates nothing.
   *
   * The id is returned from the ROW. A phone that uploads a photo can never
   * attribute it to an employee of its choosing.
   */
  async resolveOwner(
    handoffId: string,
    token: string,
    sessionUserId: string | null,
  ): Promise<string> {
    const row = await this.load(handoffId, token, sessionUserId);
    return row.userId;
  }

  /**
   * Claims the handoff so a punch may be submitted against it.
   *
   * The conditional updateMany is the concurrency control: two phones scanning
   * the same QR both reach here, exactly one matches `status: WAITING`, and the
   * loser is told the punch is already done. A read-then-write would let both
   * through.
   *
   * Returns the idempotency key, so the caller submits the punch under the same
   * key the desktop holds.
   */
  async claim(
    handoffId: string,
    token: string,
    sessionUserId: string | null,
  ): Promise<{ userId: string; intent: PunchType; idempotencyKey: string }> {
    const row = await this.load(handoffId, token, sessionUserId);

    const claimed = await this.prisma.attendancePunchHandoff.updateMany({
      where: { id: row.id, status: 'WAITING', expiresAt: { gt: this.tva.now() } },
      data: { status: 'COMPLETED', completedAt: this.tva.now() },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException('This punch has already been completed');
    }

    // Both come from the row, never from the request.
    return { userId: row.userId, intent: row.intent, idempotencyKey: row.idempotencyKey };
  }

  /**
   * Records which evidence settled the handoff.
   *
   * Separate from claim() on purpose: the claim must be atomic and must not
   * wait on the punch write, and a punch that fails after claiming leaves a
   * COMPLETED handoff with no evidence — visible, and better than a handoff
   * that stays open for a punch that already happened.
   */
  async attachEvidence(handoffId: string, evidenceId: string): Promise<void> {
    await this.prisma.attendancePunchHandoff
      .update({ where: { id: handoffId }, data: { evidenceId } })
      .catch(() => undefined);
  }

  /** Desktop closed the dialog. Best effort; expiry is the real backstop. */
  async cancel(handoffId: string, userId: string): Promise<void> {
    await this.prisma.attendancePunchHandoff.updateMany({
      where: { id: handoffId, userId, status: 'WAITING' },
      data: { status: 'CANCELLED', cancelledAt: this.tva.now() },
    });
  }

  /** Desktop polling fallback for when the socket does not deliver. */
  async status(handoffId: string, userId: string) {
    const row = await this.prisma.attendancePunchHandoff.findFirst({
      where: { id: handoffId, userId },
      select: { id: true, status: true, expiresAt: true, completedAt: true, evidenceId: true },
    });
    if (!row) throw new NotFoundException('Handoff not found');

    const expired =
      row.status === 'WAITING' && row.expiresAt.getTime() <= this.tva.now().getTime();

    return { ...row, status: expired ? 'EXPIRED' : row.status };
  }
}
