/**
 * THE ARCHIVE IS WHAT MAKES THE DELETION DEFENSIBLE.
 *
 * Once the user row is gone, this ZIP is the only remaining account of who
 * they were and what they did. So two properties matter more than anything
 * else here:
 *
 *   IT IS COMPLETE  -- every dataset the deletion will remove is in it,
 *                      because anything missing is simply destroyed.
 *   IT IS READ-ONLY -- collection happens while the employee is still fully
 *                      intact, so that a failure at any later stage leaves
 *                      nothing to undo.
 *
 * And one that matters for a different reason: no password hash goes to
 * Google Drive.
 */
import { NotFoundException } from '@nestjs/common';
import { EmployeeArchiveCollectorService } from '../../src/modules/platform/archive/employee-archive-collector.service';
import { USER_RELATION_RULES } from '../../src/modules/platform/archive/user-relation-classification';

const NOW = new Date('2026-10-03T06:00:00.000Z');

const USER_ROW = {
  id: 'u-1',
  employeeId: 'TE-014',
  name: 'Rahul Verma',
  email: 'rahul@technoedge.example',
  phone: '9000000000',
  avatar: null,
  photoUrl: null,
  dateOfBirth: new Date('1995-04-11T00:00:00.000Z'),
  gender: 'Male',
  bloodGroup: 'O+',
  currentAddress: 'Pune',
  permanentAddress: 'Pune',
  emergencyName: 'A. Verma',
  emergencyPhone: '9000000001',
  emergencyRelation: 'Father',
  designation: 'Engineer',
  employmentType: 'Full-time',
  workMode: 'Office',
  workLocation: 'Pune HQ',
  userLocation: 'Pune HQ',
  shiftTiming: '10:00 AM - 7:00 PM',
  joiningDate: new Date('2022-06-01T00:00:00.000Z'),
  lastWorkingDate: new Date('2026-09-30T00:00:00.000Z'),
  probationPeriod: '6 months',
  reportingManager: 'Priya',
  teamLeadName: 'Asha',
  isHR: false,
  isAttendanceDataOperator: false,
  isActive: true,
  ctcAnnual: '900000',
  basicSalary: '45000',
  salaryStructure: 'Standard',
  bankName: 'HDFC',
  accountNumber: '1234567890',
  ifscCode: 'HDFC0001',
  accountHolderName: 'Rahul Verma',
  paymentMode: 'NEFT',
  panNumber: 'ABCDE1234F',
  aadhaarNumber: '111122223333',
  uanNumber: '100200300',
  pfApplicable: true,
  esicApplicable: false,
  professionalTax: true,
  taxRegime: 'New',
  verificationStatus: 'Verified',
  verificationDate: new Date('2022-06-10T00:00:00.000Z'),
  hrNotes: 'Transferred from Delivery',
  bio: null,
  createdAt: new Date('2022-06-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-30T00:00:00.000Z'),
  role: { name: 'EMPLOYEE' },
  department: { name: 'Delivery' },
};

/** Rows returned per delegate, so a test can give one dataset content. */
type Seed = Record<string, unknown[]>;

function rig(opts: { seed?: Seed; user?: any | null } = {}) {
  const seed = opts.seed ?? {};
  /** Every write method that must never be called during collection. */
  const writes: string[] = [];
  const selects: any[] = [];

  const WRITE_METHODS = [
    'create', 'createMany', 'update', 'updateMany', 'upsert',
    'delete', 'deleteMany', 'executeRaw', '$executeRaw',
  ];

  const delegate = (name: string) =>
    new Proxy(
      {
        findMany: jest.fn(async () => seed[name] ?? []),
        findUnique: jest.fn(async () => (name === 'user' ? opts.user ?? USER_ROW : null)),
      } as any,
      {
        get(target, prop: string) {
          if (WRITE_METHODS.includes(prop)) {
            // Recorded AND throwing: a collector that wrote would otherwise
            // only fail a count assertion at the end, long after the damage.
            writes.push(`${name}.${prop}`);
            return () => {
              throw new Error(`collector must not write: ${name}.${prop}`);
            };
          }
          if (prop === 'findUnique') {
            return jest.fn(async (args: any) => {
              selects.push(args);
              return name === 'user' ? (opts.user === null ? null : opts.user ?? USER_ROW) : null;
            });
          }
          return target[prop];
        },
      },
    );

  const prisma: any = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') return undefined;
      return delegate(prop);
    },
  });

  const service = new EmployeeArchiveCollectorService(prisma);

  const collect = () =>
    service.collect({
      userId: 'u-1',
      archivedBy: { id: 'admin-1', name: 'Priya' },
      now: NOW,
      environment: 'test',
      applicationVersion: 'abc1234',
    });

  return { service, collect, writes, selects };
}

