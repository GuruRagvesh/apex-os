import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import { PrismaService } from '../../../prisma/prisma.service';

type AssignmentRole = 'TEAM_LEAD' | 'MANAGER';
type DraftOperation =
  | { type: 'UPSERT'; subjectUserId: string; assigneeUserId: string; role: AssignmentRole }
  | { type: 'END'; subjectUserId: string; role: AssignmentRole };

const ACTIVE_AT = (at: Date) => ({
  isPrimary: true,
  effectiveFrom: { lte: at },
  OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
});

const userSelect = {
  id: true,
  employeeId: true,
  name: true,
  email: true,
  avatar: true,
  photoUrl: true,
  designation: true,
  isActive: true,
  isSystemAccount: true,
  organizationParticipation: true,
  departmentId: true,
  reportingManager: true,
  teamLeadName: true,
  role: { select: { id: true, name: true, level: true } },
  department: { select: { id: true, name: true, color: true } },
  departmentMemberships: {
    select: {
      id: true,
      departmentId: true,
      isPrimary: true,
      designation: true,
      isDepartmentLead: true,
      allocationPercent: true,
      department: { select: { id: true, name: true, color: true } },
    },
    orderBy: [{ isPrimary: 'desc' }, { department: { name: 'asc' } }] as any,
  },
} as const;

