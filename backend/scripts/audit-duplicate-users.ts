/**
 * Read-only comparison of two (or more) user accounts believed to be the same
 * person.
 *
 * WHY THIS EXISTS. Deciding which of a pair of duplicate accounts becomes the
 * canonical login, and which is retired, is not a judgement anybody should make
 * from a Users list. It depends on which account actually carries the
 * operational history -- attendance, workday, leave, tickets, audit -- and that
 * is only visible by counting.
 *
 * STRICTLY READ ONLY. It opens no write, and refuses to run if handed anything
 * that looks like a mutation flag. Prints counts and identity facts; changes
 * nothing, archives nothing, merges nothing.
 *
 *   npx ts-node scripts/audit-duplicate-users.ts a@x.com b@x.com
 *
 * Requires DATABASE_URL pointing at the database being inspected. Safe against
 * production precisely because it cannot write.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Every relation counted, grouped the way a human reasons about the account. */
const RELATIONS: Array<{
  group: string;
  label: string;
  model: string;
  field: string;
}> = [
  // Attendance V1 -- the payroll-relevant history.
  { group: 'Attendance', label: 'Daily Attendance', model: 'dailyAttendance', field: 'userId' },
  { group: 'Attendance', label: 'Attendance Events', model: 'attendanceEvent', field: 'userId' },
  { group: 'Attendance', label: 'Punch Evidence', model: 'attendancePunchEvidence', field: 'userId' },
  { group: 'Attendance', label: 'Punch Photos', model: 'attendancePunchPhoto', field: 'userId' },
  { group: 'Attendance', label: 'Corrections (own)', model: 'attendanceRegularization', field: 'userId' },
  { group: 'Attendance', label: 'Corrections (entered)', model: 'attendanceRegularization', field: 'createdById' },
  { group: 'Attendance', label: 'Phone Handoffs', model: 'attendancePunchHandoff', field: 'userId' },
  { group: 'Attendance', label: 'Months Finalized', model: 'attendanceMonthClose', field: 'finalizedById' },
  { group: 'Attendance', label: 'Comp-Off Credits', model: 'compOffCredit', field: 'employeeId' },
  { group: 'Attendance', label: 'Attendance Profile', model: 'employeeAttendanceProfile', field: 'userId' },

  // Workday
  { group: 'Workday', label: 'Work Sessions', model: 'workSession', field: 'userId' },
  { group: 'Workday', label: 'Break Logs', model: 'breakLog', field: 'userId' },
  { group: 'Workday', label: 'Policy Overrides', model: 'userWorkdayPolicyOverride', field: 'userId' },

  // Leave
  { group: 'Leave', label: 'Leave Requests', model: 'leaveRequest', field: 'userId' },

  // Work
  { group: 'Work', label: 'Tickets Created', model: 'ticket', field: 'createdById' },
  { group: 'Work', label: 'Tickets Assigned', model: 'ticket', field: 'assignedToId' },
  { group: 'Work', label: 'Ticket Assignees', model: 'ticketAssignee', field: 'userId' },
  { group: 'Work', label: 'Ticket Time Logs', model: 'ticketTimeLog', field: 'userId' },
  { group: 'Work', label: 'Ticket History', model: 'ticketHistory', field: 'changedById' },
  { group: 'Work', label: 'Comments', model: 'comment', field: 'authorId' },
  { group: 'Work', label: 'Project Memberships', model: 'projectMember', field: 'userId' },

  // Organisation
  { group: 'Org', label: 'Managed Departments', model: 'managerDeptAccess', field: 'managerId' },
  { group: 'Org', label: 'Team Memberships', model: 'teamMember', field: 'userId' },
  { group: 'Org', label: 'Role Assignments', model: 'userRoleAssignment', field: 'userId' },

  // Audit and records
  { group: 'Audit', label: 'Operational Events', model: 'operationalEvent', field: 'actorId' },
  { group: 'Audit', label: 'Activity Logs', model: 'activityLog', field: 'userId' },
  { group: 'Audit', label: 'Notifications', model: 'notification', field: 'userId' },
  { group: 'Audit', label: 'Documents', model: 'employeeDocument', field: 'userId' },
];

/** Groups whose presence means retiring the account would strand real history. */
const HISTORICAL_GROUPS = ['Attendance', 'Workday', 'Leave'];

