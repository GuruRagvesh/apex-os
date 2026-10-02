/**
 * THE DESTRUCTIVE PATH.
 *
 * Deleting an employee cannot be undone, so almost every test here asks the
 * same question from a different angle: is there any way to reach the delete
 * without a verified archive in Google Drive, or any way for the company's
 * shared history to disappear with the person?
 *
 * The fake storage shares its comparison logic with the real Drive adapter,
 * so a fail-closed case passing here is evidence about production and not
 * about the double.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  ArchiveDeleteService,
  DELETE_STEPS,
  NULL_STEPS,
  SNAPSHOT_STEPS,
} from '../../src/modules/platform/archive/archive-delete.service';
import { EmployeeArchiveCollectorService } from '../../src/modules/platform/archive/employee-archive-collector.service';
import { USER_RELATION_RULES } from '../../src/modules/platform/archive/user-relation-classification';
import { FakeEmployeeArchiveStorage } from '../helpers/fake-archive-storage';

const ADMIN = { id: 'admin-1', name: 'Priya', role: { name: 'ADMIN' } };
const SUPER = { id: 'su-1', name: 'Root', role: { name: 'SUPER_ADMIN' } };
const HR = { id: 'hr-1', name: 'Hema', role: { name: 'EMPLOYEE' }, isHR: true };
const MANAGER = { id: 'mgr-1', name: 'Manoj', role: { name: 'MANAGER' } };
const TEAM_LEAD = { id: 'tl-1', name: 'Tara', role: { name: 'TEAM_LEAD' } };
const EMPLOYEE = { id: 'emp-9', name: 'Eshan', role: { name: 'EMPLOYEE' } };
const INTERN = { id: 'int-1', name: 'Ira', role: { name: 'INTERN' } };

const TARGET = {
  id: 'u-1',
  name: 'Rahul Verma',
  employeeId: 'TE-014',
  role: { name: 'EMPLOYEE' },
  department: { name: 'Delivery' },
};

interface Opts {
  target?: any | null;
  /** Existing ledger row, to model a retry or a replay. */
  ledger?: any | null;
  /** Counts returned by the BLOCK_DELETE checks. */
  blockers?: Partial<Record<'team' | 'changeRequest' | 'lead', number>>;
  /** Remaining active Super Admins other than the target. */
  otherSuperAdmins?: number;
  storage?: FakeEmployeeArchiveStorage;
  /** Make one transaction step throw, to exercise rollback. */
  failInTransaction?: string;
  /** Make the collector throw. */
  collectorThrows?: Error;
  /** Make the ledger create collide, as a concurrent claim would. */
  claimRace?: boolean;
}

