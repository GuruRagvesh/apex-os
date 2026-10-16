import { UserLifecycleService, LifecyclePorts } from '../../src/modules/core/users/lifecycle/user-lifecycle.service';
import { collectInventory, dataFingerprint } from '../../src/modules/core/users/lifecycle/dependency-inventory';
import { isHoldActive } from '../../src/common/lifecycle-domain';
import { DENIED_KEYS } from '../../src/common/remediation';

// Backend contract tests for Permanent Delete remediation (spec §11.6.1,
// erratum E2), with an in-memory database: precedence, holdStatus, the
// allow-list, and the POST answering with a RemediationException.

const KEY = Buffer.alloc(32, 7).toString('base64');
const ADMIN = { id: 'admin-1', role: { name: 'ADMIN' } };

interface Scenario {
  holds?: { status: string | null; releasedAt: Date | null }[];
  keys?: boolean;
  /** A protected attendance row with no approved retention rule blocks deletion. */
  protectedRows?: boolean;
}

function fakeDb(s: Scenario, fingerprint: { value?: string }) {
  const user = { id: 'u-del', email: 'del@example.test', name: 'Del', employeeId: null, isActive: false, isSystemAccount: false };
  const holds = (s.holds ?? []).map((h, i) => ({ id: `h${i}`, userId: user.id, ...h }));
  const delegate = (name: string): any => ({
    findMany: async (args: any) => {
      if (name === 'userLegalHold') {
        if (args?.where?.userId !== user.id) return []; // actor columns on other people's holds
        return args.where.OR ? holds.filter((h) => isHoldActive(h)) : holds;
      }
      if (name === 'dailyAttendance' && s.protectedRows && args?.where?.userId === user.id) return [{ id: 'd1', userId: user.id, date: new Date('2026-01-05') }];
      return [];
    },
    findFirst: async () => {
      if (name === 'operationalEvent') return { action: 'USER_ARCHIVED', timestamp: new Date('2026-06-01') };
      // A person with protected history has a full (VERIFIED) archive; without, a no-history one.
      if (name === 'userArchiveSnapshot') return { id: 'snap', status: s.protectedRows ? 'VERIFIED' : 'NO_HISTORY_VERIFIED', version: 1, environment: 'development', dataFingerprint: fingerprint.value, backupRequired: false, files: [] };
      return null;
    },
    findUnique: async () => (name === 'user' ? user : null),
    count: async () => (name === 'userLegalHold' ? holds.filter((h) => isHoldActive(h)).length : 0),
    aggregate: async () => ({ _max: {} }),
    create: async () => ({}),
    update: async () => ({}),
  });
  return new Proxy({}, { get: (_t, prop: string) => (prop === 'then' ? undefined : delegate(prop)) }) as any;
}

async function makeService(s: Scenario) {
  const fingerprint: { value?: string } = {};
  const db = fakeDb(s, fingerprint);
  fingerprint.value = dataFingerprint(await collectInventory(db, 'u-del', { systemUserId: 'system-deleted-account', operationId: null, now: new Date() }));
  const tickets: any = { planArchiveTicketChanges: async () => ({ close: [], promote: [], remove: [], unwatch: [] }) };
  const ports: LifecyclePorts = {
    env: () => (s.keys ? { LIFECYCLE_HANDLE_ENCRYPTION_KEY: KEY, LIFECYCLE_HANDLE_HMAC_KEY: KEY } : {}) as any,
    now: () => new Date('2026-10-16T05:00:00Z'),
    makeArchiveVault: () => { throw new Error('no vault in unit tests'); },
    makeFileStore: () => { throw new Error('no store in unit tests'); },
    transactionTimeoutMs: 1000,
  };
  return new UserLifecycleService(db, tickets, {} as any, ports);
}