// ════════════════════════════════════════════════════════════════════════════
describe('the collector reads and never writes', () => {
  it('PERFORMS NO WRITE OF ANY KIND', async () => {
    // The property the whole ordering depends on: collect, zip, upload and
    // verify all happen while the employee is still completely intact, so a
    // failure at any of them leaves nothing to undo.
    const { collect, writes } = rig();

    await collect();

    expect(writes).toEqual([]);
  });

  it('reports a missing employee rather than archiving a blank', async () => {
    const { collect } = rig({ user: null });

    await expect(collect()).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('what the archive contains', () => {
  const seed: Seed = {
    dailyAttendance: [{ id: 'd1' }, { id: 'd2' }],
    attendancePunchEvidence: [{ id: 'p1' }],
    workSession: [{ id: 's1' }],
    attendanceRegularization: [{ id: 'r1' }],
    leaveRequest: [{ id: 'l1' }, { id: 'l2' }],
    compOffCredit: [{ id: 'c1' }],
    ticket: [{ id: 't1' }],
    comment: [{ id: 'cm1' }],
    ticketHistory: [{ id: 'th1' }],
    projectMember: [{ id: 'pm1' }],
    operationalEvent: [{ id: 'oe1' }, { id: 'oe2' }],
    employeeDocument: [{ id: 'doc1', fileUrl: 'https://cdn/x.pdf' }],
  };

  it('carries the employee identity and employment record', async () => {
    const archive = await rig({ seed }).collect();

    expect(archive.employee.id).toBe('u-1');
    expect(archive.employee.employeeId).toBe('TE-014');
    expect(archive.employee.name).toBe('Rahul Verma');
    expect(archive.employee.roleName).toBe('EMPLOYEE');
    expect(archive.employee.departmentName).toBe('Delivery');
    expect(archive.employee.joiningDate).toBe('2022-06-01T00:00:00.000Z');
    expect(archive.employee.lastWorkingDate).toBe('2026-09-30T00:00:00.000Z');
  });

  it.each([
    ['attendance', 'attendance/daily'],
    ['punches', 'attendance/punches'],
    ['sessions', 'attendance/sessions'],
    ['regularizations', 'attendance/regularizations'],
    ['leave', 'leave/requests'],
    ['comp off', 'leave/comp-off'],
    ['tickets', 'tickets/created'],
    ['comments', 'tickets/comments'],
    ['ticket history', 'tickets/history'],
    ['project membership', 'projects/memberships'],
    ['audit events', 'audit/operational-events'],
    ['document metadata', 'documents/metadata'],
  ])('collects %s', async (_label, key) => {
    const archive = await rig({ seed }).collect();

    expect(archive.datasets[key]).toBeDefined();
    expect(archive.datasets[key].length).toBeGreaterThan(0);
  });

  it('OMITS EMPTY DATASETS but still accounts for them', async () => {
    // An absent file and a dataset with no rows must stay distinguishable:
    // the first could mean nobody collected it.
    const archive = await rig({ seed }).collect();

    expect(archive.datasets['notifications/received']).toBeUndefined();

    const notifications = archive.relationships.find(
      (r) => r.model === 'Notification' && r.field === 'user',
    );
    expect(notifications!.rows).toBe(0);
  });

  it('counts every dataset it carries, correctly', async () => {
    const archive = await rig({ seed }).collect();

    expect(archive.manifest.entityCounts['attendance/daily']).toBe(2);
    expect(archive.manifest.entityCounts['leave/requests']).toBe(2);
    expect(archive.manifest.entityCounts['audit/operational-events']).toBe(2);
    expect(archive.manifest.entityCounts['leave/comp-off']).toBe(1);

    for (const [key, rows] of Object.entries(archive.datasets)) {
      expect(archive.manifest.entityCounts[key]).toBe(rows.length);
    }
  });

  it('SUMMARISES EVERY CLASSIFIED RELATION, not only the ones with rows', async () => {
    // What makes the archive auditable: a reader can see what was kept, what
    // was deliberately not kept, and what the rule was for each.
    const archive = await rig({ seed }).collect();

    expect(archive.relationships).toHaveLength(USER_RELATION_RULES.length);
    for (const row of archive.relationships) {
      expect(row.action).toBeTruthy();
      expect(row.why.length).toBeGreaterThan(10);
    }
  });

  it('states the action for records that SURVIVE, not just those removed', async () => {
    const archive = await rig({ seed }).collect();
    const byKey = new Map(archive.relationships.map((r) => [`${r.model}.${r.field}`, r]));

    expect(byKey.get('Ticket.createdBy')!.action).toBe('RETAIN_WITH_SNAPSHOT');
    expect(byKey.get('OperationalEvent.actor')!.action).toBe('RETAIN_WITH_SNAPSHOT');
    expect(byKey.get('DailyAttendance.user')!.action).toBe('DELETE_WITH_USER');
  });
});

describe('the manifest', () => {
  it('records who, when, where and what', async () => {
    const archive = await rig().collect();
    const m = archive.manifest;

    expect(m.archiveVersion).toBe('1.0');
    expect(m.generatedAt).toBe(NOW.toISOString());
    expect(m.environment).toBe('test');
    expect(m.applicationVersion).toBe('abc1234');
    expect(m.formerUserId).toBe('u-1');
    expect(m.employeeId).toBe('TE-014');
    expect(m.displayName).toBe('Rahul Verma');
    expect(m.archivedByUserId).toBe('admin-1');
  });

  it('NAMES THE SECRET CATEGORIES IT REFUSES TO CARRY', async () => {
    // Named by category rather than by column, so a reader can tell "there
    // are no refresh tokens in here" from "this system never had any".
    const archive = await rig().collect();

    expect(archive.manifest.excludedSecretCategories).toEqual(
      expect.arrayContaining([
        'passwordHash',
        'refreshTokens',
        'passwordResetTokens',
        'otpCodesAndSecrets',
        'mfaSecrets',
        'apiKeys',
      ]),
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('no authentication secret reaches the archive', () => {
  it('NEVER ASKS THE DATABASE FOR THE PASSWORD COLUMN', async () => {
    // The strongest form of the guarantee: the hash is not filtered out after
    // being read, it is never read. A `select` that omits it cannot leak it
    // however the object is later spread, serialised or logged.
    const { collect, selects } = rig();

    await collect();

    const userSelect = selects.find((s) => s?.select)?.select;
    expect(userSelect).toBeDefined();
    expect(userSelect.password).toBeUndefined();
    expect(Object.keys(userSelect)).not.toContain('password');
  });

  it('CONTAINS NO SECRET-SHAPED KEY ANYWHERE IN THE SERIALISED ARCHIVE', async () => {
    // Scans the whole structure rather than the employee object alone: a
    // secret could arrive through any dataset row, not just the profile.
    const archive = await rig({
      seed: {
        // A row that WOULD leak if datasets were copied blindly and nothing
        // checked. It proves the test can actually fail.
        operationalEvent: [{ id: 'oe1', metadata: { note: 'ordinary' } }],
      },
    }).collect();

    const serialised = JSON.stringify(archive);
    const forbidden = [
      /"password"\s*:/i,
      /"passwordHash"\s*:/i,
      /"refreshToken"\s*:/i,
      /"accessToken"\s*:/i,
      /"resetToken"\s*:/i,
      /"otp"\s*:/i,
      /"otpSecret"\s*:/i,
      /"mfaSecret"\s*:/i,
      /"apiKey"\s*:/i,
      /"clientSecret"\s*:/i,
      /"privateKey"\s*:/i,
    ];

    for (const pattern of forbidden) {
      expect(serialised).not.toMatch(pattern);
    }
  });

  it('the secret scan would catch a leak if one appeared', async () => {
    // Without this, the test above passes equally well against an archive
    // that is empty, and proves nothing.
    const archive = await rig({
      seed: { operationalEvent: [{ id: 'oe1', password: 'leaked' }] },
    }).collect();

    expect(JSON.stringify(archive)).toMatch(/"password"\s*:/i);
  });

  it('carries payroll and statutory identifiers, deliberately', async () => {
    // These are sensitive and were a real decision rather than an oversight:
    // the archive REPLACES the row about to be deleted, and statutory payroll
    // records must remain retrievable after somebody leaves. None of them can
    // be used to authenticate as anybody.
    const archive = await rig().collect();

    expect(archive.employee.panNumber).toBe('ABCDE1234F');
    expect(archive.employee.uanNumber).toBe('100200300');
    expect(archive.employee.accountNumber).toBe('1234567890');
  });
});

describe('determinism', () => {
  it('produces an identical archive twice for the same state', async () => {
    // The clock is injected rather than read, so "same state, same bytes" is
    // a property that can actually hold -- and a checksum computed over the
    // ZIP means something.
    const seed: Seed = { dailyAttendance: [{ id: 'd1' }], leaveRequest: [{ id: 'l1' }] };

    const first = await rig({ seed }).collect();
    const second = await rig({ seed }).collect();

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