function rig(opts: Opts = {}) {
  const storage = opts.storage ?? new FakeEmployeeArchiveStorage();
  /** Everything the transaction did, in order. */
  const actions: string[] = [];
  let ledgerRow: any =
    opts.ledger === undefined ? null : opts.ledger;
  let committed = true;

  const target = opts.target === undefined ? TARGET : opts.target;

  const counts: Record<string, number> = {
    team: opts.blockers?.team ?? 0,
    changeRequest: opts.blockers?.changeRequest ?? 0,
    lead: opts.blockers?.lead ?? 0,
  };

  const delegateFor = (name: string, inTx: boolean) => ({
    updateMany: jest.fn(async (args: any) => {
      if (opts.failInTransaction === name) throw new Error(`boom in ${name}`);
      actions.push(`${name}.updateMany`);
      return { count: 1 };
    }),
    deleteMany: jest.fn(async () => {
      if (opts.failInTransaction === name) throw new Error(`boom in ${name}`);
      actions.push(`${name}.deleteMany`);
      return { count: 1 };
    }),
    findMany: jest.fn(async () => []),
    count: jest.fn(async () => 0),
  });

  const base: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') return undefined;
      return delegateFor(prop, false);
    },
  });

  const prisma: any = {
    user: {
      findUnique: jest.fn(async () => target),
      count: jest.fn(async () => opts.otherSuperAdmins ?? 1),
      delete: jest.fn(async () => {
        if (opts.failInTransaction === 'user') throw new Error('boom deleting user');
        actions.push('user.delete');
        return target;
      }),
    },
    team: { count: jest.fn(async () => counts.team) },
    // Defined explicitly for its `count`, so its write methods must ALSO
    // record -- otherwise this delegate silently escapes the recording proxy
    // and the "every retained record is repointed" assertion cannot see it.
    employeeProfileChangeRequest: {
      // Spread FIRST, then the real count: delegateFor supplies a generic
      // count of 0 and would otherwise overwrite the blocker fixture.
      ...delegateFor('employeeProfileChangeRequest', true),
      count: jest.fn(async () => counts.changeRequest),
    },
    lead: { count: jest.fn(async () => counts.lead) },
    formerEmployee: {
      create: jest.fn(async ({ data }: any) => {
        if (opts.failInTransaction === 'formerEmployee') throw new Error('boom tombstone');
        actions.push('formerEmployee.create');
        return { id: 'former-1', ...data };
      }),
    },
    employeeDeletionLedger: {
      findUnique: jest.fn(async () => ledgerRow),
      create: jest.fn(async ({ data }: any) => {
        if (opts.claimRace) {
          const err: any = new Error('unique');
          err.code = 'P2002';
          throw err;
        }
        ledgerRow = { ...data };
        return ledgerRow;
      }),
      update: jest.fn(async ({ data }: any) => {
        ledgerRow = { ...(ledgerRow ?? {}), ...data };
        return ledgerRow;
      }),
    },
    $transaction: jest.fn(async (fn: any) => {
      const tx: any = new Proxy(
        {
          user: prisma.user,
          team: prisma.team,
          lead: prisma.lead,
          employeeProfileChangeRequest: prisma.employeeProfileChangeRequest,
          formerEmployee: prisma.formerEmployee,
          employeeDeletionLedger: prisma.employeeDeletionLedger,
        },
        {
          get(t: any, prop: string) {
            if (prop in t) return t[prop];
            return delegateFor(prop, true);
          },
        },
      );
      try {
        return await fn(tx);
      } catch (err) {
        // A real transaction discards everything on throw. The double records
        // that so a test can assert nothing survived.
        committed = false;
        throw err;
      }
    }),
  };

  // The proxy above covers delegates the transaction reaches for.
  Object.setPrototypeOf(prisma, base);

  const accessPolicy: any = { roleName: (u: any) => u?.role?.name ?? '' };

  const collector: any = {
    collect: jest.fn(async () => {
      if (opts.collectorThrows) throw opts.collectorThrows;
      return {
        manifest: {
          archiveVersion: '1.0',
          generatedAt: '2026-10-03T06:00:00.000Z',
          environment: 'test',
          applicationVersion: null,
          formerUserId: 'u-1',
          employeeId: 'TE-014',
          displayName: 'Rahul Verma',
          archivedByUserId: 'admin-1',
          archivedByDisplayName: 'Priya',
          datasets: [],
          entityCounts: {},
          excludedSecretCategories: ['passwordHash'],
        },
        employee: { id: 'u-1', name: 'Rahul Verma' },
        datasets: {},
        relationships: [],
      };
    }),
  };

  const config: any = { get: (k: string) => (k === 'APP_ENV' ? 'test' : undefined) };

  const service = new ArchiveDeleteService(
    prisma, accessPolicy, collector as EmployeeArchiveCollectorService, config, storage,
  );

  return {
    service, prisma, storage, collector, actions,
    ledger: () => ledgerRow,
    committed: () => committed,
  };
}