async function describe(email: string) {
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    include: { role: true, department: true },
  });
  if (!user) return null;

  const counts: Record<string, number> = {};
  for (const r of RELATIONS) {
    try {
      counts[`${r.group}/${r.label}`] = await (prisma as any)[r.model].count({
        where: { [r.field]: user.id },
      });
    } catch (err: any) {
      counts[`${r.group}/${r.label}`] = -1; // model absent; reported, never guessed
    }
  }
  return { user, counts };
}

function pad(s: string, n: number) {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function main() {
  const emails = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const flags = process.argv.slice(2).filter((a) => a.startsWith('-'));

  if (flags.length > 0) {
    console.error(`This script is read-only and accepts no flags. Refusing: ${flags.join(' ')}`);
    process.exit(1);
  }
  if (emails.length < 2) {
    console.error('Usage: ts-node scripts/audit-duplicate-users.ts <email-a> <email-b> [...]');
    process.exit(1);
  }

  console.log('\n=== DUPLICATE USER AUDIT (read-only) ===\n');

  const found: Array<{ email: string; user: any; counts: Record<string, number> }> = [];
  for (const email of emails) {
    const r = await describe(email);
    if (!r) {
      console.log(`  ${email}\n    NOT FOUND\n`);
      continue;
    }
    found.push({ email, ...r });
  }
  if (found.length < 2) {
    console.error('Fewer than two accounts resolved. Nothing to compare.');
    process.exit(1);
  }

  console.log('IDENTITY\n');
  const facts: Array<[string, (u: any) => string]> = [
    ['user id', (u) => u.id],
    ['email', (u) => u.email],
    ['name', (u) => u.name ?? ''],
    ['base role', (u) => u.role?.name ?? '(none)'],
    ['role level', (u) => String(u.role?.level ?? '')],
    ['HR authority', (u) => (u.isHR ? 'ENABLED' : 'no')],
    ['department', (u) => u.department?.name ?? '(none)'],
    ['active', (u) => (u.isActive ? 'yes' : 'ARCHIVED/INACTIVE')],
    ['employee id', (u) => u.employeeId ?? '(blank)'],
    ['designation', (u) => u.designation ?? '(blank)'],
    ['joining date', (u) => (u.joiningDate ? new Date(u.joiningDate).toISOString().slice(0, 10) : '(blank)')],
    ['reporting mgr', (u) => u.reportingManager ?? '(none)'],
    ['team lead', (u) => u.teamLeadName ?? '(none)'],
    ['last active', (u) => (u.lastActiveAt ? new Date(u.lastActiveAt).toISOString() : 'never')],
    ['created', (u) => new Date(u.createdAt).toISOString().slice(0, 10)],
  ];
  for (const [label, get] of facts) {
    console.log(`  ${pad(label, 15)} ${found.map((f) => pad(get(f.user), 40)).join('')}`);
  }

  console.log('\nLINKED RECORDS\n');
  console.log(`  ${pad('', 15)} ${found.map((f) => pad(f.email.split('@')[0], 40)).join('')}`);
  let lastGroup = '';
  for (const r of RELATIONS) {
    const key = `${r.group}/${r.label}`;
    const vals = found.map((f) => f.counts[key]);
    if (vals.every((v) => v === 0)) continue; // silent when nobody has any
    if (r.group !== lastGroup) {
      console.log(`\n  -- ${r.group} --`);
      lastGroup = r.group;
    }
    console.log(
      `  ${pad(r.label, 24)} ${vals.map((v) => pad(v === -1 ? 'n/a' : String(v), 40)).join('')}`,
    );
  }

  console.log('\nVERDICT\n');
  for (const f of found) {
    const historical = RELATIONS.filter((r) => HISTORICAL_GROUPS.includes(r.group)).reduce(
      (sum, r) => sum + Math.max(0, f.counts[`${r.group}/${r.label}`] ?? 0),
      0,
    );
    const total = Object.values(f.counts).reduce((s, v) => s + Math.max(0, v), 0);
    console.log(
      `  ${pad(f.email, 42)} history=${pad(String(historical), 8)} all=${pad(String(total), 8)}` +
        (historical > 0
          ? 'HOLDS OPERATIONAL HISTORY -- archive, never delete'
          : 'no attendance/workday/leave history'),
    );
  }

  console.log(
    '\n  The account holding history should keep it. Archiving retires the LOGIN\n' +
      '  and preserves the records; it does not move them. Do not reassign userIds.\n',
  );
}

main()
  .catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
