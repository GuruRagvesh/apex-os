import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import {
  ACTION_KIND,
  ACTION_ENDPOINT_ROUTES,
  ALLOWED_RETRY_ENDPOINTS,
  DELETE_BLOCKER_PRECEDENCE,
  DENIED_KEYS,
  REMEDIATION_ACTION_IDS,
  REMEDIATION_CLASSES,
  REMEDIATION_REGISTRY,
  RETRY_ENDPOINT_ROUTES,
  RemediationException,
  buildRemediation,
  isDeniedKey,
  pickByPrecedence,
  sanitizeRemediation,
  validateRegistry,
} from '../../src/common/remediation';
import { REMEDIATION_CODE_FOR_REASON, REASON } from '../../src/modules/core/users/lifecycle/lifecycle-codes';
import { UserLifecycleController } from '../../src/modules/core/users/lifecycle/user-lifecycle.controller';
import { UsersController } from '../../src/modules/core/users/users.controller';
import * as contract from '../../../shared/remediation/shared/remediation-contract';

// Phase 1 remediation contract (spec §3, §11.5, §11.6.1, errata E2/E3).

function routesOf(controller: any): { method: string; path: string }[] {
  const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '').replace(/^\/|\/$/g, '');
  const out: { method: string; path: string }[] = [];
  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    const fn = controller.prototype[name];
    if (typeof fn !== 'function' || name === 'constructor') continue;
    const sub = Reflect.getMetadata(PATH_METADATA, fn);
    const method = Reflect.getMetadata(METHOD_METADATA, fn);
    if (sub === undefined || method === undefined) continue;
    out.push({ method: RequestMethod[method], path: [base, String(sub).replace(/^\/|\/$/g, '')].filter(Boolean).join('/') });
  }
  return out;
}