@Injectable()
export class HierarchyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventLoggerService,
  ) {}

  async getMap() {
    const now = new Date();
    const [users, assignments, departments] = await Promise.all([
      this.prisma.user.findMany({
        where: { isActive: true, isSystemAccount: false },
        select: userSelect,
        orderBy: [{ role: { level: 'asc' } }, { name: 'asc' }],
      }),
      this.prisma.hierarchyAssignment.findMany({
        where: { scope: 'EMPLOYEE', ...ACTIVE_AT(now) },
        orderBy: { effectiveFrom: 'asc' },
      }),
      this.prisma.department.findMany({
        select: { id: true, name: true, color: true, _count: { select: { users: true } } },
        orderBy: { name: 'asc' },
      }),
    ]);

    const byEmployeeId = new Map(users.filter((user) => user.employeeId).map((user) => [user.employeeId!, user]));
    const explicit = new Map(assignments.map((row) => [`${row.subjectUserId}:${row.role}`, row]));
    const activeUserIds = new Set(users.map((user) => user.id));
    const issues: Array<{ code: string; userId: string; message: string }> = assignments
      .filter((row) => !row.subjectUserId || !activeUserIds.has(row.subjectUserId) || !activeUserIds.has(row.assigneeUserId))
      .map((row) => ({
        code: 'INACTIVE_HIERARCHY_PARTICIPANT',
        userId: row.subjectUserId ?? row.assigneeUserId,
        message: 'An active reporting line references an inactive or unavailable person.',
      }));
    const edges: any[] = assignments
      .filter((row) => row.subjectUserId && activeUserIds.has(row.subjectUserId) && activeUserIds.has(row.assigneeUserId))
      .map((row) => ({
        id: row.id,
        subjectUserId: row.subjectUserId,
        assigneeUserId: row.assigneeUserId,
        role: row.role,
        source: 'HIERARCHY',
        effectiveFrom: row.effectiveFrom,
      }));
    for (const user of users) {
      for (const [role, employeeId] of [
        ['TEAM_LEAD', user.teamLeadName],
        ['MANAGER', user.reportingManager],
      ] as const) {
        if (!employeeId || explicit.has(`${user.id}:${role}`)) continue;
        const assignee = byEmployeeId.get(employeeId);
        if (!assignee || assignee.id === user.id) {
          issues.push({
            code: 'LEGACY_REFERENCE_UNRESOLVED',
            userId: user.id,
            message: `${role === 'TEAM_LEAD' ? 'Team lead' : 'Manager'} employee ID ${employeeId} cannot be resolved.`,
          });
          continue;
        }
        edges.push({
          id: `legacy:${role}:${user.id}`,
          subjectUserId: user.id,
          assigneeUserId: assignee.id,
          role,
          source: 'LEGACY',
          effectiveFrom: null,
        });
      }
    }

    const directReportCounts = new Map<string, number>();
    for (const edge of edges) directReportCounts.set(edge.assigneeUserId, (directReportCounts.get(edge.assigneeUserId) ?? 0) + 1);

    return {
      generatedAt: now.toISOString(),
      nodes: users.map(({ reportingManager: _manager, teamLeadName: _lead, isSystemAccount: _system, ...user }) => ({
        ...user,
        directReportCount: directReportCounts.get(user.id) ?? 0,
      })),
      edges,
      departments: departments.map(({ _count: _ignored, ...department }) => ({
        ...department,
        peopleCount: users.filter((user) => user.departmentId === department.id).length,
      })),
      issues,
      stats: {
        people: users.length,
        departments: departments.length,
        connections: edges.length,
        setupIssues: issues.length,
      },
      permissions: { canEdit: true },
    };
  }

  /**
   * Business reporting chart. It intentionally does not read or write the
   * approval-routing hierarchy above: Admin/Super Admin are access grants,
   * not a statement of who leads the company.
   */
  async getOrganizationMap() {
    const [map, lines] = await Promise.all([
      this.getMap(),
      this.prisma.organizationReportingLine.findMany({ select: { id: true, subjectUserId: true, supervisorId: true, departmentId: true, scopeKey: true } }),
    ]);
    const activeIds = new Set(map.nodes.map((node: any) => node.id));
    const edges = lines.filter((line) => activeIds.has(line.subjectUserId) && activeIds.has(line.supervisorId)).map((line) => ({
      id: line.id,
      subjectUserId: line.subjectUserId,
      assigneeUserId: line.supervisorId,
      role: 'MANAGER' as const,
      source: 'ORGANIZATION' as const,
      departmentId: line.departmentId,
      scopeKey: line.scopeKey,
      effectiveFrom: null,
    }));
    const reports = new Map<string, number>();
    for (const edge of edges) reports.set(edge.assigneeUserId, (reports.get(edge.assigneeUserId) ?? 0) + 1);
    return {
      ...map,
      nodes: map.nodes.map((node: any) => ({ ...node, directReportCount: reports.get(node.id) ?? 0 })),
      edges,
      // Approval-routing migration warnings belong to the approval hierarchy,
      // not the business organization chart.
      issues: [],
      stats: { ...map.stats, connections: edges.length, setupIssues: 0 },
    };
  }

  /**
   * A deliberately bounded, cursor-paginated lookup for people pickers.
   * The visual atlas can keep its own compact overview while editor searches
   * never need to load every employee record into a browser control.
   */
  async getOrganizationDirectory(query: Record<string, string | undefined>) {
    const limitInput = Number.parseInt(String(query.limit ?? '40'), 10);
    const take = Number.isFinite(limitInput) ? Math.min(Math.max(limitInput, 1), 100) : 40;
    const cursor = String(query.cursor ?? '').trim();
    const term = String(query.q ?? '').trim();
    const departmentId = String(query.departmentId ?? '').trim();
    const roleName = String(query.role ?? '').trim();

    const where: any = {
      isActive: true,
      isSystemAccount: false,
      ...(departmentId ? {
        OR: [
          { departmentId },
          { departmentMemberships: { some: { departmentId } } },
        ],
      } : {}),
      ...(roleName ? { role: { name: roleName } } : {}),
    };
    if (term) {
      const searchable = {
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { email: { contains: term, mode: 'insensitive' } },
          { employeeId: { contains: term, mode: 'insensitive' } },
          { designation: { contains: term, mode: 'insensitive' } },
          { department: { name: { contains: term, mode: 'insensitive' } } },
          { departmentMemberships: { some: { department: { name: { contains: term, mode: 'insensitive' } } } } },
        ],
      };
      // Both department and text filters must apply, rather than one filter
      // accidentally widening the result set.
      if (where.OR) {
        const departmentFilter = where.OR;
        delete where.OR;
        where.AND = [{ OR: departmentFilter }, searchable];
      } else Object.assign(where, searchable);
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: take + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.user.count({ where }),
    ]);
    const hasMore = users.length > take;
    const items = users.slice(0, take);
    const reportCounts = await this.prisma.organizationReportingLine.groupBy({
      by: ['supervisorId'],
      where: { supervisorId: { in: items.map((user) => user.id) } },
      _count: { _all: true },
    });
    const reports = new Map(reportCounts.map((row) => [row.supervisorId, row._count._all]));
    return {
      items: items.map(({ reportingManager: _manager, teamLeadName: _lead, isSystemAccount: _system, ...user }) => ({
        ...user,
        directReportCount: reports.get(user.id) ?? 0,
      })),
      page: { limit: take, total, nextCursor: hasMore ? items.at(-1)?.id ?? null : null },
    };
  }

  async applyOrganization(actorId: string, rawOperations: Array<Record<string, unknown>> | undefined) {
    const operations = this.parseOperations(rawOperations);
    const unique = new Map<string, DraftOperation>();
    for (const operation of operations) unique.set(operation.subjectUserId, operation);
    const changes = [...unique.values()];
    const [users, lines] = await Promise.all([
      this.prisma.user.findMany({ where: { isActive: true, isSystemAccount: false }, select: userSelect }),
      this.prisma.organizationReportingLine.findMany(),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const working = new Map(lines.map((line) => [`${line.subjectUserId}:${line.scopeKey}`, line.supervisorId]));
    for (const operation of changes) {
      if (!userById.has(operation.subjectUserId)) throw new BadRequestException('Business reporting lines can only use active people.');
      if (operation.type === 'END') working.delete(`${operation.subjectUserId}:PRIMARY`);
      else {
        if (!userById.has(operation.assigneeUserId) || operation.subjectUserId === operation.assigneeUserId) throw new BadRequestException('Choose a different active person as the supervisor.');
        working.set(`${operation.subjectUserId}:PRIMARY`, operation.assigneeUserId);
      }
    }
    this.validateCycles(working, users);
    await this.prisma.$transaction(changes.map((operation) => operation.type === 'END'
      ? this.prisma.organizationReportingLine.deleteMany({ where: { subjectUserId: operation.subjectUserId, scopeKey: 'PRIMARY' } })
      : this.prisma.organizationReportingLine.upsert({
        where: { subjectUserId_scopeKey: { subjectUserId: operation.subjectUserId, scopeKey: 'PRIMARY' } },
        update: { supervisorId: operation.assigneeUserId, departmentId: userById.get(operation.subjectUserId)?.departmentId ?? null },
        create: {
          id: randomUUID(),
          subjectUserId: operation.subjectUserId,
          supervisorId: operation.assigneeUserId,
          departmentId: userById.get(operation.subjectUserId)?.departmentId ?? null,
          scopeKey: 'PRIMARY',
        },
      }),
    ));
    await Promise.all(changes.map((operation) => this.events.log({ actorId, entityType: 'OrganizationReportingLine', entityId: operation.subjectUserId, action: OperationalAction.HIERARCHY_ASSIGNMENT_UPDATED, metadata: { organizationOnly: true, supervisorId: operation.type === 'UPSERT' ? operation.assigneeUserId : null }, beforeValue: null, afterValue: null })));
    return { applied: changes.length, map: await this.getOrganizationMap() };
  }

  async apply(actorId: string, rawOperations: Array<Record<string, unknown>> | undefined) {
    const operations = this.parseOperations(rawOperations);
    const now = new Date();
    const [users, currentAssignments] = await Promise.all([
      this.prisma.user.findMany({
        where: { isActive: true, isSystemAccount: false },
        select: userSelect,
      }),
      this.prisma.hierarchyAssignment.findMany({
        where: { scope: 'EMPLOYEE', ...ACTIVE_AT(now) },
      }),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const userByEmployeeId = new Map(users.filter((user) => user.employeeId).map((user) => [user.employeeId!, user]));
    const working = new Map<string, string>();
    for (const row of currentAssignments) {
      if (row.subjectUserId) working.set(`${row.subjectUserId}:${row.role}`, row.assigneeUserId);
    }
    for (const user of users) {
      if (!working.has(`${user.id}:TEAM_LEAD`) && user.teamLeadName) {
        const lead = userByEmployeeId.get(user.teamLeadName);
        if (lead) working.set(`${user.id}:TEAM_LEAD`, lead.id);
      }
      if (!working.has(`${user.id}:MANAGER`) && user.reportingManager) {
        const manager = userByEmployeeId.get(user.reportingManager);
        if (manager) working.set(`${user.id}:MANAGER`, manager.id);
      }
    }

    for (const operation of operations) {
      const key = `${operation.subjectUserId}:${operation.role}`;
      if (operation.type === 'END') working.delete(key);
      else {
        this.validateNewConnection(operation, userById);
        working.set(key, operation.assigneeUserId);
      }
    }
    for (const operation of operations) {
      if (!userById.has(operation.subjectUserId)) throw new BadRequestException('Hierarchy connections can only use active people.');
    }
    this.validateCycles(working, users);

    const before = new Map<string, string | undefined>();
    for (const operation of operations) {
      const explicit = currentAssignments.find((row) => row.subjectUserId === operation.subjectUserId && row.role === operation.role);
      const user = userById.get(operation.subjectUserId)!;
      const legacyEmployeeId = operation.role === 'TEAM_LEAD' ? user.teamLeadName : user.reportingManager;
      before.set(`${operation.subjectUserId}:${operation.role}`, explicit?.assigneeUserId ?? userByEmployeeId.get(legacyEmployeeId ?? '')?.id);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const operation of operations) {
        await tx.hierarchyAssignment.updateMany({
          where: {
            scope: 'EMPLOYEE',
            subjectUserId: operation.subjectUserId,
            role: operation.role,
            isPrimary: true,
            effectiveTo: null,
          },
          data: { effectiveTo: now },
        });
        const legacyField = operation.role === 'TEAM_LEAD' ? 'teamLeadName' : 'reportingManager';
        if (operation.type === 'UPSERT') {
          const assignee = userById.get(operation.assigneeUserId)!;
          await tx.hierarchyAssignment.create({
            data: {
              id: randomUUID(),
              scope: 'EMPLOYEE',
              role: operation.role,
              subjectUserId: operation.subjectUserId,
              assigneeUserId: operation.assigneeUserId,
              isPrimary: true,
              effectiveFrom: now,
              createdById: actorId,
            },
          });
          await tx.user.update({
            where: { id: operation.subjectUserId },
            data: { [legacyField]: assignee.employeeId },
          });
        } else {
          await tx.user.update({
            where: { id: operation.subjectUserId },
            data: { [legacyField]: null },
          });
        }
      }
    });

    await Promise.all(operations.map((operation) => {
      const previousId = before.get(`${operation.subjectUserId}:${operation.role}`);
      return this.events.log({
        actorId,
        entityType: 'HierarchyAssignment',
        entityId: operation.subjectUserId,
        action: operation.type === 'UPSERT'
          ? OperationalAction.HIERARCHY_ASSIGNMENT_UPDATED
          : OperationalAction.HIERARCHY_ASSIGNMENT_ENDED,
        fromState: previousId ?? 'UNASSIGNED',
        toState: operation.type === 'UPSERT' ? operation.assigneeUserId : 'UNASSIGNED',
        metadata: { relation: operation.role, subjectUserId: operation.subjectUserId },
        beforeValue: previousId ? { assigneeUserId: previousId, role: operation.role } : null,
        afterValue: operation.type === 'UPSERT'
          ? { assigneeUserId: operation.assigneeUserId, role: operation.role }
          : null,
      });
    }));

    return { applied: operations.length, map: await this.getMap() };
  }

  private parseOperations(raw: Array<Record<string, unknown>> | undefined): DraftOperation[] {
    if (!Array.isArray(raw) || raw.length === 0) throw new BadRequestException('Add at least one hierarchy change.');
    if (raw.length > 100) throw new BadRequestException('A hierarchy publish is limited to 100 changes.');
    const allowedRoles = new Set<AssignmentRole>(['TEAM_LEAD', 'MANAGER']);
    const parsed: DraftOperation[] = [];
    const keys = new Set<string>();
    for (const value of raw) {
      const type = value?.type;
      const subjectUserId = String(value?.subjectUserId ?? '').trim();
      const role = String(value?.role ?? '') as AssignmentRole;
      if ((type !== 'UPSERT' && type !== 'END') || !subjectUserId || !allowedRoles.has(role)) {
        throw new BadRequestException('Every hierarchy change needs a valid type, person, and relationship.');
      }
      const key = `${subjectUserId}:${role}`;
      if (keys.has(key)) throw new BadRequestException('Only one pending change is allowed per person and relationship.');
      keys.add(key);
      if (type === 'UPSERT') {
        const assigneeUserId = String(value?.assigneeUserId ?? '').trim();
        if (!assigneeUserId) throw new BadRequestException('Select who the person reports to.');
        parsed.push({ type, subjectUserId, assigneeUserId, role });
      } else parsed.push({ type, subjectUserId, role });
    }
    return parsed;
  }

  private validateNewConnection(operation: Extract<DraftOperation, { type: 'UPSERT' }>, userById: Map<string, any>) {
    const subject = userById.get(operation.subjectUserId);
    const assignee = userById.get(operation.assigneeUserId);
    if (!subject || !assignee) throw new BadRequestException('Hierarchy connections can only use active people.');
    if (subject.id === assignee.id) throw new BadRequestException(`${subject.name} cannot report to themselves.`);
    const maximumAssigneeLevel = operation.role === 'MANAGER' ? 2 : 3;
    if (assignee.role.level > maximumAssigneeLevel || assignee.role.level >= subject.role.level) {
      throw new BadRequestException(`${assignee.name}'s ${assignee.role.name} role cannot be used as ${operation.role === 'MANAGER' ? 'manager' : 'team lead'} for ${subject.name}.`);
    }
    if (!assignee.employeeId) throw new BadRequestException(`${assignee.name} needs an employee ID before they can own an approval route.`);
    if (operation.role === 'TEAM_LEAD' && assignee.role.name === 'TEAM_LEAD' && subject.departmentId && assignee.departmentId !== subject.departmentId) {
      throw new BadRequestException(`A team lead must belong to ${subject.department?.name ?? 'the same department'} as ${subject.name}.`);
    }
  }

  private validateCycles(working: Map<string, string>, users: any[]) {
    const adjacency = new Map<string, string[]>();
    for (const [key, assigneeId] of working) {
      const subjectId = key.split(':')[0];
      adjacency.set(subjectId, [...(adjacency.get(subjectId) ?? []), assigneeId]);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      for (const parent of adjacency.get(id) ?? []) if (visit(parent)) return true;
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    for (const user of users) {
      if (visit(user.id)) throw new BadRequestException('This change creates a reporting cycle. Remove the circular connection and try again.');
    }
  }
}