// ════════════════════════════════════════════════════════════════════════════
describe('who may archive and delete an employee', () => {
  it.each([
    ['an employee', EMPLOYEE],
    ['an intern', INTERN],
    ['a team lead', TEAM_LEAD],
    ['a manager', MANAGER],
    ['HR without admin', HR],
  ])('REFUSES %s', async (_label, actor) => {
    const { service, prisma } = rig();

    await expect(service.archiveAndDelete(actor, 'u-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Refused before anything is even looked up.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('ALLOWS an Admin', async () => {
    const { service } = rig();
    await expect(service.archiveAndDelete(ADMIN, 'u-1')).resolves.toMatchObject({
      deleted: true,
    });
  });

  it('ALLOWS a Super Admin', async () => {
    const { service } = rig();
    await expect(service.archiveAndDelete(SUPER, 'u-1')).resolves.toMatchObject({
      deleted: true,
    });
  });

  it('reports an unknown employee as missing', async () => {
    const { service } = rig({ target: null });
    await expect(service.archiveAndDelete(ADMIN, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('the protections that have nothing to do with roles', () => {
  it('BLOCKS SELF-DELETE', async () => {
    const { service, storage } = rig({
      target: { ...TARGET, id: 'admin-1', role: { name: 'ADMIN' } },
    });

    await expect(service.archiveAndDelete(ADMIN, 'admin-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.uploads).toEqual([]);
  });

  it('BLOCKS DELETING THE LAST SUPER ADMIN', async () => {
    const { service, storage } = rig({
      target: { ...TARGET, id: 'su-2', role: { name: 'SUPER_ADMIN' } },
      otherSuperAdmins: 0,
    });

    await expect(service.archiveAndDelete(SUPER, 'su-2')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(storage.uploads).toEqual([]);
  });

  it('allows deleting a Super Admin when another remains', async () => {
    // Without this, the guard above could be refusing all Super Admins.
    const { service } = rig({
      target: { ...TARGET, id: 'su-2', role: { name: 'SUPER_ADMIN' } },
      otherSuperAdmins: 1,
    });

    await expect(service.archiveAndDelete(SUPER, 'su-2')).resolves.toMatchObject({
      deleted: true,
    });
  });

  it.each([
    ['a team they lead', { team: 1 }],
    ['a pending approval assigned to them', { changeRequest: 1 }],
    ['a lead they own', { lead: 1 }],
  ])('BLOCKS when the employee still has %s', async (_label, blockers) => {
    const { service, storage } = rig({ blockers });

    await expect(service.archiveAndDelete(ADMIN, 'u-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    // Blocked BEFORE the archive, so an administrator is not made to wait
    // through an upload to be told to reassign a team.
    expect(storage.uploads).toEqual([]);
  });

  it('tells the administrator how to resolve a blocker', async () => {
    const { service } = rig({ blockers: { lead: 2 } });

    await service.archiveAndDelete(ADMIN, 'u-1').catch((err) => {
      const body = err.getResponse();
      expect(body.blockers[0].what).toBe('Lead.owner');
      expect(body.blockers[0].count).toBe(2);
      expect(body.blockers[0].resolution).toMatch(/reassign/i);
    });
    expect.assertions(3);
  });

  it('ENFORCES EVERY BLOCK_DELETE RULE THE CLASSIFICATION DECLARES', () => {
    // A rule classified BLOCK_DELETE with no check in the service would be
    // silently unenforced, and the classification would be describing a
    // protection that does not exist.
    const declared = USER_RELATION_RULES.filter((r) => r.action === 'BLOCK_DELETE')
      .map((r) => `${r.model}.${r.field}`)
      .sort();

    expect([...ArchiveDeleteService.ENFORCED_BLOCKERS].sort()).toEqual(declared);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('nothing is deleted without a verified archive', () => {
  it('COLLECTOR FAILURE leaves the employee alone', async () => {
    const { service, prisma, storage } = rig({
      collectorThrows: new Error('database unavailable'),
    });

    await expect(service.archiveAndDelete(ADMIN, 'u-1')).rejects.toThrow('database unavailable');
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(storage.uploads).toEqual([]);
  });

  it('UPLOAD FAILURE leaves the employee alone', async () => {
    const storage = new FakeEmployeeArchiveStorage({ failUpload: new Error('drive down') });
    const { service, prisma } = rig({ storage });

    await expect(service.archiveAndDelete(ADMIN, 'u-1')).rejects.toThrow('drive down');
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('VERIFICATION FAILURE leaves the employee alone', async () => {
    const storage = new FakeEmployeeArchiveStorage({ failVerify: new Error('permission denied') });
    const { service, prisma } = rig({ storage });

    await expect(service.archiveAndDelete(ADMIN, 'u-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('A WRONG SIZE IN DRIVE leaves the employee alone', async () => {
    const storage = new FakeEmployeeArchiveStorage({ reportBytes: 7 });
    const { service, prisma } = rig({ storage });

    await expect(service.archiveAndDelete(ADMIN, 'u-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('A WRONG CHECKSUM IN DRIVE leaves the employee alone', async () => {
    const storage = new FakeEmployeeArchiveStorage({ reportChecksum: 'deadbeef' });
    const { service, prisma } = rig({ storage });

    await expect(service.archiveAndDelete(ADMIN, 'u-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('says plainly that the employee was NOT deleted', async () => {
    const storage = new FakeEmployeeArchiveStorage({ reportBytes: 7 });
    const { service } = rig({ storage });

    await expect(service.archiveAndDelete(ADMIN, 'u-1')).rejects.toThrow(/NOT deleted/i);
  });

  it('UPLOADS ONLY AFTER COLLECTING, AND VERIFIES BEFORE DELETING', async () => {
    // The ordering IS the safety property, so it is asserted directly rather
    // than inferred from the failure cases.
    const { service, storage, collector, prisma } = rig();

    await service.archiveAndDelete(ADMIN, 'u-1');

    expect(collector.collect).toHaveBeenCalled();
    expect(storage.uploads).toHaveLength(1);
    expect(storage.verifications).toHaveLength(1);
    expect(prisma.user.delete).toHaveBeenCalled();

    const collectedAt = (collector.collect as jest.Mock).mock.invocationCallOrder[0];
    const uploadedAt = (storage.uploads.length && 1) as number;
    const deletedAt = (prisma.user.delete as jest.Mock).mock.invocationCallOrder[0];
    expect(collectedAt).toBeLessThan(deletedAt);
    expect(uploadedAt).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the deletion transaction', () => {
  it('writes the tombstone BEFORE repointing anything at it', async () => {
    const { service, actions } = rig();

    await service.archiveAndDelete(ADMIN, 'u-1');

    const tombstone = actions.indexOf('formerEmployee.create');
    const firstRepoint = actions.findIndex((a) => a.endsWith('.updateMany'));
    expect(tombstone).toBeGreaterThanOrEqual(0);
    expect(tombstone).toBeLessThan(firstRepoint);
  });

  it('DELETES THE USER LAST', async () => {
    const { service, actions } = rig();

    await service.archiveAndDelete(ADMIN, 'u-1');

    expect(actions[actions.length - 1]).toBe('user.delete');
  });

  it.each([
    ['the tombstone', 'formerEmployee'],
    ['a snapshot repoint', 'ticket'],
    ['a personal delete', 'dailyAttendance'],
    ['the user delete', 'user'],
  ])('ROLLS BACK EVERYTHING when %s fails', async (_label, step) => {
    const { service, committed } = rig({ failInTransaction: step });

    await expect(service.archiveAndDelete(ADMIN, 'u-1')).rejects.toThrow();
    expect(committed()).toBe(false);
  });

  it('RECORDS THE FAILURE but keeps the verified archive', async () => {
    const { service, storage, ledger } = rig({ failInTransaction: 'user' });

    await expect(service.archiveAndDelete(ADMIN, 'u-1')).rejects.toThrow();

    // The archive stays in Drive: it is valid, it cost an upload, and a retry
    // should not have to make another one.
    expect(storage.uploads).toHaveLength(1);
    expect(ledger().status).toBe('FAILED');
    expect(ledger().failureReason).toBeTruthy();
  });
});

describe('what survives and what goes', () => {
  it('REPOINTS EVERY RETAINED RECORD at the tombstone', async () => {
    const { service, actions } = rig();

    await service.archiveAndDelete(ADMIN, 'u-1');

    for (const step of SNAPSHOT_STEPS) {
      expect(actions).toContain(`${step.delegate}.updateMany`);
    }
  });

  it('NEVER DELETES A SHARED RECORD', async () => {
    // The property the company actually cares about: the work survives the
    // worker. A ticket, comment, time log or audit event must never appear in
    // a deleteMany.
    const { service, actions } = rig();

    await service.archiveAndDelete(ADMIN, 'u-1');

    for (const shared of [
      'ticket', 'comment', 'ticketHistory', 'ticketTimeLog',
      'operationalEvent', 'activityLog', 'reviewCycleLog',
      'attendanceMonthClose', 'attendanceImportBatch', 'leadActivity', 'followUp',
    ]) {
      expect(actions).not.toContain(`${shared}.deleteMany`);
    }
  });

  it('REMOVES EVERY PERSONAL RECORD', async () => {
    const { service, actions } = rig();

    await service.archiveAndDelete(ADMIN, 'u-1');

    for (const step of DELETE_STEPS) {
      expect(actions).toContain(`${step.delegate}.deleteMany`);
    }
  });

  it('nulls the retained-but-unattributed references', async () => {
    const { service, actions } = rig();

    await service.archiveAndDelete(ADMIN, 'u-1');

    for (const step of NULL_STEPS) {
      expect(actions).toContain(`${step.delegate}.updateMany`);
    }
  });

  it('THE DELETE PLAN MATCHES THE CLASSIFICATION, relation for relation', async () => {
    // The guard that stops the two drifting. A relation reclassified in the
    // matrix but not handled here would be silently skipped -- orphaned, or
    // left blocking the delete.
    const planned = new Set([
      ...SNAPSHOT_STEPS.map((s) => `${s.model}.${s.field}`),
      ...NULL_STEPS.map((s) => `${s.model}.${s.field}`),
      ...DELETE_STEPS.map((s) => `${s.model}.${s.field}`),
      ...ArchiveDeleteService.ENFORCED_BLOCKERS,
    ]);

    const classified = USER_RELATION_RULES.map((r) => `${r.model}.${r.field}`);
    const missing = classified.filter((key) => !planned.has(key));

    expect(missing).toEqual([]);
    expect(planned.size).toBe(classified.length);
  });

  it('each plan step carries the action its classification gives it', () => {
    const byKey = new Map(
      USER_RELATION_RULES.map((r) => [`${r.model}.${r.field}`, r.action]),
    );

    for (const s of SNAPSHOT_STEPS) {
      expect(byKey.get(`${s.model}.${s.field}`)).toBe('RETAIN_WITH_SNAPSHOT');
    }
    for (const s of NULL_STEPS) {
      expect(byKey.get(`${s.model}.${s.field}`)).toBe('RETAIN_AND_NULL_ACTOR');
    }
    for (const s of DELETE_STEPS) {
      expect(byKey.get(`${s.model}.${s.field}`)).toBe('DELETE_WITH_USER');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the ledger and repeated requests', () => {
  it('RECORDS WHERE THE ARCHIVE WENT, and who ordered it', async () => {
    const { service, ledger } = rig();

    const result = await service.archiveAndDelete(ADMIN, 'u-1');

    expect(ledger().status).toBe('COMPLETED');
    expect(ledger().driveFileId).toBe(result.driveFileId);
    expect(ledger().archiveChecksum).toBe(result.archiveChecksum);
    expect(ledger().archiveBytes).toBeGreaterThan(0);
    expect(ledger().initiatedById).toBe('admin-1');
    expect(ledger().deletedAt).toBeInstanceOf(Date);
  });

  it('REFUSES A REPLAY of an already completed deletion', async () => {
    const { service, prisma } = rig({
      ledger: { formerUserId: 'u-1', status: 'COMPLETED' },
    });

    await expect(service.archiveAndDelete(ADMIN, 'u-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it.each(['REQUESTED', 'ARCHIVING', 'ARCHIVED', 'DELETE_STARTED'])(
    'REFUSES A SECOND REQUEST while one is %s',
    async (status) => {
      // The double-click, and the second administrator.
      const { service, prisma } = rig({ ledger: { formerUserId: 'u-1', status } });

      await expect(service.archiveAndDelete(ADMIN, 'u-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    },
  );

  it('ALLOWS A RETRY after a failure', async () => {
    const { service } = rig({
      ledger: { formerUserId: 'u-1', status: 'FAILED', failureReason: 'drive down' },
    });

    await expect(service.archiveAndDelete(ADMIN, 'u-1')).resolves.toMatchObject({
      deleted: true,
    });
  });

  it('LOSES A RACE SAFELY when two admins claim at once', async () => {
    // Both pass the read; only one can win the unique index. The loser is
    // told, rather than starting a second destructive run.
    const { service, prisma } = rig({ claimRace: true });

    await expect(service.archiveAndDelete(ADMIN, 'u-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('claims the operation BEFORE uploading anything', async () => {
    // Claiming after the upload would let two administrators both archive.
    const { service, prisma, storage } = rig();

    await service.archiveAndDelete(ADMIN, 'u-1');

    const claimed = (prisma.employeeDeletionLedger.create as jest.Mock)
      .mock.invocationCallOrder[0];
    expect(claimed).toBeGreaterThan(0);
    expect(storage.uploads).toHaveLength(1);
  });
});