describe('remediation registry', () => {
  it('is valid: Safe Repair only where the class and flags allow it, retries have endpoints', () => {
    expect(validateRegistry()).toEqual([]);
  });

  it('fails validation for a manual-external code that lists SAFE_REPAIR', () => {
    const bad = { X: { ...REMEDIATION_REGISTRY.ARCHIVE_PRIVACY_FAILED, actions: ['SAFE_REPAIR' as const] } };
    expect(validateRegistry(bad).join(' ')).toMatch(/SAFE_REPAIR/);
    const flagged = { Y: { ...REMEDIATION_REGISTRY.CLEANUP_PENDING, requiresBackendOperations: true } };
    expect(validateRegistry(flagged).join(' ')).toMatch(/SAFE_REPAIR/);
    const legal = { Z: { ...REMEDIATION_REGISTRY.CLEANUP_PENDING, remediationClass: 'SECURITY_OR_LEGAL_BLOCK' as const } };
    expect(validateRegistry(legal).join(' ')).toMatch(/SAFE_REPAIR/);
  });

  it('every retry endpoint resolves to a decorated controller route (no fake Fix buttons)', () => {
    const routes = [...routesOf(UserLifecycleController), ...routesOf(UsersController)];
    for (const e of ALLOWED_RETRY_ENDPOINTS) {
      const want = RETRY_ENDPOINT_ROUTES[e];
      expect([e, routes.some((r) => r.method === want.method && r.path === want.path)]).toEqual([e, true]);
    }
  });

  it('the new Phase 1 read endpoints exist with the specified routes', () => {
    expect(routesOf(UserLifecycleController)).toEqual(expect.arrayContaining([{ method: 'GET', path: 'user-lifecycle/operations/:operationId/attempts' }]));
    expect(routesOf(UsersController)).toEqual(expect.arrayContaining([{ method: 'GET', path: 'users/:userId/setup-issues' }]));
  });

  it('maps every Phase 1 lifecycle reason to its remediation code and class (§11.6.1, E3)', () => {
    const expected: Record<string, [string, string, string]> = {
      [REASON.ARCHIVE_VAULT_NOT_READY]: ['ARCHIVE_VAULT_NOT_READY', 'BACKEND_OPERATIONS', 'SUBSYSTEM'],
      [REASON.ARCHIVE_PRIVACY_FAILED]: ['ARCHIVE_PRIVACY_FAILED', 'MANUAL_EXTERNAL', 'OPERATION'],
      [REASON.LEGAL_HOLD_ACTIVE]: ['LEGAL_HOLD_ACTIVE', 'SECURITY_OR_LEGAL_BLOCK', 'USER'],
      [REASON.LEGAL_HOLD_REQUESTED]: ['LEGAL_HOLD_REQUESTED', 'SECURITY_OR_LEGAL_BLOCK', 'USER'],
      [REASON.HANDLE_KEYS_MISSING]: ['LIFECYCLE_KEYS_MISSING', 'BACKEND_OPERATIONS', 'SUBSYSTEM'],
      // Phase 2: only an approved, unelapsed period blocks; missing configuration is a warning.
      [REASON.RETENTION_BLOCKED]: ['RETENTION_PERIOD_ACTIVE', 'SECURITY_OR_LEGAL_BLOCK', 'USER'],
      [REASON.SNAPSHOT_MISSING]: ['ARCHIVE_SNAPSHOT_MISSING', 'SYSTEM_REPAIRABLE', 'USER'],
      [REASON.SNAPSHOT_STALE]: ['ARCHIVE_SNAPSHOT_STALE', 'SYSTEM_REPAIRABLE', 'USER'],
      [REASON.NO_HISTORY_NO_LONGER_EMPTY]: ['ARCHIVE_SNAPSHOT_STALE', 'SYSTEM_REPAIRABLE', 'USER'],
      [REASON.ARCHIVE_MISSING_OR_CHANGED]: ['ARCHIVE_SNAPSHOT_STALE', 'SYSTEM_REPAIRABLE', 'USER'],
      [REASON.OPERATION_IN_PROGRESS]: ['OPERATION_IN_PROGRESS', 'WARNING_NON_BLOCKING', 'OPERATION'],
      [REASON.CLEANUP_FAILED]: ['CLEANUP_PENDING', 'SYSTEM_REPAIRABLE', 'OPERATION'],
    };
    for (const [reason, [code, cls, scope]] of Object.entries(expected)) {
      expect(REMEDIATION_CODE_FOR_REASON[reason as keyof typeof REMEDIATION_CODE_FOR_REASON]).toBe(code);
      const r = buildRemediation(code);
      expect([code, r.remediationClass, r.blockingScope]).toEqual([code, cls, scope]);
    }
  });

  it('offers Safe Repair only for the system-repairable cleanup', () => {
    for (const code of Object.keys(REMEDIATION_REGISTRY)) {
      const has = buildRemediation(code).actions.some((a) => a.id === 'SAFE_REPAIR');
      // The backend can perform these itself: retry file cleanup, or write and
      // verify a new archive version. Drive sharing and secrets never qualify.
      expect([code, has]).toEqual([code, ['CLEANUP_PENDING', 'ARCHIVE_SNAPSHOT_MISSING', 'ARCHIVE_SNAPSHOT_STALE'].includes(code)]);
    }
  });

  it('labels the archive repair as Prepare / Rebuild Verified Archive, never as a generic repair', () => {
    expect(buildRemediation('ARCHIVE_SNAPSHOT_MISSING').actions.find((a) => a.id === 'SAFE_REPAIR')?.label).toBe('Prepare Verified Archive');
    expect(buildRemediation('ARCHIVE_SNAPSHOT_STALE').actions.find((a) => a.id === 'SAFE_REPAIR')?.label).toBe('Rebuild Verified Archive');
    expect(buildRemediation('ARCHIVE_SNAPSHOT_STALE').retryEndpoint).toBe('VERIFIED_ARCHIVE_PREPARE');
  });

  it('a Drive sharing problem offers Open Archive Folder and Retry, and no Safe Repair', () => {
    const ids = buildRemediation('ARCHIVE_PRIVACY_FAILED', { affectedUserId: 'u1' }).actions.map((a) => a.id);
    expect(ids).toEqual(['OPEN_ARCHIVE_FOLDER', 'RETRY_VERIFICATION', 'COPY_DIAGNOSTIC']);
    expect(ids).not.toContain('SAFE_REPAIR');
  });

  it('missing retention configuration is a non-blocking warning; an approved period is a blocker', () => {
    expect(buildRemediation('RETENTION_POLICY_NOT_CONFIGURED')).toEqual(expect.objectContaining({ remediationClass: 'WARNING_NON_BLOCKING', severity: 'WARNING', blockingScope: 'NONE' }));
    expect(buildRemediation('RETENTION_PERIOD_ACTIVE', { details: { retentionCategories: ['ATTENDANCE'], eligibleOn: '2027-01-31' } })).toEqual(expect.objectContaining({ severity: 'BLOCKING', details: { retentionCategories: ['ATTENDANCE'], eligibleOn: '2027-01-31' } }));
  });

  it('keeps hold above keys above retention above archive repair', () => {
    const at = (c: string) => DELETE_BLOCKER_PRECEDENCE.indexOf(c);
    expect(at('LEGAL_HOLD_REQUESTED')).toBeLessThan(at('LIFECYCLE_KEYS_MISSING'));
    expect(at('LIFECYCLE_KEYS_MISSING')).toBeLessThan(at('RETENTION_PERIOD_ACTIVE'));
    expect(at('RETENTION_PERIOD_ACTIVE')).toBeLessThan(at('ARCHIVE_SNAPSHOT_STALE'));
    expect(DELETE_BLOCKER_PRECEDENCE).not.toContain('RETENTION_POLICY_NOT_CONFIGURED');
  });

  it('every action backed by a server route resolves to a decorated controller route', () => {
    const routes = routesOf(UserLifecycleController);
    for (const [id, want] of Object.entries(ACTION_ENDPOINT_ROUTES)) {
      expect([id, routes.some((r) => r.method === want!.method && r.path === want!.path)]).toEqual([id, true]);
    }
  });
});

