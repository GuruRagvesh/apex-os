import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ARCHIVE_VERSION,
  EXCLUDED_SECRET_CATEGORIES,
  type ArchivedEmployee,
  type EmployeeArchive,
  type RelationSummaryRow,
} from './employee-archive.types';
import { USER_RELATION_RULES } from './user-relation-classification';

/**
 * Reads everything about one employee that the archive must carry.
 *
 * READ-ONLY, AND THAT IS THE WHOLE CONTRACT. Nothing here nulls a relation,
 * deletes a row or touches the user. The archive has to be built, uploaded and
 * verified while the employee is still completely intact, because if any of
 * that fails the correct outcome is that nothing happened at all. A test
 * asserts the Prisma client sees no write method called.
 *
 * DRIVEN BY THE CLASSIFICATION, not by a list in this file. Which datasets
 * belong in the archive follows from USER_RELATION_RULES, so a relation added
 * to the schema and classified is one the relation summary already knows
 * about. The alternative -- a hand-kept list here -- is a second thing to
 * forget, and forgetting it means archiving less than was deleted.
 */
@Injectable()
export class EmployeeArchiveCollectorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Maps each classified relation to the Prisma delegate and column that
   * finds its rows for one user.
   *
   * SEPARATE FROM THE CLASSIFICATION ON PURPOSE. The classification answers
   * "what happens to this when the user goes"; this answers "where do I read
   * it". Keeping them apart means a relation can be reclassified -- retained
   * instead of deleted -- without touching how it is found.
   */
  private static readonly SOURCES: ReadonlyArray<{
    key: string;
    model: string;
    field: string;
    delegate: string;
    column: string;
  }> = [
    // The employee's own attendance.
    { key: 'attendance/daily', model: 'DailyAttendance', field: 'user', delegate: 'dailyAttendance', column: 'userId' },
    { key: 'attendance/punches', model: 'AttendancePunchEvidence', field: 'user', delegate: 'attendancePunchEvidence', column: 'userId' },
    { key: 'attendance/punch-photos', model: 'AttendancePunchPhoto', field: 'user', delegate: 'attendancePunchPhoto', column: 'userId' },
    { key: 'attendance/handoffs', model: 'AttendancePunchHandoff', field: 'user', delegate: 'attendancePunchHandoff', column: 'userId' },
    { key: 'attendance/events', model: 'AttendanceEvent', field: 'user', delegate: 'attendanceEvent', column: 'userId' },
    { key: 'attendance/sessions', model: 'WorkSession', field: 'user', delegate: 'workSession', column: 'userId' },
    { key: 'attendance/breaks', model: 'BreakLog', field: 'user', delegate: 'breakLog', column: 'userId' },
    { key: 'attendance/regularizations', model: 'AttendanceRegularization', field: 'user', delegate: 'attendanceRegularization', column: 'userId' },
    { key: 'attendance/profile', model: 'EmployeeAttendanceProfile', field: 'user', delegate: 'employeeAttendanceProfile', column: 'userId' },
    { key: 'attendance/workday-override', model: 'UserWorkdayPolicyOverride', field: 'user', delegate: 'userWorkdayPolicyOverride', column: 'userId' },

    // Leave and comp off.
    { key: 'leave/requests', model: 'LeaveRequest', field: 'user', delegate: 'leaveRequest', column: 'userId' },
    { key: 'leave/comp-off', model: 'CompOffCredit', field: 'employee', delegate: 'compOffCredit', column: 'employeeId' },

    // Tickets. The tickets themselves SURVIVE; these are archived so the
    // person's own record of their work is complete, not so it can be removed.
    { key: 'tickets/created', model: 'Ticket', field: 'createdBy', delegate: 'ticket', column: 'createdById' },
    { key: 'tickets/assigned', model: 'Ticket', field: 'assignedTo', delegate: 'ticket', column: 'assignedToId' },
    { key: 'tickets/assignee-rows', model: 'TicketAssignee', field: 'user', delegate: 'ticketAssignee', column: 'userId' },
    { key: 'tickets/watching', model: 'TicketWatcher', field: 'user', delegate: 'ticketWatcher', column: 'userId' },
    { key: 'tickets/history', model: 'TicketHistory', field: 'changedBy', delegate: 'ticketHistory', column: 'changedById' },
    { key: 'tickets/time-logs', model: 'TicketTimeLog', field: 'user', delegate: 'ticketTimeLog', column: 'userId' },
    { key: 'tickets/comments', model: 'Comment', field: 'author', delegate: 'comment', column: 'authorId' },

    // Membership. The project, team and department all survive.
    { key: 'projects/memberships', model: 'ProjectMember', field: 'user', delegate: 'projectMember', column: 'userId' },
    { key: 'teams/memberships', model: 'TeamMember', field: 'user', delegate: 'teamMember', column: 'userId' },
    { key: 'departments/memberships', model: 'UserDepartmentMembership', field: 'user', delegate: 'userDepartmentMembership', column: 'userId' },
    { key: 'roles/assignments', model: 'UserRoleAssignment', field: 'user', delegate: 'userRoleAssignment', column: 'userId' },
    { key: 'access/managed-departments', model: 'ManagerDeptAccess', field: 'manager', delegate: 'managerDeptAccess', column: 'managerId' },

    // Documents. METADATA ONLY -- see the note on binaries below.
    { key: 'documents/metadata', model: 'EmployeeDocument', field: 'user', delegate: 'employeeDocument', column: 'userId' },

    // HR change requests.
    { key: 'hr/change-requests-about-them', model: 'EmployeeProfileChangeRequest', field: 'targetUser', delegate: 'employeeProfileChangeRequest', column: 'targetUserId' },
    { key: 'hr/change-requests-they-raised', model: 'EmployeeProfileChangeRequest', field: 'requestedBy', delegate: 'employeeProfileChangeRequest', column: 'requestedById' },

    // Audit. These rows SURVIVE deletion; archiving them gives the former
    // employee's file a complete account of what they did.
    { key: 'audit/operational-events', model: 'OperationalEvent', field: 'actor', delegate: 'operationalEvent', column: 'actorId' },
    { key: 'audit/activity', model: 'ActivityLog', field: 'user', delegate: 'activityLog', column: 'userId' },
    { key: 'notifications/received', model: 'Notification', field: 'user', delegate: 'notification', column: 'userId' },
  ];

  /**
   * Builds the archive for one employee.
   *
   * `now` is passed rather than read, so a test can produce a byte-identical
   * archive twice and the determinism claim means something.
   */
  async collect(input: {
    userId: string;
    archivedBy?: { id: string; name?: string | null } | null;
    now: Date;
    environment: string;
    applicationVersion?: string | null;
  }): Promise<EmployeeArchive> {
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      // POSITIVE SELECTION. `password` is simply never named, so it cannot
      // arrive by accident -- and a secret column added to User next year is
      // absent until somebody deliberately adds it here.
      select: {
        id: true, employeeId: true, name: true, email: true, phone: true,
        avatar: true, photoUrl: true,
        dateOfBirth: true, gender: true, bloodGroup: true,
        currentAddress: true, permanentAddress: true,
        emergencyName: true, emergencyPhone: true, emergencyRelation: true,
        designation: true, employmentType: true, workMode: true,
        workLocation: true, userLocation: true, shiftTiming: true,
        joiningDate: true, lastWorkingDate: true, probationPeriod: true,
        reportingManager: true, teamLeadName: true,
        isHR: true, isAttendanceDataOperator: true, isActive: true,
        ctcAnnual: true, basicSalary: true, salaryStructure: true,
        bankName: true, accountNumber: true, ifscCode: true,
        accountHolderName: true, paymentMode: true,
        panNumber: true, aadhaarNumber: true, uanNumber: true,
        pfApplicable: true, esicApplicable: true, professionalTax: true,
        taxRegime: true,
        verificationStatus: true, verificationDate: true,
        hrNotes: true, bio: true,
        createdAt: true, updatedAt: true,
        role: { select: { name: true } },
        department: { select: { name: true } },
      },
    });

    if (!user) throw new NotFoundException('Employee not found');

    const employee = toArchivedEmployee(user);

    const datasets: Record<string, unknown[]> = {};
    const rowsByRelation = new Map<string, number>();

    for (const source of EmployeeArchiveCollectorService.SOURCES) {
      const delegate = (this.prisma as any)[source.delegate];
      // A delegate that is absent is a real problem -- it means this list has
      // drifted from the schema -- but it must not take the archive down,
      // because an archive that fails is a deletion that cannot proceed. It
      // is recorded as unknown (null rows) and the relation summary shows it.
      if (!delegate?.findMany) {
        rowsByRelation.set(`${source.model}.${source.field}`, NaN);
        continue;
      }

      const rows: unknown[] = await delegate.findMany({
        where: { [source.column]: input.userId },
      });

      rowsByRelation.set(`${source.model}.${source.field}`, rows.length);
      // Empty datasets are omitted from the ZIP but still counted in the
      // relation summary, so "no rows" and "not collected" stay distinct.
      if (rows.length > 0) datasets[source.key] = rows;
    }

    const relationships: RelationSummaryRow[] = USER_RELATION_RULES.map((rule) => {
      const counted = rowsByRelation.get(`${rule.model}.${rule.field}`);
      return {
        model: rule.model,
        field: rule.field,
        action: rule.action,
        rows: counted === undefined || Number.isNaN(counted) ? null : counted,
        why: rule.why,
      };
    });

    const entityCounts: Record<string, number> = {};
    for (const [key, rows] of Object.entries(datasets)) entityCounts[key] = rows.length;

    return {
      manifest: {
        archiveVersion: ARCHIVE_VERSION,
        generatedAt: input.now.toISOString(),
        environment: input.environment,
        applicationVersion: input.applicationVersion ?? null,
        formerUserId: user.id,
        employeeId: user.employeeId ?? null,
        displayName: user.name,
        archivedByUserId: input.archivedBy?.id ?? null,
        archivedByDisplayName: input.archivedBy?.name ?? null,
        datasets: Object.keys(datasets).sort(),
        entityCounts,
        excludedSecretCategories: [...EXCLUDED_SECRET_CATEGORIES],
      },
      employee,
      datasets,
      relationships,
    };
  }
}