describe('Permanent Delete preflight remediation (E2)', () => {
  it('a hold together with missing keys returns LEGAL_HOLD_ACTIVE, keys and retention listed as other blockers', async () => {
    const svc = await makeService({ holds: [{ status: 'ACTIVE', releasedAt: null }], keys: false, protectedRows: true });
    const p = await svc.deletePreflight('u-del', ADMIN);
    expect(p.allowed).toBe(false);
    expect(p.holdStatus).toBe('ACTIVE');
    expect(p.remediation?.code).toBe('LEGAL_HOLD_ACTIVE');
    expect(p.remediation?.remediationClass).toBe('SECURITY_OR_LEGAL_BLOCK');
    expect(p.remediation?.details?.otherBlockers).toEqual(['LIFECYCLE_KEYS_MISSING', 'RETENTION_POLICY_NOT_CONFIGURED']);
    expect(p.reasons.map((r) => r.code)).toEqual(['LEGAL_HOLD_ACTIVE', 'HANDLE_KEYS_MISSING', 'RETENTION_BLOCKED']);
  });

  it('a hold alone is reported as a legal hold, never as RETENTION_BLOCKED', async () => {
    const svc = await makeService({ holds: [{ status: 'ACTIVE', releasedAt: null }], keys: true });
    const p = await svc.deletePreflight('u-del', ADMIN);
    expect(p.reasons.map((r) => r.code)).toEqual(['LEGAL_HOLD_ACTIVE']);
    expect(p.remediation?.details?.otherBlockers).toBeUndefined();
  });

  it('missing keys with NO hold returns LIFECYCLE_KEYS_MISSING ahead of retention', async () => {
    const svc = await makeService({ keys: false, protectedRows: true });
    const p = await svc.deletePreflight('u-del', ADMIN);
    expect(p.holdStatus).toBeNull();
    expect(p.remediation?.code).toBe('LIFECYCLE_KEYS_MISSING');
    expect(p.remediation?.details?.otherBlockers).toEqual(['RETENTION_POLICY_NOT_CONFIGURED']);
    expect(p.remediation?.actions.map((a) => a.id)).toEqual(['RETRY_VERIFICATION', 'COPY_DIAGNOSTIC']);
  });

  it('a REQUESTED hold returns LEGAL_HOLD_REQUESTED ("Awaiting hold review")', async () => {
    const svc = await makeService({ holds: [{ status: 'REQUESTED', releasedAt: null }], keys: true });
    const p = await svc.deletePreflight('u-del', ADMIN);
    expect(p.holdStatus).toBe('REQUESTED');
    expect(p.remediation?.code).toBe('LEGAL_HOLD_REQUESTED');
    expect(p.remediation?.title).toBe('Awaiting hold review');
  });

  it('a legacy unreleased hold blocks exactly like an active one', async () => {
    const svc = await makeService({ holds: [{ status: null, releasedAt: null }], keys: true });
    const p = await svc.deletePreflight('u-del', ADMIN);
    expect(p.holdStatus).toBe('LEGACY_ACTIVE');
    expect(p.remediation?.code).toBe('LEGAL_HOLD_ACTIVE');
  });

  it('rejected, withdrawn and released holds do not block', async () => {
    const svc = await makeService({ holds: [{ status: 'REJECTED', releasedAt: null }, { status: 'WITHDRAWN', releasedAt: null }, { status: 'RELEASED', releasedAt: new Date() }], keys: true });
    const p = await svc.deletePreflight('u-del', ADMIN);
    expect(p.holdStatus).toBeNull();
    expect(p.allowed).toBe(true);
    expect(p.remediation).toBeNull();
  });

  it('retention alone returns RETENTION_POLICY_NOT_CONFIGURED', async () => {
    const svc = await makeService({ keys: true, protectedRows: true });
    const p = await svc.deletePreflight('u-del', ADMIN);
    expect(p.remediation?.code).toBe('RETENTION_POLICY_NOT_CONFIGURED');
    expect(p.remediation?.retryEndpoint).toBe('PERMANENT_DELETE_PREFLIGHT');
  });

  it('every preflight remediation passes the allow-list: no denied key, no Safe Repair', async () => {
    for (const s of [{ holds: [{ status: 'ACTIVE', releasedAt: null }] }, { keys: false }, { keys: true, protectedRows: true }] as Scenario[]) {
      const p = await (await makeService(s)).deletePreflight('u-del', ADMIN);
      const json = JSON.stringify(p.remediation);
      for (const k of DENIED_KEYS) expect(json.includes(`"${k}"`)).toBe(false);
      expect(p.remediation!.actions.some((a) => a.id === 'SAFE_REPAIR')).toBe(false);
      expect(p.remediation!.affectedUserId).toBe('u-del');
    }
  });

  it('the delete POST answers a blocked preflight with a RemediationException body', async () => {
    const svc = await makeService({ holds: [{ status: 'ACTIVE', releasedAt: null }], keys: false });
    let body: any = null;
    try {
      await svc.permanentDelete('u-del', ADMIN, { idempotencyKey: '7a0f8a52-1f0c-4b8e-9a3e-1f0c4b8e9a3e', confirmation: 'del@example.test' });
    } catch (err: any) {
      body = err.getResponse?.();
      expect(err.getStatus()).toBe(409);
    }
    expect(body).toMatchObject({ error: 'REMEDIATION', code: 'LEGAL_HOLD_ACTIVE', reasonCode: 'LEGAL_HOLD_ACTIVE' });
    expect(body.remediation.details.otherBlockers).toEqual(['LIFECYCLE_KEYS_MISSING']);
    expect(body.reasons.map((r: any) => r.code)).toEqual(['LEGAL_HOLD_ACTIVE', 'HANDLE_KEYS_MISSING']);
  });
});