describe('remediation serializer', () => {
  it('copies only contract fields (output allow-list)', () => {
    const r = sanitizeRemediation({ ...buildRemediation('LEGAL_HOLD_ACTIVE'), stack: 'Error at x', sql: 'SELECT 1', prismaMeta: { target: 'x' }, providerFileId: 'abc' });
    expect(Object.keys(r).sort()).toEqual(expect.not.arrayContaining(['stack', 'sql', 'prismaMeta', 'providerFileId']));
  });

  it('keeps only the detail keys registered for the code', () => {
    const r = buildRemediation('LEGAL_HOLD_ACTIVE', { details: { otherBlockers: ['LIFECYCLE_KEYS_MISSING'], holdStatus: 'ACTIVE', archivePath: '/x/y', email: 'a@b.test' } });
    expect(r.details).toEqual({ otherBlockers: ['LIFECYCLE_KEYS_MISSING'], holdStatus: 'ACTIVE' });
  });

  it('applies the exact-name deny-list case-insensitively, never as a substring', () => {
    for (const k of DENIED_KEYS) {
      expect(isDeniedKey(k)).toBe(true);
      expect(isDeniedKey(k.toUpperCase())).toBe(true);
    }
    for (const k of ['dedupeKey', 'policyKey', 'idempotencyKey', 'actionKey', 'tokenCount', 'passwordPolicy']) expect([k, isDeniedKey(k)]).toEqual([k, false]);
  });

  it('drops a deny-listed key even when a code registers it', () => {
    const registry: any = REMEDIATION_REGISTRY;
    const saved = registry.CLEANUP_PENDING.detailKeys;
    registry.CLEANUP_PENDING.detailKeys = [...saved, 'apiKey'];
    try {
      const r = buildRemediation('CLEANUP_PENDING', { details: { apiKey: 'secret-value', pendingItems: 2 } });
      expect(r.details).toEqual({ pendingItems: 2 });
    } finally {
      registry.CLEANUP_PENDING.detailKeys = saved;
    }
  });

  it('drops a Safe Repair that violates the gate at runtime', () => {
    const forced = { ...buildRemediation('ARCHIVE_PRIVACY_FAILED'), actions: [{ id: 'SAFE_REPAIR', kind: 'SAFE_REPAIR', label: 'x' }, { id: 'COPY_DIAGNOSTIC', kind: 'COPY_DIAGNOSTIC', label: 'Copy' }] };
    expect(sanitizeRemediation(forced).actions.map((a) => a.id)).toEqual(['COPY_DIAGNOSTIC']);
  });

  it('drops unknown action ids and unknown retry endpoints', () => {
    const r = sanitizeRemediation({ ...buildRemediation('LEGAL_HOLD_ACTIVE'), actions: [{ id: 'DELETE_EVERYTHING', label: 'x' }, { id: 'RETRY_VERIFICATION', label: 'Retry' }], retryEndpoint: 'https://evil.example' });
    expect(r.actions).toEqual([]);
    expect(r.retryEndpoint).toBeUndefined();
  });

  it('no built remediation carries a denied key anywhere', () => {
    for (const code of Object.keys(REMEDIATION_REGISTRY)) {
      const json = JSON.stringify(buildRemediation(code, { details: { password: 'x', token: 'y' } }));
      for (const k of DENIED_KEYS) expect(json.includes(`"${k}"`)).toBe(false);
    }
  });

  it('serializes RemediationException as { statusCode, error: REMEDIATION, remediation }', () => {
    const ex = new RemediationException(buildRemediation('LIFECYCLE_KEYS_MISSING'), 409, 'Not configured', { reasonCode: 'HANDLE_KEYS_MISSING' });
    const body: any = ex.getResponse();
    expect(ex.getStatus()).toBe(409);
    expect(body).toMatchObject({ statusCode: 409, error: 'REMEDIATION', code: 'LIFECYCLE_KEYS_MISSING', message: 'Not configured', reasonCode: 'HANDLE_KEYS_MISSING' });
    expect(body.remediation.code).toBe('LIFECYCLE_KEYS_MISSING');
  });
});

