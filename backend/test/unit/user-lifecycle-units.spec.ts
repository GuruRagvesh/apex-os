import { randomBytes } from 'crypto';
import { evaluateRetention } from '../../src/modules/core/users/lifecycle/retention';
import { decryptHandle, encryptHandle, handleHmac, handleKeyConfigurationIssues, readHandleKeys } from '../../src/modules/core/users/lifecycle/handle-crypto';
import { archiveFileName, canonicalRef, collectFileObjects } from '../../src/modules/core/users/lifecycle/archive-files';
import { buildArchiveWorkbook, EXCEL_MAX_CELL_CHARS, readFilesSheet, sheetRowsFor } from '../../src/modules/core/users/lifecycle/archive-workbook';
import { classifyNoHistory, dataFingerprint, Inventory } from '../../src/modules/core/users/lifecycle/dependency-inventory';
import { HANDLERS } from '../../src/modules/core/users/lifecycle/dependency-matrix';
import { opaqueId } from '../../src/modules/core/users/lifecycle/lifecycle-codes';
import { excludeSystemAccounts } from '../../src/prisma/prisma.service';

const NOW = new Date('2026-10-13T00:00:00Z');

function inventory(over: Partial<Record<string, any[]>> = {}, user: Record<string, unknown> = {}): Inventory {
  const rows: Record<string, any[]> = {};
  for (const h of HANDLERS) rows[h.key] = over[h.key] ?? [];
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(rows)) counts[k] = v.length;
  return {
    subject: { id: 'u1', email: 'a@example.test', employeeId: 'E1' },
    user: { id: 'u1', email: 'a@example.test', name: 'Alice', isActive: false, ...user },
    rows,
    screenshots: [],
    counts,
  };
}

describe('retention and legal-hold gate', () => {
  const att = { ATTENDANCE: [new Date('2026-09-01T00:00:00Z')] };
  const rule = (over: any = {}) => ({ category: 'ATTENDANCE', retentionMonths: 12, active: true, approvedAt: NOW, ...over });

  it('has no hold when there are no protected rows and no legal hold', () => {
    expect(evaluateRetention({ protectedDates: {}, rules: [], activeLegalHolds: 0, now: NOW }).result).toBe('NO_HOLD');
  });
  it('reports POLICY_NOT_CONFIGURED without treating missing setup as a retention instruction', () => {
    const r = evaluateRetention({ protectedDates: att, rules: [], activeLegalHolds: 0, now: NOW });
    expect(r).toEqual(expect.objectContaining({ result: 'RETENTION_APPROVED_FOR_DELETION', allowsDeletion: true }));
    expect(r.categories.ATTENDANCE.reason).toBe('POLICY_NOT_CONFIGURED');
  });
  it.each([
    ['NULL months', { retentionMonths: null }],
    ['zero months', { retentionMonths: 0 }],
    ['an inactive rule', { active: false }],
    ['an unapproved rule', { approvedAt: null }],
  ])('treats %s as POLICY_NOT_CONFIGURED, never zero', (_l, over) => {
    expect(evaluateRetention({ protectedDates: att, rules: [rule(over)], activeLegalHolds: 0, now: NOW }).categories.ATTENDANCE.reason).toBe('POLICY_NOT_CONFIGURED');
  });
  it('holds until the approved period has passed, then approves', () => {
    expect(evaluateRetention({ protectedDates: att, rules: [rule()], activeLegalHolds: 0, now: NOW }).categories.ATTENDANCE.reason).toBe('PERIOD_NOT_ELAPSED');
    const later = evaluateRetention({ protectedDates: att, rules: [rule()], activeLegalHolds: 0, now: new Date('2027-09-02T00:00:00Z') });
    expect(later).toEqual(expect.objectContaining({ result: 'RETENTION_APPROVED_FOR_DELETION', allowsDeletion: true }));
  });
  it('a legal hold wins over everything', () => {
    expect(evaluateRetention({ protectedDates: {}, rules: [], activeLegalHolds: 1, now: NOW })).toEqual(expect.objectContaining({ result: 'LEGAL_HOLD', allowsDeletion: false }));
  });
});

