import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DepartmentsService } from '../../core/departments/departments.service';

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly departments: DepartmentsService,
  ) {}

  async sendTeamRequest(requesterId: string, targetUserId: string, reason?: string) {
    // Resolve requester and target names
    const [requester, target] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: requesterId },
        include: { department: true },
      }),
      this.prisma.user.findUnique({
        where: { id: targetUserId },
        include: { department: true },
      }),
    ]);

    if (!target) throw new NotFoundException('Target user not found');

    // Resolve the department this request is related to: prefer the
    // requester's formal Team (so its Team Lead can also be notified),
    // otherwise fall back to the requester's own department.
    const requesterTeamMembership = await this.prisma.teamMember.findFirst({
      where: { userId: requesterId },
      include: { team: { select: { departmentId: true, teamLeadId: true } } },
    });
    const routingDepartmentId = requesterTeamMembership?.team.departmentId ?? requester?.departmentId ?? null;

    // Approver is always the Department Head — never a random MANAGER.
    const departmentHead = routingDepartmentId
      ? await this.departments.selectDepartmentHead(routingDepartmentId)
      : null;
    let approver: { id: string; name: string } | null = departmentHead
      ? { id: departmentHead.id, name: departmentHead.name }
      : null;

    // Fallback: ADMIN or SUPER_ADMIN, deterministic — never a random MANAGER.
    if (!approver) {
      approver = await this.prisma.user.findFirst({
        where: { isActive: true, role: { name: { in: ['ADMIN', 'SUPER_ADMIN'] } } },
        select: { id: true, name: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    }

    if (!approver) throw new NotFoundException('No department head or admin found to route this request to');

    const reasonText = reason?.trim()
      ? ` Reason: ${reason.trim()}`
      : '';

    const requesterDept = (requester as any)?.department?.name ?? 'their team';
    await this.notifications.create(
      approver.id,
      'Team Addition Request',
      `${requester?.name ?? 'Someone'} has requested ${target.name} (${target.department?.name ?? 'No dept'}) to be added to ${requesterDept}.${reasonText}`,
      'INFO',
      '/team',
    );

    // Team Lead is informed for execution awareness only — approval and
    // escalation stay with the Department Head resolved above.
    const teamLeadId = requesterTeamMembership?.team.teamLeadId;
    if (teamLeadId && teamLeadId !== approver.id) {
      await this.notifications.create(
        teamLeadId,
        'Team Addition Request (FYI)',
        `${requester?.name ?? 'Someone'} has requested ${target.name} (${target.department?.name ?? 'No dept'}) to be added to ${requesterDept}. Routed to your department head for approval.${reasonText}`,
        'INFO',
        '/team',
      );
    }

    return {
      status: 'pending',
      message: `Request sent to ${approver.name}`,
    };
  }
}