describe('delete blocker precedence (E2)', () => {
  it('legal hold beats missing keys, which beat retention', () => {
    expect(pickByPrecedence(['RETENTION_POLICY_NOT_CONFIGURED', 'LIFECYCLE_KEYS_MISSING', 'LEGAL_HOLD_ACTIVE'])).toEqual({
      primary: 'LEGAL_HOLD_ACTIVE',
      others: ['LIFECYCLE_KEYS_MISSING', 'RETENTION_POLICY_NOT_CONFIGURED'],
    });
    expect(pickByPrecedence(['RETENTION_POLICY_NOT_CONFIGURED', 'LIFECYCLE_KEYS_MISSING'])).toEqual({ primary: 'LIFECYCLE_KEYS_MISSING', others: ['RETENTION_POLICY_NOT_CONFIGURED'] });
    expect(pickByPrecedence(['LIFECYCLE_KEYS_MISSING', 'LEGAL_HOLD_REQUESTED']).primary).toBe('LEGAL_HOLD_REQUESTED');
  });

  it('keeps unmapped blockers after the mapped ones, in their order', () => {
    expect(pickByPrecedence(['SNAPSHOT_STALE', 'RETENTION_POLICY_NOT_CONFIGURED'])).toEqual({ primary: 'RETENTION_POLICY_NOT_CONFIGURED', others: ['SNAPSHOT_STALE'] });
    expect(pickByPrecedence(['SNAPSHOT_STALE'])).toEqual({ primary: null, others: ['SNAPSHOT_STALE'] });
  });
});

