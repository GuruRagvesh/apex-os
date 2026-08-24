import { PolicyDecisionAction, PolicyStatus } from '@prisma/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  buildPolicyObjects,
  MANAGEMENT_POLICY_GAPS,
  STAGING_ATTENDANCE_V2,
  validateStagingEnvironment,
} from '../../scripts/bootstrap-staging-attendance-e2e';

describe('staging Attendance E2E bootstrap', () => {
  it('keeps unresolved consequences in review and geofencing off without an explicit location', () => {
    const objects = buildPolicyObjects({
      financialYear: '2026-2027',
      effectiveFrom: new Date('2026-08-21T00:00:00.000Z'),
      attendancePolicyId: 'attendance-v1',
      shiftId: 'shift-v1',
      leavePolicyId: 'leave-v1',
      managerId: 'manager',
      hrId: 'hr',
      geofenceEnabled: false,
    });

    expect(objects.attendancePolicy).toMatchObject({
      policyKey: 'attendance-v1',
      version: 1,
      status: PolicyStatus.ACTIVE,
      isActive: true,
      minimumWorkingMinutes: 540,
      permittedBreakMinutes: 60,
      minimumEffectiveWorkMinutes: null,
      geoFenceEnabled: false,
      locationCaptureRequired: true,
      afterPunchWindowAction: PolicyDecisionAction.REQUIRE_REVIEW,
      insufficientHoursAction: PolicyDecisionAction.REQUIRE_REVIEW,
      automaticHalfDayEnabled: false,
    });
    expect(objects.shift).toMatchObject({
      startTime: '09:30', endTime: '18:30', graceMinutes: 60, minimumWorkingMinutes: 540,
    });
    expect(objects.leavePolicy).toMatchObject({
      casualLeaveAllocation: 10,
      emergencyLeaveAllocation: 4,
      combinedPoolTypes: [],
      firstHalfInEarliest: '09:30',
      firstHalfInLatest: '10:30',
      firstHalfRequiredPresenceMinutes: 240,
      secondHalfInEarliest: '14:00',
      secondHalfInLatest: '14:30',
      secondHalfOutTime: '18:30',
      compOffExpiryDays: 30,
    });
    for (const policy of [objects.attendancePolicy, objects.shift, objects.leavePolicy]) {
      expect(policy).toMatchObject({
        policyKey: policy.id,
        version: 1,
        status: PolicyStatus.ACTIVE,
        isActive: true,
      });
    }
  });

  it('keeps Comp Off auto-earning off while its duration threshold is unresolved', () => {
    expect(MANAGEMENT_POLICY_GAPS.compOffAutomaticGrant).toMatch(/automatic earning remains disabled/);
  });

  it('enables only E2E features and leaves automatic/official processing off', () => {
    expect(STAGING_ATTENDANCE_V2).toEqual({
      punchEvidenceEnabled: true,
      leaveAuthorityEnabled: true,
      leaveApprovalEnabled: true,
      regularizationEnabled: true,
      shadowEnabled: false,
      automaticEvaluationEnabled: false,
      officialWriteEnabled: false,
    });
  });

  it('requires positive staging identity and rejects the known production marker', () => {
    const safe = {
      APP_ENV: 'staging',
      DATABASE_URL: 'postgresql://user:secret@staging.example/apex_staging',
      EXPECTED_STAGING_DB_HOST: 'staging.example',
      EXPECTED_STAGING_DB_NAME: 'apex_staging',
    } as NodeJS.ProcessEnv;
    expect(validateStagingEnvironment(safe)).toEqual({
      host: 'staging.example', database: 'apex_staging',
    });
    expect(() => validateStagingEnvironment({
      ...safe,
      DATABASE_URL: 'postgresql://user:secret@dpg-d8259omk1jcs73e37fbg.example/apex_staging',
      EXPECTED_STAGING_DB_HOST: 'dpg-d8259omk1jcs73e37fbg.example',
    })).toThrow(/production/);
  });

  it('keeps apply explicit, atomic, conflict-refusing, and delete-free', () => {
    const source = readFileSync(
      resolve(__dirname, '../../scripts/bootstrap-staging-attendance-e2e.ts'),
      'utf8',
    );

    expect(source).toContain("process.argv.includes('--apply')");
    expect(source).toContain('if (!APPLY)');
    expect(source).toContain('await prisma.$transaction(operations)');
    expect(source).toContain('conflicts.length > 0');
    expect(source).not.toMatch(/prisma\.[A-Za-z]+\.delete(?:Many)?\s*\(/);
    expect(source).toContain('prisma.leavePolicy.create');
    expect(source).not.toMatch(/prisma\.compOffCredit\.create/);
  });
});
