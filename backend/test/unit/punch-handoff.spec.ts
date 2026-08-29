import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  HANDOFF_TTL_MS,
  PunchHandoffService,
  hashToken,
} from '../../src/modules/platform/attendance/punch/punch-handoff.service';

// A QR token is a bearer string: anyone who photographs the code from across a
// desk holds it. So it proves WHICH punch is being finished, never WHO is
// finishing it. Every completion re-checks the authenticated session against
// the handoff's owner, and userId and intent are columns rather than inputs so
// no request can change either.

const NOW = new Date('2026-08-29T09:30:00.000Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);

function build(over: any = {}) {
  const rows = new Map<string, any>();
  const updateManyCalls: any[] = [];

  const prisma: any = {
    attendancePunchHandoff: {
      create: jest.fn(async ({ data, select }: any) => {
        const row = {
          id: over.newId ?? 'ho-1',
          status: 'WAITING',
          completedAt: null,
          cancelledAt: null,
          evidenceId: null,
          ...data,
        };
        rows.set(row.id, row);
        return select ? row : row;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = over.row === null ? null : (over.row ?? rows.get(where.id) ?? null);
        return row ? { ...row, user: { name: 'Rahul' } } : null;
      }),
      findFirst: jest.fn(async ({ where }: any) =>
        over.row && over.row.userId === where.userId ? over.row : null,
      ),
      updateMany: jest.fn(async (args: any) => {
        updateManyCalls.push(args);
        // Models the conditional update: it matches only while WAITING.
        const target = over.row ?? rows.get(args.where.id);
        const matches =
          target &&
          (args.where.status === undefined || target.status === args.where.status) &&
          (args.where.expiresAt === undefined ||
            target.expiresAt.getTime() > args.where.expiresAt.gt.getTime());
        if (matches && !over.alreadyClaimed) {
          Object.assign(target, args.data);
          return { count: 1 };
        }
        return { count: 0 };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rows.get(where.id) ?? over.row;
        if (row) Object.assign(row, data);
        return row;
      }),
    },
  };

  const tva: any = { now: () => over.now ?? NOW };
  return { service: new PunchHandoffService(prisma, tva), prisma, rows, updateManyCalls };
}

/** A handoff as it sits in the database, with a known raw token. */
const RAW = 'raw-token-value';
const handoffRow = (over: any = {}) => ({
  id: 'ho-1',
  userId: 'emp-1',
  intent: 'PUNCH_IN',
  tokenHash: hashToken(RAW),
  idempotencyKey: 'handoff:abc',
  status: 'WAITING',
  expiresAt: later(HANDOFF_TTL_MS),
  completedAt: null,
  cancelledAt: null,
  evidenceId: null,
  ...over,
});

describe('creating a handoff', () => {
  it('returns the raw token exactly once and stores only its hash', async () => {
    const { service, prisma } = build();
    const created = await service.create('emp-1', 'PUNCH_IN');

    const stored = prisma.attendancePunchHandoff.create.mock.calls[0][0].data;

    expect(created.token).toBeTruthy();
    expect(stored.tokenHash).toBe(hashToken(created.token));
    // The raw secret must appear nowhere in what is written.
    expect(JSON.stringify(stored)).not.toContain(created.token);
  });

  it('mints a high-entropy token', async () => {
    const { service } = build();
    const a = await service.create('emp-1', 'PUNCH_IN');
    const b = await service.create('emp-1', 'PUNCH_IN');

    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(40);
  });

  it('shares one idempotency key so desktop and phone converge', async () => {
    // The whole race defence: both devices submit under this key, and
    // unique(userId, idempotencyKey) makes the second reuse the first punch.
    const { service } = build();
    const created = await service.create('emp-1', 'PUNCH_IN');

    expect(created.idempotencyKey).toMatch(/^handoff:/);
  });

  it('cancels any earlier open handoff for the same employee', async () => {
    const { service, updateManyCalls } = build();
    await service.create('emp-1', 'PUNCH_IN');

    expect(updateManyCalls[0].where).toMatchObject({ userId: 'emp-1', status: 'WAITING' });
    expect(updateManyCalls[0].data.status).toBe('CANCELLED');
  });

  it('expires in minutes, not hours', () => {
    expect(HANDOFF_TTL_MS).toBeLessThanOrEqual(10 * 60_000);
  });

  it('refuses an intent that is not a punch', async () => {
    const { service } = build();

    await expect(service.create('emp-1', 'SOMETHING' as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('the token alone is never enough', () => {
  it('refuses a different signed-in employee holding a valid token', async () => {
    // The attack the session check exists for: a colleague photographs the QR.
    const { service } = build({ row: handoffRow() });

    await expect(service.view('ho-1', RAW, 'emp-2')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.claim('ho-1', RAW, 'emp-2')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses an unauthenticated caller', async () => {
    const { service } = build({ row: handoffRow() });

    await expect(service.view('ho-1', RAW, '')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a wrong token even from the right employee', async () => {
    const { service } = build({ row: handoffRow() });

    await expect(service.view('ho-1', 'not-the-token', 'emp-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not confirm a handoff exists to someone who does not own it', async () => {
    // Identity is checked before expiry, so the wrong person learns nothing
    // about the state of somebody else's punch.
    const { service } = build({ row: handoffRow({ expiresAt: later(-1000) }) });

    await expect(service.claim('ho-1', RAW, 'emp-2')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('the handoff decides who and what, never the request', () => {
  it('returns the employee and intent from the row', async () => {
    const { service } = build({ row: handoffRow({ intent: 'PUNCH_OUT' }) });
    const claimed = await service.claim('ho-1', RAW, 'emp-1');

    expect(claimed.userId).toBe('emp-1');
    expect(claimed.intent).toBe('PUNCH_OUT');
  });

  it('takes no intent or user argument that could override them', () => {
    // If either were a parameter, a request could flip an in to an out.
    expect(PunchHandoffService.prototype.claim.length).toBe(3); // id, token, authUserId
  });
});

describe('single use and expiry', () => {
  it('rejects a token that was already completed', async () => {
    const { service } = build({ row: handoffRow({ status: 'COMPLETED' }) });

    await expect(service.claim('ho-1', RAW, 'emp-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a cancelled handoff', async () => {
    const { service } = build({ row: handoffRow({ status: 'CANCELLED' }) });

    await expect(service.claim('ho-1', RAW, 'emp-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an expired handoff even while still marked WAITING', async () => {
    const { service } = build({ row: handoffRow({ expiresAt: later(-1) }) });

    await expect(service.claim('ho-1', RAW, 'emp-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets exactly one of two concurrent scans win', async () => {
    // Both pass the read-time checks; the conditional update decides. A
    // read-then-write would let both through.
    const { service } = build({ row: handoffRow(), alreadyClaimed: true });

    await expect(service.claim('ho-1', RAW, 'emp-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('claims through a conditional update, not a plain write', async () => {
    const { service, updateManyCalls } = build({ row: handoffRow() });
    await service.claim('ho-1', RAW, 'emp-1');

    const claim = updateManyCalls.find((c) => c.data.status === 'COMPLETED');

    expect(claim.where.status).toBe('WAITING');
    expect(claim.where.expiresAt.gt).toEqual(NOW);
  });
});

describe('reading never mutates', () => {
  it('leaves the handoff WAITING after a view', async () => {
    // An earlier design moved it to PROCESSING on open, so a scan that was
    // closed immediately stranded the employee.
    const row = handoffRow();
    const { service } = build({ row });

    const view = await service.view('ho-1', RAW, 'emp-1');

    expect(view.status).toBe('WAITING');
    expect(row.status).toBe('WAITING');
  });

  it('has no PROCESSING state at all', async () => {
    const { PunchHandoffStatus } = await import('@prisma/client');

    expect(Object.keys(PunchHandoffStatus)).toEqual([
      'WAITING',
      'COMPLETED',
      'EXPIRED',
      'CANCELLED',
    ]);
  });
});

describe('status reporting', () => {
  it('reports an elapsed WAITING handoff as EXPIRED without writing', async () => {
    const row = handoffRow({ expiresAt: later(-1) });
    const { service } = build({ row });

    expect((await service.status('ho-1', 'emp-1')).status).toBe('EXPIRED');
    expect(row.status).toBe('WAITING');
  });

  it('will not report another employee handoff', async () => {
    const { service } = build({ row: handoffRow() });

    await expect(service.status('ho-1', 'emp-2')).rejects.toBeInstanceOf(NotFoundException);
  });
});