describe('frontend contract mirrors the backend vocabulary', () => {
  it('has the same classes, retry endpoints and action ids/kinds', () => {
    expect([...contract.REMEDIATION_CLASSES]).toEqual([...REMEDIATION_CLASSES]);
    expect([...contract.ALLOWED_RETRY_ENDPOINTS]).toEqual([...ALLOWED_RETRY_ENDPOINTS]);
    expect([...contract.REMEDIATION_ACTION_IDS]).toEqual([...REMEDIATION_ACTION_IDS]);
    expect(contract.ACTION_KIND).toEqual(ACTION_KIND);
    expect([...contract.DENIED_DETAIL_KEYS]).toEqual([...DENIED_KEYS]);
  });

  it('every navigation and configuration action id has a fixed frontend route', () => {
    for (const id of REMEDIATION_ACTION_IDS) {
      const kind = ACTION_KIND[id];
      if (kind === 'NAVIGATE') expect([id, typeof contract.NAVIGATE_ROUTES[id]]).toEqual([id, 'function']);
      if (kind === 'OPEN_CONFIGURATION') expect([id, typeof contract.SETTINGS_ROUTES[id]]).toEqual([id, 'string']);
    }
  });

  it('the frontend shows exactly the detail keys the backend may send', () => {
    for (const [code, e] of Object.entries(REMEDIATION_REGISTRY)) {
      expect([code, [...(contract.DISPLAYABLE_DETAIL_KEYS[code] ?? [])].sort()]).toEqual([code, [...e.detailKeys].sort()]);
    }
  });

  it('visibleActions applies the Safe Repair gate, drops unknown ids and needs an allowed retry endpoint', () => {
    const base = buildRemediation('ARCHIVE_PRIVACY_FAILED') as any;
    const forced = { ...base, actions: [...base.actions, { id: 'SAFE_REPAIR', kind: 'SAFE_REPAIR', label: 'x' }, { id: 'WIPE', kind: 'NAVIGATE', label: 'x' }] };
    expect(contract.visibleActions(forced).map((a) => a.id)).toEqual(['RETRY_VERIFICATION', 'COPY_DIAGNOSTIC']);
    expect(contract.visibleActions({ ...forced, retryEndpoint: undefined }).map((a) => a.id)).toEqual(['COPY_DIAGNOSTIC']);
    const cleanup = buildRemediation('CLEANUP_PENDING', { operationId: 'op1' }) as any;
    expect(contract.visibleActions(cleanup).map((a) => a.id)).toEqual(['SAFE_REPAIR', 'COPY_DIAGNOSTIC']);
    expect(contract.visibleActions({ ...cleanup, requiresManualExternalAction: true }).map((a) => a.id)).toEqual(['COPY_DIAGNOSTIC']);
  });

  it('Copy Diagnostic copies the code and operation id only', () => {
    const r = buildRemediation('LIFECYCLE_KEYS_MISSING', { operationId: 'op-123', affectedUserId: 'user-9' }) as any;
    expect(contract.diagnosticText(r)).toBe('code: LIFECYCLE_KEYS_MISSING\noperationId: op-123');
  });

  it('isRemediationError recognises exactly the exception body the backend sends', () => {
    const body = new RemediationException(buildRemediation('LEGAL_HOLD_ACTIVE')).getResponse();
    expect(contract.isRemediationError({ ...(body as any), status: 409 })).toBe(true);
    expect(contract.isRemediationError({ code: 'X', message: 'y', status: 409 })).toBe(false);
    expect(contract.isRemediationError(null)).toBe(false);
  });

  it('leave setup labels and legacy channel muting', () => {
    expect(contract.displayLeaveSetupStatus('RESOLVED').label).toBe('Policy resolved');
    expect(contract.displayLeaveSetupStatus('POLICY_SETUP_PENDING').label).toBe('Policy setup pending');
    expect(contract.displayLeaveSetupStatus(null).label).toBe('Not assessed (legacy)');
    expect(contract.effectiveChannels({ assignedTicket: false }, 'assignedTicket')).toEqual({ popup: false, push: false, email: false });
    expect(contract.effectiveChannels({ assignedTicket: false, channels: { assignedTicket: { push: true } } }, 'assignedTicket')).toEqual({ popup: false, push: true, email: false });
  });
});

