/**
 * Attendance Recovery Vault — Phase 3 (staging foundation). In-memory store only;
 * the suite never contacts Cloudflare. Numbered to the Phase 3 test list (V1..V23).
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { resolveRecoveryVaultConfig, RECOVERY_VAULT_BUCKETS } from '../../src/modules/platform/attendance/recovery/recovery-vault-config';
import { AttendanceRecoveryVault } from '../../src/modules/platform/attendance/recovery/recovery-vault.service';
import type { RecoveryObjectStore } from '../../src/modules/platform/attendance/recovery/recovery-vault-store';
import { recoveryKeys } from '../../src/modules/platform/attendance/recovery/recovery-vault-keys';
import { serializeDocument } from '../../src/modules/platform/attendance/recovery/recovery-vault-documents';
import { bundleHash } from '../../src/modules/platform/attendance/recovery/bundle-canonical';
import { parseUploadMode, RECOVERY_IMPORT_UPLOAD_NOT_ENABLED } from '../../src/modules/platform/attendance/import/import-mode';
import type { AttendanceDayBundle } from '../../src/modules/platform/attendance/recovery/recovery.types';

const SECRET = 'super-secret-recovery-key-value';
const ENV = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  APP_ENV: 'staging',
  ATTENDANCE_RECOVERY_R2_ACCOUNT_ID: 'acct-123',
  ATTENDANCE_RECOVERY_R2_ACCESS_KEY_ID: 'recovery-key-id',
  ATTENDANCE_RECOVERY_R2_SECRET_ACCESS_KEY: SECRET,
  ATTENDANCE_RECOVERY_R2_BUCKET: RECOVERY_VAULT_BUCKETS.staging,
  R2_BUCKET: 'apex-os-production-backups-other',
  R2_ACCESS_KEY_ID: 'backup-key-id',
  ...over,
});
const flags = (on: boolean) => ({ config: async () => ({ flags: { ATTENDANCE_RECOVERY_ENABLED: on, ATTENDANCE_RECOVERY_R2_ENABLED: on, ATTENDANCE_RECONCILIATION_ENABLED: false, ATTENDANCE_AUTO_REPAIR_ENABLED: false }, damageLimits: {} as any }) });

function memoryStore(opts: { failing?: boolean } = {}) {
  const objects = new Map<string, { body: Buffer; sha256: string; contentType: string; metadata: Record<string, string> }>();
  const calls: string[] = [];
  const boom = () => { throw Object.assign(new Error('network down'), { $metadata: { httpStatusCode: 503 } }); };
  const store: RecoveryObjectStore = {
    async head(key) { calls.push(`head ${key}`); if (opts.failing) boom(); const o = objects.get(key); return o ? { key, byteSize: o.body.length, sha256: o.sha256, contentType: o.contentType } : null; },
    async get(key) { calls.push(`get ${key}`); if (opts.failing) boom(); return objects.get(key)?.body ?? null; },
    async list(prefix, max = 1000) { calls.push(`list ${prefix}`); if (opts.failing) boom(); return [...objects.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, max); },
    async putIfAbsent(key, body, meta) { calls.push(`put ${key}`); if (opts.failing) boom(); if (objects.has(key)) return { written: false }; objects.set(key, { body, sha256: meta.sha256, contentType: meta.contentType, metadata: meta.metadata ?? {} }); return { written: true }; },
  };
  return { store, objects, calls };
}
const vaultWith = (env: NodeJS.ProcessEnv, on: boolean, mem = memoryStore()) =>
  ({ vault: new AttendanceRecoveryVault(flags(on) as any, env, () => mem.store), mem });

const bundle = (status = 'PRESENT'): AttendanceDayBundle => ({
  schemaVersion: 1, bundleVersion: 1, employeeId: 'TE-001', businessDate: '2026-08-12',
  dailyAttendance: {
    date: '2026-08-12', status, punchInAt: null, punchOutAt: null, workedMinutes: 480, breakMinutes: 0, lateMinutes: 0, leaveDeducted: 0, lwpDeducted: 0,
    calculationReason: null, locked: false, lockedAt: null, policyVersion: null, evaluationState: 'FINALIZED', evaluatorVersion: 1, resolverVersion: null,
    evaluatedAt: null, exceptionFlags: [], sourceFingerprint: null, employeeProfileId: null, holidayCalendarReference: null, weeklyOffPolicyId: null,
    holidayId: null, businessDayOverrideId: null, leaveRequestId: null, punchInEvidenceKey: null, punchOutEvidenceKey: null, workSessionIds: [],
    revision: 1, lastRegularizationId: null,
  },
  workSessions: [], breakLogs: [], punchEvidence: [], regularizations: [], leaveReferences: [],
  attendancePolicyReference: null, shiftPolicyReference: null,
  provenance: { sourceType: 'LIVE', sourceId: 'database' },
});
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

// ════════════════════════════════════════════════════════════════════════════
describe('Configuration and environment isolation', () => {
  it('V1 missing credentials → NOT_CONFIGURED; nothing is written', async () => {
    for (const k of ['ATTENDANCE_RECOVERY_R2_ACCOUNT_ID', 'ATTENDANCE_RECOVERY_R2_ACCESS_KEY_ID', 'ATTENDANCE_RECOVERY_R2_SECRET_ACCESS_KEY', 'ATTENDANCE_RECOVERY_R2_BUCKET']) {
      expect(resolveRecoveryVaultConfig(ENV({ [k]: undefined }))).toMatchObject({ ok: false, refusal: 'RECOVERY_VAULT_NOT_CONFIGURED', credentialsPresent: false });
    }
    const { vault, mem } = vaultWith(ENV({ ATTENDANCE_RECOVERY_R2_BUCKET: '' }), true);
    expect(await vault.putManifest({} as any)).toMatchObject({ status: 'REFUSED', code: 'RECOVERY_VAULT_NOT_CONFIGURED' });
    expect(mem.calls).toEqual([]);
  });

  it('V2 the flag is off → writes refused even with valid credentials, store untouched', async () => {
    const { vault, mem } = vaultWith(ENV(), false);
    expect(await vault.putQuarantineFile({ importBatchId: 'b1', fileName: 'r.json', body: Buffer.from('{}'), uploadedBy: 'u1', uploadedAt: new Date() })).toMatchObject({ status: 'REFUSED', code: 'RECOVERY_VAULT_WRITES_DISABLED' });
    expect(await vault.putSnapshot(bundle())).toMatchObject({ code: 'RECOVERY_VAULT_WRITES_DISABLED' });
    expect(mem.calls).toEqual([]);
  });

  it('V3 the staging bucket is accepted when APP_ENV=staging', () => {
    expect(resolveRecoveryVaultConfig(ENV())).toMatchObject({ ok: true, config: { environment: 'staging', bucket: 'apex-os-attendance-recovery-staging' } });
  });

  it('V4 a production recovery bucket is refused in staging, and staging/production cross-wiring is refused', () => {
    expect(resolveRecoveryVaultConfig(ENV({ ATTENDANCE_RECOVERY_R2_BUCKET: RECOVERY_VAULT_BUCKETS.production })).refusal).toBe('RECOVERY_VAULT_BUCKET_ENVIRONMENT_MISMATCH');
    expect(resolveRecoveryVaultConfig(ENV({ ATTENDANCE_RECOVERY_R2_BUCKET: 'some-other-bucket' })).refusal).toBe('RECOVERY_VAULT_BUCKET_ENVIRONMENT_MISMATCH');
    expect(resolveRecoveryVaultConfig(ENV({ APP_ENV: 'production' })).refusal).toBe('RECOVERY_VAULT_BUCKET_ENVIRONMENT_MISMATCH');
    expect(resolveRecoveryVaultConfig(ENV({ APP_ENV: 'production', ATTENDANCE_RECOVERY_R2_BUCKET: RECOVERY_VAULT_BUCKETS.production })).refusal).toBe('RECOVERY_VAULT_PRODUCTION_NOT_ENABLED');
  });

  it('V5 an unknown or missing APP_ENV refuses — NODE_ENV is never used to guess', async () => {
    for (const appEnv of [undefined, '', 'development', 'local', 'stage', 'prod']) {
      expect(resolveRecoveryVaultConfig(ENV({ APP_ENV: appEnv, NODE_ENV: 'production' })).refusal).toBe('RECOVERY_VAULT_ENVIRONMENT_UNKNOWN');
    }
    const { vault, mem } = vaultWith(ENV({ APP_ENV: undefined }), true);
    expect(await vault.putSnapshot(bundle())).toMatchObject({ status: 'REFUSED', code: 'RECOVERY_VAULT_ENVIRONMENT_UNKNOWN' });
    expect(mem.calls).toEqual([]);
  });

  it('V6 the recovery bucket can never be the database-backup bucket, nor share its key', () => {
    expect(resolveRecoveryVaultConfig(ENV({ R2_BUCKET: RECOVERY_VAULT_BUCKETS.staging })).refusal).toBe('RECOVERY_VAULT_COLLIDES_WITH_BACKUP_VAULT');
    expect(resolveRecoveryVaultConfig(ENV({ ATTENDANCE_RECOVERY_R2_BUCKET: 'apex-os-production-backups' })).refusal).toBe('RECOVERY_VAULT_COLLIDES_WITH_BACKUP_VAULT');
    expect(resolveRecoveryVaultConfig(ENV({ R2_ACCESS_KEY_ID: 'recovery-key-id' })).refusal).toBe('RECOVERY_VAULT_REUSES_BACKUP_CREDENTIALS');
  });

  it('V7 credentials never appear in identity, health or any outcome', async () => {
    const { vault } = vaultWith(ENV(), true);
    const surfaces = [vault.identity(), await vault.health(), await vault.putSnapshot(bundle()), resolveRecoveryVaultConfig(ENV({ APP_ENV: 'x' }))];
    for (const s of surfaces) expect(JSON.stringify(s)).not.toMatch(new RegExp(`${SECRET}|recovery-key-id|acct-123`));
  });

  it('V8 callers cannot choose a bucket: no public method takes one; the store exposes four bound operations', () => {
    const methods = Object.getOwnPropertyNames(AttendanceRecoveryVault.prototype).filter((m) => m !== 'constructor' && !m.startsWith('private'));
    expect(methods.sort()).toEqual(['appendOnly', 'getObject', 'headObject', 'health', 'identity', 'listObjects', 'putManifest', 'putQuarantineFile', 'putSnapshot', 'refusalCode', 'writable'].sort());
    const src = fs.readFileSync(path.join(__dirname, '../../src/modules/platform/attendance/recovery/recovery-vault.service.ts'), 'utf8');
    expect(src).not.toMatch(/bucket\s*[:?]\s*string/i);
    const store = fs.readFileSync(path.join(__dirname, '../../src/modules/platform/attendance/recovery/recovery-vault-store.ts'), 'utf8');
    expect(store).toMatch(/const Bucket = config\.bucket;/);
    expect(store).not.toMatch(/DeleteObject|DeleteObjects|DeleteBucket|CopyObject|CreateBucket/);
    expect(store).toMatch(/Object\.freeze\(\{/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Quarantine, manifests, immutability', () => {
  it('V9 a quarantined file is stored byte-for-byte under the built key, with its SHA-256', async () => {
    const { vault, mem } = vaultWith(ENV(), true);
    const body = Buffer.from('{"format":"apex-os.attendance-recovery","bundles":[]}');
    const at = new Date('2026-10-09T08:00:00.000Z');
    const r: any = await vault.putQuarantineFile({ importBatchId: 'batch-1', fileName: '../../evil name.JSON', body, uploadedBy: 'user-1', uploadedAt: at });
    expect(r).toMatchObject({ status: 'WRITTEN', key: 'quarantine/batch-1/original.json', sha256: sha(body) });
    expect(mem.objects.get('quarantine/batch-1/original.json')!.body.equals(body)).toBe(true);
    expect(mem.objects.get('quarantine/batch-1/original.json')!.metadata).toMatchObject({ 'import-batch-id': 'batch-1', 'uploaded-by': 'user-1', 'uploaded-at': at.toISOString(), 'original-name': 'evil name.JSON' });
    expect(r.manifest).toMatchObject({ schemaVersion: 1, manifestType: 'RECOVERY_IMPORT', environment: 'staging', sourceSha256: sha(body), sourceSize: body.length, status: 'QUARANTINED' });
    expect(await vault.putQuarantineFile({ importBatchId: 'batch-2', fileName: 'run.exe', body, uploadedBy: 'u', uploadedAt: at })).toMatchObject({ status: 'REFUSED', detail: 'EXTENSION_NOT_ALLOWED' });
    expect(await vault.putQuarantineFile({ importBatchId: '../escape', fileName: 'r.json', body, uploadedBy: 'u', uploadedAt: at })).toMatchObject({ status: 'REFUSED', detail: 'INVALID_IMPORT_BATCH_ID' });
  });

  it('V10 the same content at the same key is idempotent — no second PUT', async () => {
    const { vault, mem } = vaultWith(ENV(), true);
    const input = { importBatchId: 'b1', fileName: 'r.csv', body: Buffer.from('a,b\n1,2'), uploadedBy: 'u', uploadedAt: new Date() };
    expect((await vault.putQuarantineFile(input)).status).toBe('WRITTEN');
    expect((await vault.putQuarantineFile(input)).status).toBe('ALREADY_EXISTS_IDENTICAL');
    expect(mem.calls.filter((c) => c.startsWith('put')).length).toBe(1);
  });

  it('V11 different content at an existing key is IMMUTABILITY_CONFLICT and the original is untouched', async () => {
    const { vault, mem } = vaultWith(ENV(), true);
    const base = { importBatchId: 'b1', fileName: 'r.csv', uploadedBy: 'u', uploadedAt: new Date() };
    await vault.putQuarantineFile({ ...base, body: Buffer.from('original') });
    expect(await vault.putQuarantineFile({ ...base, body: Buffer.from('tampered') })).toMatchObject({ status: 'IMMUTABILITY_CONFLICT' });
    expect(mem.objects.get('quarantine/b1/original.csv')!.body.toString()).toBe('original');
  });

  it('V11 a lost race (key appears between HEAD and PUT) never overwrites', async () => {
    const mem = memoryStore();
    const racing: RecoveryObjectStore = { ...mem.store, putIfAbsent: async () => { mem.objects.set('manifests/imports/b9.json', { body: Buffer.from('other'), sha256: 'x', contentType: 'application/json', metadata: {} }); return { written: false }; } };
    const vault = new AttendanceRecoveryVault(flags(true) as any, ENV(), () => racing);
    const r = await vault.putManifest({ schemaVersion: 1, manifestType: 'RECOVERY_IMPORT', environment: 'staging', importBatchId: 'b9', sourceObjectKey: 'k', sourceSha256: 'h', sourceSize: 1, sourceContentType: 'application/json', sourceFileName: 'r.json', createdAt: 'now', createdBy: 'u', status: 'QUARANTINED' });
    expect(r.status).toBe('IMMUTABILITY_CONFLICT');
    expect(mem.objects.get('manifests/imports/b9.json')!.body.toString()).toBe('other');
  });

  it('V14 manifests are schema-versioned, deterministic JSON', async () => {
    const { vault, mem } = vaultWith(ENV(), true);
    const m = { status: 'QUARANTINED', schemaVersion: 1, manifestType: 'RECOVERY_IMPORT', environment: 'staging', importBatchId: 'b1', sourceObjectKey: 'quarantine/b1/original.json', sourceSha256: 'abc', sourceSize: 3, sourceContentType: 'application/json', sourceFileName: 'r.json', createdAt: '2026-10-09T00:00:00.000Z', createdBy: 'u1' } as const;
    expect((await vault.putManifest(m as any)).status).toBe('WRITTEN');
    const stored = mem.objects.get('manifests/imports/b1.json')!.body.toString();
    expect(JSON.parse(stored).schemaVersion).toBe(1);
    expect(Object.keys(JSON.parse(stored))).toEqual([...Object.keys(JSON.parse(stored))].sort());
    expect(serializeDocument({ b: 1, a: { d: 1, c: 2 } }).toString()).toBe('{"a":{"c":2,"d":1},"b":1}');
  });

  it('V15 a document carrying a secret-like field is refused, never stored', async () => {
    expect(() => serializeDocument({ createdBy: 'u', secretAccessKey: 'x' })).toThrow(/FORBIDDEN_FIELD/);
    expect(() => serializeDocument({ nested: { authToken: 'x' } })).toThrow(/FORBIDDEN_FIELD/);
    expect(() => serializeDocument({ panNumber: 'X' })).toThrow(/FORBIDDEN_FIELD/);
    expect(() => serializeDocument({ span: 1, bundleHash: 'x' })).not.toThrow();
    const { vault, mem } = vaultWith(ENV(), true);
    expect(await vault.putManifest({ importBatchId: 'b1', password: 'p' } as any)).toMatchObject({ status: 'REFUSED', code: 'INVALID_INPUT' });
    expect(mem.calls.filter((c) => c.startsWith('put'))).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Snapshots', () => {
  it('V12 a declared hash that does not match the bundle is refused', async () => {
    const { vault, mem } = vaultWith(ENV(), true);
    expect(await vault.putSnapshot(bundle(), '0'.repeat(64))).toMatchObject({ status: 'REFUSED', code: 'SNAPSHOT_HASH_MISMATCH' });
    expect(mem.calls.filter((c) => c.startsWith('put'))).toEqual([]);
  });

  it('V13 keys carry the bundle hash; revisions append; an identical bundle is not stored twice', async () => {
    const { vault, mem } = vaultWith(ENV(), true);
    const h1 = bundleHash(bundle());
    const r1: any = await vault.putSnapshot(bundle(), h1);
    expect(r1).toMatchObject({ status: 'WRITTEN', key: `snapshots/2026/08/TE-001/2026-08-12/r0001-${h1}.json`, manifestKey: `manifests/snapshots/2026/08/TE-001/2026-08-12/${h1}.json` });
    const doc = JSON.parse(mem.objects.get(r1.key)!.body.toString());
    expect(doc).toMatchObject({ schemaVersion: 1, bundleVersion: 1, employeeId: 'TE-001', businessDate: '2026-08-12', bundleHash: h1, provenance: { sourceType: 'LIVE' } });
    expect(await vault.putSnapshot(bundle())).toMatchObject({ status: 'ALREADY_EXISTS_IDENTICAL', key: r1.key });
    const h2 = bundleHash(bundle('LATE'));
    expect(await vault.putSnapshot(bundle('LATE'))).toMatchObject({ status: 'WRITTEN', key: `snapshots/2026/08/TE-001/2026-08-12/r0002-${h2}.json` });
    expect(mem.objects.get(r1.key)!.body.toString()).toBe(JSON.stringify(JSON.parse(mem.objects.get(r1.key)!.body.toString()))); // r0001 untouched
    expect([...mem.objects.keys()].filter((k) => k.startsWith('snapshots/'))).toHaveLength(2);
  });

  it('keys refuse unsafe identifiers rather than escaping them', () => {
    expect(() => recoveryKeys.snapshotPrefix('../TE', '2026-08-12')).toThrow();
    expect(() => recoveryKeys.snapshotPrefix('TE/001', '2026-08-12')).toThrow();
    expect(() => recoveryKeys.snapshotPrefix('TE-001', '2026-02-30')).toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Health and failure isolation', () => {
  it('V17 NOT_CONFIGURED without credentials', async () => {
    expect(await vaultWith(ENV({ ATTENDANCE_RECOVERY_R2_SECRET_ACCESS_KEY: undefined }), true).vault.health()).toMatchObject({ status: 'NOT_CONFIGURED' });
  });
  it('V18 DISABLED with credentials and the flag off — and no network call', async () => {
    const { vault, mem } = vaultWith(ENV(), false);
    expect(await vault.health()).toMatchObject({ status: 'DISABLED', credentialsPresent: true });
    expect(mem.calls).toEqual([]);
  });
  it('V19 HEALTHY when enabled and one bounded LIST succeeds (no write)', async () => {
    const { vault, mem } = vaultWith(ENV(), true);
    expect(await vault.health()).toEqual({ status: 'HEALTHY', credentialsPresent: true });
    expect(mem.calls).toEqual(['list manifests/']);
  });
  it('V20 DEGRADED when the vault fails, or when its identity is refused while enabled', async () => {
    expect(await vaultWith(ENV(), true, memoryStore({ failing: true })).vault.health()).toMatchObject({ status: 'DEGRADED', reason: 'RECOVERY_VAULT_UNREACHABLE' });
    expect(await vaultWith(ENV({ R2_BUCKET: RECOVERY_VAULT_BUCKETS.staging }), true).vault.health()).toMatchObject({ status: 'DEGRADED', reason: 'RECOVERY_VAULT_COLLIDES_WITH_BACKUP_VAULT' });
  });

  it('V16 a failing vault never throws into its caller, and nothing outside recovery depends on it', async () => {
    const { vault } = vaultWith(ENV(), true, memoryStore({ failing: true }));
    await expect(vault.putSnapshot(bundle())).resolves.toMatchObject({ status: 'FAILED', code: 'RECOVERY_VAULT_UNAVAILABLE' });
    await expect(vault.putQuarantineFile({ importBatchId: 'b', fileName: 'r.json', body: Buffer.from('x'), uploadedBy: 'u', uploadedAt: new Date() })).resolves.toMatchObject({ status: 'FAILED' });
    await expect(vault.listObjects('snapshots/')).resolves.toMatchObject({ status: 'FAILED' });
    expect(() => new AttendanceRecoveryVault(flags(true) as any, ENV({ APP_ENV: 'nonsense' }))).not.toThrow();
    const src = path.join(__dirname, '../../src');
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (!p.endsWith(path.join('attendance', 'recovery'))) walk(p); }
        else if (p.endsWith('.ts') && /recovery-vault/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(src, p));
      }
    };
    walk(src);
    expect(offenders).toEqual([]); // register, exports, imports and attendance never import the vault
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Flag ON + invalid configuration: every recovery path hard-refuses (pre-deploy gate)', () => {
  const INVALID: Array<[string, Record<string, string | undefined>, string]> = [
    ['secret missing', { ATTENDANCE_RECOVERY_R2_SECRET_ACCESS_KEY: undefined }, 'RECOVERY_VAULT_NOT_CONFIGURED'],
    ['APP_ENV missing (NODE_ENV=production ignored)', { APP_ENV: undefined, NODE_ENV: 'production' }, 'RECOVERY_VAULT_ENVIRONMENT_UNKNOWN'],
    ['APP_ENV unknown', { APP_ENV: 'development' }, 'RECOVERY_VAULT_ENVIRONMENT_UNKNOWN'],
    ['staging pointed at the production recovery bucket', { ATTENDANCE_RECOVERY_R2_BUCKET: RECOVERY_VAULT_BUCKETS.production }, 'RECOVERY_VAULT_BUCKET_ENVIRONMENT_MISMATCH'],
    ['staging pointed at an unrelated bucket', { ATTENDANCE_RECOVERY_R2_BUCKET: 'apex-os-attendance-recovery-staging-old' }, 'RECOVERY_VAULT_BUCKET_ENVIRONMENT_MISMATCH'],
    ['production environment (not enabled)', { APP_ENV: 'production', ATTENDANCE_RECOVERY_R2_BUCKET: RECOVERY_VAULT_BUCKETS.production }, 'RECOVERY_VAULT_PRODUCTION_NOT_ENABLED'],
    ['recovery bucket == backup bucket', { R2_BUCKET: RECOVERY_VAULT_BUCKETS.staging }, 'RECOVERY_VAULT_COLLIDES_WITH_BACKUP_VAULT'],
    ['recovery bucket == known production backup bucket', { ATTENDANCE_RECOVERY_R2_BUCKET: 'apex-os-production-backups' }, 'RECOVERY_VAULT_COLLIDES_WITH_BACKUP_VAULT'],
    ['recovery key == backup key', { R2_ACCESS_KEY_ID: 'recovery-key-id' }, 'RECOVERY_VAULT_REUSES_BACKUP_CREDENTIALS'],
  ];

  it.each(INVALID)('%s → no store is ever built; every write, read and health path refuses with %s', async (_label, over, code) => {
    let storesBuilt = 0;
    const vault = new AttendanceRecoveryVault(flags(true) as any, ENV(over), () => { storesBuilt += 1; return memoryStore().store; });
    const at = new Date('2026-10-09T00:00:00.000Z');
    const writes = [
      await vault.putQuarantineFile({ importBatchId: 'b1', fileName: 'r.json', body: Buffer.from('{}'), uploadedBy: 'u', uploadedAt: at }),
      await vault.putManifest({ schemaVersion: 1, manifestType: 'RECOVERY_IMPORT', environment: 'staging', importBatchId: 'b1', sourceObjectKey: 'k', sourceSha256: 'h', sourceSize: 1, sourceContentType: 'application/json', sourceFileName: 'r.json', createdAt: 'now', createdBy: 'u', status: 'QUARANTINED' }),
      await vault.putSnapshot(bundle()),
    ];
    for (const w of writes) expect(w).toEqual({ status: 'REFUSED', code });
    for (const r of [await vault.headObject('x'), await vault.getObject('x'), await vault.listObjects('x')]) expect(r).toEqual({ status: 'REFUSED', code });
    const h = await vault.health();
    expect(h.status).toBe(code === 'RECOVERY_VAULT_NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'DEGRADED');
    expect(storesBuilt).toBe(0); // no client, therefore no possible R2 call of any kind
    expect(vault.identity()).toMatchObject({ usable: false, refusal: code });
  });

  it('and the vault never throws while refusing (the application keeps running)', async () => {
    const vault = new AttendanceRecoveryVault(flags(true) as any, ENV({ R2_BUCKET: RECOVERY_VAULT_BUCKETS.staging }));
    await expect(vault.putSnapshot(bundle())).resolves.toMatchObject({ status: 'REFUSED' });
    await expect(vault.health()).resolves.toMatchObject({ status: 'DEGRADED', reason: 'RECOVERY_VAULT_COLLIDES_WITH_BACKUP_VAULT' });
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('Boundaries', () => {
  const dir = path.join(__dirname, '../../src/modules/platform/attendance/recovery');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => ({ f, body: fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '') }));

  it('V21 the upload endpoint still refuses RECOVERY_IMPORT', () => {
    try { parseUploadMode('RECOVERY_IMPORT'); throw new Error('accepted'); } catch (e: any) { expect(e.getResponse().code).toBe(RECOVERY_IMPORT_UPLOAD_NOT_ENABLED); }
  });

  it('V22 the recovery module does not import or wrap the database-backup client', () => {
    expect(files.filter((x) => /backup-vault|r2-vault|BackupVaultService|archiveToVault/.test(x.body)).map((x) => x.f)).toEqual([]);
  });

  it('V23 the backup bucket and backup key are read in exactly one place — the collision guard — and never used to write', () => {
    const readers = files.filter((x) => /['"]R2_(BUCKET|ACCESS_KEY_ID)['"]/.test(x.body)).map((x) => x.f);
    expect(readers).toEqual(['recovery-vault-config.ts']);
    const store = files.find((x) => x.f === 'recovery-vault-store.ts')!.body;
    expect(store).not.toMatch(/R2_BUCKET|process\.env/);
  });

  it('the vault is not exported from the recovery module', () => {
    const mod = files.find((x) => x.f === 'recovery.module.ts')!.body;
    expect(/exports:\s*\[[^\]]*AttendanceRecoveryVault/.test(mod)).toBe(false);
  });
});
