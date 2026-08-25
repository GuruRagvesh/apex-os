/**
 * APEX OS — HRMS Attendance & Leave Policy Defaults (Phase 1 foundation)
 * ─────────────────────────────────────────────────────────────────────────────
 * Seeds the FY2026-2027 policy defaults for the new HRMS attendance/leave
 * schema added in this phase: AttendancePolicy, ShiftPolicy, WeeklyOffPolicy,
 * HolidayCalendar/Holiday, LeavePolicy.
 *
 * Idempotent — safe to run multiple times. Uses upsert (Holiday, which has a
 * real unique constraint) or find-then-create (the other models, which don't
 * have a natural unique key per the Phase 1 schema spec) — never deletes.
 *
 * Does NOT touch EmployeeAttendanceProfile — assigning individual employees to
 * a category/shift is a deliberate later step, not part of this policy-default
 * seed, and must never be inferred automatically from role.
 *
 * Environment guards (same pattern as seed.ts / seed-test-users.ts):
 *   • NODE_ENV=production → blocked entirely, no exceptions
 *   • Database URL points to a known production host → blocked entirely, no exceptions
 *   • ALLOW_HRMS_POLICY_SEED not set → blocked by default
 *   • ALLOW_HRMS_POLICY_SEED=true only allows safe non-production seeding
 *
 * Run:
 *   npx ts-node prisma/seed-hrms-policy.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { PrismaClient } from '@prisma/client';

// ── Production Guard ──────────────────────────────────────────────────────────
function guardAgainstProduction() {
  const nodeEnv = process.env.NODE_ENV?.toLowerCase() || '';
  const databaseUrl = process.env.DATABASE_URL || '';
  const allowSeed = process.env.ALLOW_HRMS_POLICY_SEED?.toLowerCase() === 'true';

  if (nodeEnv === 'production') {
    console.error('❌ SEED BLOCKED: NODE_ENV is set to "production"');
    console.error('   This seed script cannot run in production.');
    process.exit(1);
  }

  const productionPatterns = [
    /render\.com/i,
    /dpg-[\w]+\.[\w]+-[\w]+\.postgres\.render\.com/i,
    /production/i,
    /prod\.technoedge/i,
    /dpg-d8259omk1jcs73e37fbg/i,
  ];
  const looksLikeProduction = productionPatterns.some((pattern) => pattern.test(databaseUrl));

  if (looksLikeProduction) {
    console.error('❌ SEED BLOCKED: Database URL appears to point to production');
    console.error(`   URL: ${databaseUrl.replace(/:[^:@]+@/, ':****@')}`);
    console.error('   Production databases cannot be seeded by this script. No exceptions.');
    process.exit(1);
  }

  if (!allowSeed) {
    console.error('❌ SEED BLOCKED: ALLOW_HRMS_POLICY_SEED not set');
    console.error('   To seed HRMS policy defaults on a non-production database:');
    console.error('   $ ALLOW_HRMS_POLICY_SEED=true npx ts-node prisma/seed-hrms-policy.ts');
    process.exit(1);
  }

  console.log('✓ Environment checks passed. Seeding HRMS policy defaults...');
}

guardAgainstProduction();

const prisma = new PrismaClient();

const FY = '2026-2027';

// Corrected against the official TechnoEdge 2026 holiday list (Phase 0 audit
// found the previous hardcoded list in leave-balance.service.ts had a wrong
// date for Holi and was missing 7 holidays — this list is not read by any
// service yet, so fixing it here has no runtime effect until a later phase).
const HOLIDAYS_2026: { date: string; name: string }[] = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-26', name: 'Republic Day' },
  { date: '2026-02-15', name: 'Maha Shivaratri/Shivaratri' },
  { date: '2026-03-03', name: 'Holi' },
  { date: '2026-03-19', name: 'Gudi Padwa' },
  { date: '2026-05-01', name: 'Maharashtra Day/Labour Day' },
  { date: '2026-08-15', name: 'Independence Day' },
  { date: '2026-08-28', name: 'Raksha Bandhan' },
  { date: '2026-09-14', name: 'Ganesh Chaturthi/Vinayaka Chaturthi' },
  { date: '2026-09-25', name: 'Ganesh Visharjan' },
  { date: '2026-10-02', name: 'Mahatma Gandhi Jayanti' },
  { date: '2026-10-20', name: 'Dussehra' },
  { date: '2026-11-08', name: 'Diwali/Deepavali' },
  { date: '2026-11-09', name: 'Govardhan Puja' },
  { date: '2026-11-10', name: 'Bhai Duj' },
  { date: '2026-11-11', name: 'Bhai Duj' },
  { date: '2026-12-25', name: 'Christmas' },
];

async function main() {
  // ── AttendancePolicy ─────────────────────────────────────────────────────
  let attendancePolicy = await prisma.attendancePolicy.findFirst({
    where: { financialYear: FY, name: 'Default Attendance Policy' },
  });
  if (!attendancePolicy) {
    attendancePolicy = await prisma.attendancePolicy.create({
      data: {
        financialYear: FY,
        name: 'Default Attendance Policy',
        isActive: true,
        minimumWorkingMinutes: 540,
        lateExemptionEnabled: true,
        faceCaptureRequired: false,
        locationCaptureRequired: false,
        geoFenceEnabled: false,
        regularizationEnabled: true,
      },
    });
    console.log(`  ✓ Created AttendancePolicy "${attendancePolicy.name}" (${FY})`);
  } else {
    console.log(`  · AttendancePolicy "${attendancePolicy.name}" (${FY}) already exists — skipped`);
  }

  // ── ShiftPolicy (Regular Employee + Team Leader) ────────────────────────
  const shiftSeeds = [
    { name: 'Regular Employee', category: 'REGULAR_EMPLOYEE' as const, startTime: '09:30', endTime: '18:30', graceMinutes: 10, minimumWorkingMinutes: 540 },
    { name: 'Team Leader', category: 'TEAM_LEADER' as const, startTime: '10:30', endTime: '19:30', graceMinutes: 10, minimumWorkingMinutes: 540 },
  ];
  for (const shift of shiftSeeds) {
    const existing = await prisma.shiftPolicy.findFirst({
      where: { attendancePolicyId: attendancePolicy.id, name: shift.name },
    });
    if (!existing) {
      await prisma.shiftPolicy.create({
        data: { ...shift, attendancePolicyId: attendancePolicy.id, isActive: true },
      });
      console.log(`  ✓ Created ShiftPolicy "${shift.name}" (${shift.startTime}-${shift.endTime}, grace ${shift.graceMinutes}m)`);
    } else {
      console.log(`  · ShiftPolicy "${shift.name}" already exists — skipped`);
    }
  }

  // ── WeeklyOffPolicy ──────────────────────────────────────────────────────
  const existingWeeklyOff = await prisma.weeklyOffPolicy.findFirst({
    where: { name: 'Default Weekly Off Policy' },
  });
  if (!existingWeeklyOff) {
    await prisma.weeklyOffPolicy.create({
      data: {
        name: 'Default Weekly Off Policy',
        everySunday: true,
        secondSaturday: true,
        fourthSaturday: true,
        isActive: true,
      },
    });
    console.log('  ✓ Created WeeklyOffPolicy "Default Weekly Off Policy"');
  } else {
    console.log('  · WeeklyOffPolicy "Default Weekly Off Policy" already exists — skipped');
  }

  // ── HolidayCalendar + Holiday (FY2026-2027) ─────────────────────────────
  let calendar = await prisma.holidayCalendar.findFirst({
    where: { financialYear: FY, name: 'TechnoEdge Holiday Calendar 2026' },
  });
  if (!calendar) {
    calendar = await prisma.holidayCalendar.create({
      data: { financialYear: FY, name: 'TechnoEdge Holiday Calendar 2026', isActive: true },
    });
    console.log(`  ✓ Created HolidayCalendar "${calendar.name}" (${FY})`);
  } else {
    console.log(`  · HolidayCalendar "${calendar.name}" (${FY}) already exists — reusing`);
  }

  let holidaysCreated = 0;
  for (const holiday of HOLIDAYS_2026) {
    await prisma.holiday.upsert({
      where: { calendarId_date: { calendarId: calendar.id, date: new Date(holiday.date) } },
      update: { name: holiday.name },
      create: { calendarId: calendar.id, date: new Date(holiday.date), name: holiday.name, isOptional: false },
    });
    holidaysCreated++;
  }
  console.log(`  ✓ Upserted ${holidaysCreated} holidays into "${calendar.name}"`);

  // ── LeavePolicy ──────────────────────────────────────────────────────────
  const existingLeavePolicy = await prisma.leavePolicy.findFirst({
    where: { financialYear: FY, name: 'Default Leave Policy' },
  });
  if (!existingLeavePolicy) {
    await prisma.leavePolicy.create({
      data: {
        financialYear: FY,
        name: 'Default Leave Policy',
        totalPaidLeaves: 14,
        combinedPoolTypes: ['CASUAL', 'SICK'],
        lwpAfterBalanceExhausted: true,
        approvedLeavePriorityOverAbsent: true,
        weeklyOffExcluded: true,
        holidaysExcluded: true,
        isActive: true,
      },
    });
    console.log(`  ✓ Created LeavePolicy "Default Leave Policy" (${FY}, 14 days, CASUAL+SICK combined pool)`);
  } else {
    console.log('  · LeavePolicy "Default Leave Policy" already exists — skipped');
  }

  console.log('\n✅ HRMS policy defaults seeded.');
  console.log('   Nothing in existing leave/workday services reads these tables yet.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