describe('the shared-remediation root barrel stays transport-free', () => {
  const ROOT = join(__dirname, '../../../shared/remediation');
  it('index.ts never re-exports the HTTP clients and no file but remediation-api imports the client', () => {
    const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code(readFileSync(join(ROOT, 'index.ts'), 'utf8'))).not.toMatch(/remediation-api/);
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
    walk(ROOT);
    for (const f of files.filter((x) => /\.(ts|tsx)$/.test(x) && !x.endsWith('remediation-api.ts'))) {
      const src = readFileSync(f, 'utf8');
      expect([f, /from ['"](axios|@apex\/shared-auth)/.test(src)]).toEqual([f, false]);
    }
  });
});

describe('Phase 2: role or department removed while a form was open (B8)', () => {
  it('offers only fixes the form can apply, never Safe Repair or role creation', () => {
    const role = buildRemediation('ROLE_NOT_FOUND_OR_REMOVED', { details: { field: 'roleId' } });
    expect(role.actions.map((a) => [a.id, a.kind])).toEqual([['CHOOSE_ANOTHER_ROLE', 'FORM_FIX'], ['COPY_DIAGNOSTIC', 'COPY_DIAGNOSTIC']]);
    const dept = buildRemediation('DEPARTMENT_NOT_FOUND_OR_REMOVED', { details: { field: 'departmentId' } });
    expect(dept.actions.map((a) => a.id)).toEqual(['CHOOSE_ANOTHER_DEPARTMENT', 'CONTINUE_WITHOUT_DEPARTMENT', 'OPEN_DEPARTMENTS', 'COPY_DIAGNOSTIC']);
    for (const r of [role, dept]) {
      expect(r.actions.map((a) => a.id)).not.toContain('SAFE_REPAIR');
      expect(r).toEqual(expect.objectContaining({ remediationClass: 'ADMIN_FIXABLE_FRONTEND', blockingScope: 'OPERATION', details: expect.any(Object) }));
    }
  });

  it('the frontend shows the new actions, opens Departments in a new tab and routes FORM_FIX to the form', async () => {
    const dept = buildRemediation('DEPARTMENT_NOT_FOUND_OR_REMOVED', { details: { field: 'departmentId' } }) as any;
    expect(contract.visibleActions(dept).map((a: any) => a.id)).toEqual(['CHOOSE_ANOTHER_DEPARTMENT', 'CONTINUE_WITHOUT_DEPARTMENT', 'OPEN_DEPARTMENTS', 'COPY_DIAGNOSTIC']);
    expect(contract.NAVIGATE_ROUTES.OPEN_DEPARTMENTS?.(dept)).toBe('/departments');
    expect(contract.NEW_TAB_NAVIGATION).toContain('OPEN_DEPARTMENTS');
    expect(contract.displayableDetails(dept)).toEqual([['field', 'departmentId']]);

    const fixed: string[] = [];
    const runner = jest.fn(async () => undefined);
    const run = contract.withFormFixes(runner, { CONTINUE_WITHOUT_DEPARTMENT: () => { fixed.push('continue'); } });
    await run(dept.actions.find((a: any) => a.id === 'CONTINUE_WITHOUT_DEPARTMENT'), dept);
    expect(fixed).toEqual(['continue']);
    expect(runner).not.toHaveBeenCalled();
    await run(dept.actions.find((a: any) => a.id === 'COPY_DIAGNOSTIC'), dept);
    expect(runner).toHaveBeenCalledTimes(1);
  });
});