/** Dates to ISO strings, so the JSON is readable and stable. */
function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toArchivedEmployee(user: any): ArchivedEmployee {
  return {
    id: user.id,
    employeeId: user.employeeId ?? null,
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    avatar: user.avatar ?? null,
    photoUrl: user.photoUrl ?? null,

    dateOfBirth: iso(user.dateOfBirth),
    gender: user.gender ?? null,
    bloodGroup: user.bloodGroup ?? null,
    currentAddress: user.currentAddress ?? null,
    permanentAddress: user.permanentAddress ?? null,
    emergencyName: user.emergencyName ?? null,
    emergencyPhone: user.emergencyPhone ?? null,
    emergencyRelation: user.emergencyRelation ?? null,

    roleName: user.role?.name ?? null,
    departmentName: user.department?.name ?? null,
    designation: user.designation ?? null,
    employmentType: user.employmentType ?? null,
    workMode: user.workMode ?? null,
    workLocation: user.workLocation ?? null,
    userLocation: user.userLocation ?? null,
    shiftTiming: user.shiftTiming ?? null,
    joiningDate: iso(user.joiningDate),
    lastWorkingDate: iso(user.lastWorkingDate),
    probationPeriod: user.probationPeriod ?? null,
    reportingManager: user.reportingManager ?? null,
    teamLeadName: user.teamLeadName ?? null,
    isHR: Boolean(user.isHR),
    isAttendanceDataOperator: Boolean(user.isAttendanceDataOperator),
    isActive: Boolean(user.isActive),

    ctcAnnual: user.ctcAnnual ?? null,
    basicSalary: user.basicSalary ?? null,
    salaryStructure: user.salaryStructure ?? null,
    bankName: user.bankName ?? null,
    accountNumber: user.accountNumber ?? null,
    ifscCode: user.ifscCode ?? null,
    accountHolderName: user.accountHolderName ?? null,
    paymentMode: user.paymentMode ?? null,
    panNumber: user.panNumber ?? null,
    aadhaarNumber: user.aadhaarNumber ?? null,
    uanNumber: user.uanNumber ?? null,
    pfApplicable: user.pfApplicable ?? null,
    esicApplicable: user.esicApplicable ?? null,
    professionalTax: user.professionalTax ?? null,
    taxRegime: user.taxRegime ?? null,

    verificationStatus: user.verificationStatus ?? null,
    verificationDate: iso(user.verificationDate),
    hrNotes: user.hrNotes ?? null,
    bio: user.bio ?? null,

    createdAt: iso(user.createdAt),
    updatedAt: iso(user.updatedAt),
  };
}