describe('cleanup handle encryption', () => {
  const env = { LIFECYCLE_HANDLE_ENCRYPTION_KEY: randomBytes(32).toString('base64'), LIFECYCLE_HANDLE_HMAC_KEY: randomBytes(32).toString('base64') };

  it('needs both 32-byte keys', () => {
    expect(readHandleKeys({})).toBeNull();
    expect(readHandleKeys({ ...env, LIFECYCLE_HANDLE_HMAC_KEY: 'short' })).toBeNull();
    expect(readHandleKeys({ ...env, LIFECYCLE_HANDLE_HMAC_KEY: env.LIFECYCLE_HANDLE_ENCRYPTION_KEY })).toBeNull();
    expect(handleKeyConfigurationIssues({})).toEqual(['LIFECYCLE_HANDLE_ENCRYPTION_KEY', 'LIFECYCLE_HANDLE_HMAC_KEY']);
    expect(handleKeyConfigurationIssues({ ...env, LIFECYCLE_HANDLE_HMAC_KEY: env.LIFECYCLE_HANDLE_ENCRYPTION_KEY })).toEqual(['LIFECYCLE_HANDLE_KEYS_MUST_DIFFER']);
    expect(readHandleKeys(env)).not.toBeNull();
  });
  it('round-trips, never stores the handle in the clear, and uses a keyed HMAC', () => {
    const keys = readHandleKeys(env)!;
    const handle = 'cloudinary:authenticated:image:apex%2Falice-rao-passport:jpg';
    const sealed = encryptHandle(keys, handle);
    expect(sealed).not.toContain('alice');
    expect(decryptHandle(keys, sealed)).toBe(handle);
    const other = readHandleKeys({ ...env, LIFECYCLE_HANDLE_HMAC_KEY: randomBytes(32).toString('base64') })!;
    expect(handleHmac(keys, 'cloudinary', handle)).not.toBe(handleHmac(other, 'cloudinary', handle));
    expect(handleHmac(keys, 'cloudinary', handle)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('external file inventory', () => {
  it('canonicalizes each stored format', () => {
    expect(canonicalRef('cloudinary:authenticated:image:a%2Fb:jpg')?.provider).toBe('cloudinary');
    expect(canonicalRef('local-private:0f-1.jpg:image%2Fjpeg')?.provider).toBe('local-private');
    expect(canonicalRef(`data:image/png;base64,${Buffer.from('x').toString('base64')}`)?.provider).toBe('inline');
    expect(canonicalRef('https://res.cloudinary.com/mycloud/image/upload/v1/folder/pic.png', 'mycloud')?.ref).toBe('cloudinary:upload:image:folder%2Fpic:png');
    expect(canonicalRef('https://elsewhere.example/pic.png', 'mycloud')?.provider).toBe('external-url');
    expect(canonicalRef('')).toBeNull();
  });
  it('copies one object once with every source, and always marks attachments shared', () => {
    const ref = 'cloudinary:authenticated:image:apex%2Fp1:jpg';
    const inv = inventory({
      'AttendancePunchPhoto.userId': [{ id: 'ph1', objectKey: ref }],
      'AttendancePunchEvidence.userId': [{ id: 'ev1', photoObjectKey: ref }],
      'Attachment.uploadedById': [{ id: 'at1', url: 'cloudinary:authenticated:raw:apex%2Fdoc:pdf' }],
    });
    const files = collectFileObjects(inv);
    const photo = files.find((f) => f.ref === ref)!;
    expect(photo.sources.map((s) => s.column).sort()).toEqual(['AttendancePunchEvidence.photoObjectKey', 'AttendancePunchPhoto.objectKey']);
    expect(photo.shared).toBe(false);
    expect(files.find((f) => f.sources[0].column === 'Attachment.url')!.shared).toBe(true);
  });
  it('names archive files without anything about the person', () => {
    expect(archiveFileName(7, 'ab'.repeat(32), 'image/jpeg')).toBe('0007-abababababab.jpg');
  });
});

describe('archive-v2 workbook', () => {
  it('writes every inventory row (no caps) and a Manifest and Files sheet that read back', async () => {
    const comments = Array.from({ length: 1200 }, (_, i) => ({ id: `c${i}`, content: `comment ${i}`, authorId: 'u1', createdAt: NOW }));
    const inv = inventory({ 'Comment.authorId': comments });
    const groups = sheetRowsFor(inv);
    expect(groups['Comments']).toHaveLength(1200);
    const built = await buildArchiveWorkbook(inv, [{ seq: 1, archiveFileName: '0001-aa.jpg', provider: 'cloudinary', shared: false, cleanupEligible: true, sizeBytes: 3, sha256: 'aa', mimeType: 'image/jpeg', ref: 'cloudinary:x', sources: [{ column: 'User.avatar', rowId: 'u1' }] }], {
      archiveRef: opaqueId(), version: 1, environment: 'staging', operationId: opaqueId(), classificationVersion: 'no-history-v1', noHistory: false, dataFingerprint: 'f'.repeat(64), generatedAt: NOW,
    });
    expect(built.sheetRows['Comments']).toBe(1200);
    // Every matrix row lands in the workbook: sheet totals equal the inventory.
    const inventoryTotal = Object.values(inv.counts).reduce((a, b) => a + b, 0);
    const sheetTotal = Object.entries(built.sheetRows).filter(([n]) => !['User Profile', 'Files', 'Correction Screenshots'].includes(n)).reduce((a, [, b]) => a + b, 0);
    expect(sheetTotal).toBe(inventoryTotal);
    const back = await readFilesSheet(built.buffer);
    expect(back.manifest.schemaVersion).toBe('archive-v2');
    expect(back.files[0]).toEqual(expect.objectContaining({ originalReference: 'cloudinary:x', shared: false, cleanupEligible: true }));
  });
  it('refuses instead of truncating a value too long for a cell', async () => {
    const inv = inventory({ 'Comment.authorId': [{ id: 'c1', content: 'x'.repeat(EXCEL_MAX_CELL_CHARS + 1), authorId: 'u1' }] });
    await expect(buildArchiveWorkbook(inv, [], {
      archiveRef: opaqueId(), version: 1, environment: 'staging', operationId: opaqueId(), classificationVersion: 'no-history-v1', noHistory: false, dataFingerprint: 'f', generatedAt: NOW,
    })).rejects.toMatchObject({ code: 'ARCHIVE_TOO_LARGE_FOR_WORKBOOK' });
  });
});

describe('no-history-v1 and the fingerprint', () => {
  it('keeps pre-Phase-1 user fingerprints compatible while detecting real employment values', () => {
    const legacy = inventory({}, { roleId: 'role-1' });
    const withNullPhase1Columns = inventory({}, {
      roleId: 'role-1',
      employmentState: null,
      scheduledActivationOn: null,
    });
    expect(dataFingerprint(withNullPhase1Columns)).toBe(dataFingerprint(legacy));
    expect(dataFingerprint(inventory({}, { roleId: 'role-1', employmentState: 'SCHEDULED_TO_JOIN' }))).not.toBe(dataFingerprint(legacy));
    expect(dataFingerprint(inventory({}, { roleId: 'role-1', scheduledActivationOn: new Date('2026-12-01T00:00:00Z') }))).not.toBe(dataFingerprint(legacy));
  });
  it('ignores only the named setup-only rows', () => {
    const setup = inventory({
      'EmployeeAttendanceProfile.userId': [{ id: 'p1' }],
      'UserRoleAssignment.userId': [{ id: 'r1' }],
      'OperationalEvent.entityId[User]': [{ id: 'e1', action: 'USER_CREATED' }, { id: 'e2', action: 'USER_ARCHIVED' }],
      'AppSetting.key[user-prefs]': [{ key: 'user-prefs-u1', value: {} }],
    });
    const r = classifyNoHistory(setup);
    expect(r.noHistory).toBe(true);
    expect(r.ignoredSetupCounts).toEqual(expect.objectContaining({ 'EmployeeAttendanceProfile.userId': 1, 'OperationalEvent.entityId[User]': 2 }));
    expect(classifyNoHistory(inventory({ 'EmployeeAttendanceProfile.userId': [{ id: 'p1' }, { id: 'p2' }] })).noHistory).toBe(false);
    expect(classifyNoHistory(inventory({ 'OperationalEvent.entityId[User]': [{ id: 'e1', action: 'USER_ROLE_CHANGED' }] })).noHistory).toBe(false);
    expect(classifyNoHistory(inventory({ 'Comment.authorId': [{ id: 'c1' }] })).noHistory).toBe(false);
  });
  it('changes when the person\'s data changes, but not for bookkeeping or other people editing a shared row', () => {
    const base = dataFingerprint(inventory({ 'Comment.authorId': [{ id: 'c1', content: 'a', authorId: 'u1', updatedAt: NOW }] }));
    expect(dataFingerprint(inventory({ 'Comment.authorId': [{ id: 'c1', content: 'b', authorId: 'u1', updatedAt: NOW }] }))).toBe(base); // REASSIGN: link only
    expect(dataFingerprint(inventory({ 'Comment.authorId': [{ id: 'c1', content: 'a', authorId: 'u1' }, { id: 'c2', content: 'new', authorId: 'u1' }] }))).not.toBe(base);
    const own = dataFingerprint(inventory({ 'LeaveRequest.userId': [{ id: 'l1', status: 'CANCELLED' }] }));
    expect(dataFingerprint(inventory({ 'LeaveRequest.userId': [{ id: 'l1', status: 'APPROVED' }] }))).not.toBe(own);
    expect(dataFingerprint(inventory({ 'LeaveRequest.userId': [{ id: 'l1', status: 'CANCELLED' }], 'Notification.userId': [{ id: 'n1' }] }))).toBe(own);
    expect(dataFingerprint(inventory({ 'LeaveRequest.userId': [{ id: 'l1', status: 'CANCELLED' }], 'OperationalEvent.entityId[User]': [{ id: 'e', action: 'PERMANENT_DELETE_REQUESTED' }] }))).toBe(own);
  });
});

describe('opaque identifiers', () => {
  it('are random UUID v4 values', () => {
    const ids = new Set(Array.from({ length: 50 }, opaqueId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('system accounts are excluded from user lists', () => {
  const run = async (params: any) => {
    let seen: any;
    await excludeSystemAccounts(params, async (p: any) => { seen = p; return []; });
    return seen;
  };
  it.each(['findMany', 'count', 'groupBy', 'aggregate'])('adds isSystemAccount=false to User.%s', async (action) => {
    const p = await run({ model: 'User', action, args: { where: { isActive: false } } });
    expect(p.args.where).toEqual({ AND: [{ isActive: false }, { isSystemAccount: false }] });
  });
  it('leaves point lookups, other models and explicit system queries alone', async () => {
    expect((await run({ model: 'User', action: 'findUnique', args: { where: { id: 'x' } } })).args.where).toEqual({ id: 'x' });
    expect((await run({ model: 'Ticket', action: 'findMany', args: { where: {} } })).args.where).toEqual({});
    expect((await run({ model: 'User', action: 'count', args: { where: { isSystemAccount: true } } })).args.where).toEqual({ isSystemAccount: true });
  });
});
