import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { ROLES } from '../../../shared/constants/roles';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import { UpdateTeamMemberDto } from './dto/update-team-member.dto';

const BASIC_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  avatar: true,
  role: { select: { id: true, name: true } },
};

@Injectable()
export class TeamsService {
  constructor(
    private prisma: PrismaService,
    private access: AccessPolicyService,
  ) {}

  private async assertCanManageTeam(user: any, departmentId: string): Promise<void> {
    if (this.access.isAdmin(user)) return;
    if (this.access.roleName(user) === ROLES.MANAGER) {
      const deptIds = await this.access.managedDepartmentIds(user);
      if (deptIds.includes(departmentId)) return;
    }
    throw new ForbiddenException('You do not have permission to manage teams in this department');
  }

  private async assertActiveDepartmentUser(userId: string, departmentId: string, label = 'User'): Promise<void> {
    const candidate = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true, departmentId: true },
    });
    if (!candidate) throw new NotFoundException(`${label} not found`);
    if (candidate.isActive === false) throw new BadRequestException(`${label} must be active`);
    const secondaryMembership = candidate.departmentId === departmentId
      ? true
      : Boolean(await this.prisma.userDepartmentMembership.findUnique({
          where: { userId_departmentId: { userId, departmentId } },
        }));
    if (!secondaryMembership) throw new BadRequestException(`${label} must belong to the team's department`);
  }

  async findAll(user: any, departmentId?: string) {
    const where: any = { isActive: true };
    const roleName = this.access.roleName(user);

    if (this.access.isAdmin(user)) {
      if (departmentId) where.departmentId = departmentId;
    } else if (roleName === ROLES.MANAGER) {
      const deptIds = await this.access.managedDepartmentIds(user);
      if (departmentId) {
        if (!deptIds.includes(departmentId)) return [];
        where.departmentId = departmentId;
      } else {
        if (deptIds.length === 0) return [];
        where.departmentId = { in: deptIds };
      }
    } else {
      where.OR = [{ teamLeadId: user.id }, { members: { some: { userId: user.id } } }];
      if (departmentId) where.departmentId = departmentId;
    }

    const teams = await this.prisma.team.findMany({
      where,
      include: {
        department: { select: { id: true, name: true } },
        teamLead: { select: { id: true, name: true, avatar: true } },
        _count: { select: { members: true } },
      },
      orderBy: { name: 'asc' },
    });

    return teams.map((t) => {
      const { _count, ...rest } = t as any;
      return { ...rest, memberCount: _count.members };
    });
  }

  async findOne(id: string, user: any) {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: {
        department: { select: { id: true, name: true } },
        teamLead: { select: { id: true, name: true, avatar: true } },
        members: {
          include: { user: { select: BASIC_USER_SELECT } },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    if (!team) throw new NotFoundException('Team not found');

    const roleName = this.access.roleName(user);
    let canView = false;
    if (this.access.isAdmin(user)) {
      canView = true;
    } else if (roleName === ROLES.MANAGER) {
      const deptIds = await this.access.managedDepartmentIds(user);
      canView = deptIds.includes(team.departmentId);
    } else {
      canView = team.teamLeadId === user.id || team.members.some((m) => m.userId === user.id);
    }
    if (!canView) throw new ForbiddenException('You do not have permission to view this team');

    return { ...team, memberCount: team.members.length };
  }

  async create(dto: CreateTeamDto, user: any) {
    const department = await this.prisma.department.findUnique({
      where: { id: dto.departmentId },
      select: { id: true },
    });
    if (!department) throw new NotFoundException('Department not found');

    await this.assertCanManageTeam(user, dto.departmentId);

    if (dto.teamLeadId) {
      await this.assertActiveDepartmentUser(dto.teamLeadId, dto.departmentId, 'Team lead');
    }

    const memberIds = Array.from(new Set(dto.memberIds ?? []));
    for (const memberId of memberIds) {
      await this.assertActiveDepartmentUser(memberId, dto.departmentId, 'Team member');
    }

    const existing = await this.prisma.team.findFirst({
      where: { departmentId: dto.departmentId, name: dto.name },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`A team named "${dto.name}" already exists in this department`);
    }

    return this.prisma.team.create({
      data: {
        name: dto.name,
        departmentId: dto.departmentId,
        teamLeadId: dto.teamLeadId,
        ...(memberIds.length > 0 ? { members: { create: memberIds.map((userId) => ({ userId })) } } : {}),
      },
      include: {
        department: { select: { id: true, name: true } },
        teamLead: { select: { id: true, name: true, avatar: true } },
        members: { include: { user: { select: BASIC_USER_SELECT } } },
      },
    });
  }

  async update(id: string, dto: UpdateTeamDto, user: any) {
    const team = await this.prisma.team.findUnique({
      where: { id },
      select: { id: true, departmentId: true, name: true },
    });
    if (!team) throw new NotFoundException('Team not found');

    await this.assertCanManageTeam(user, team.departmentId);

    if (dto.teamLeadId) {
      await this.assertActiveDepartmentUser(dto.teamLeadId, team.departmentId, 'Team lead');
    }

    if (dto.name && dto.name !== team.name) {
      const existing = await this.prisma.team.findFirst({
        where: { departmentId: team.departmentId, name: dto.name, id: { not: id } },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(`A team named "${dto.name}" already exists in this department`);
      }
    }

    const isClearingTeamLead = dto.teamLeadId === null;

    const data: { name?: string; teamLeadId?: string | null } = {};
    if (dto.name) data.name = dto.name;
    if (dto.teamLeadId) {
      data.teamLeadId = dto.teamLeadId;
    } else if (isClearingTeamLead) {
      data.teamLeadId = null;
    }

    return this.prisma.team.update({
      where: { id },
      data,
      include: {
        department: { select: { id: true, name: true } },
        teamLead: { select: { id: true, name: true, avatar: true } },
      },
    });
  }

  async remove(id: string, user: any) {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: { _count: { select: { members: true } } },
    });
    if (!team) throw new NotFoundException('Team not found');

    await this.assertCanManageTeam(user, team.departmentId);

    const memberCount = (team as any)._count.members;
    if (memberCount > 0) {
      throw new ConflictException(
        `This team has ${memberCount} member${memberCount > 1 ? 's' : ''}. Remove all members before deleting this team.`,
      );
    }

    const [linkedTickets, linkedRoleAssignments, linkedProjects] = await Promise.all([
      this.prisma.ticket.count({ where: { OR: [{ requestingTeamId: id }, { targetTeamId: id }] } }),
      this.prisma.userRoleAssignment.count({ where: { teamId: id } }),
      this.prisma.projectTeamAssignment.count({ where: { teamId: id } }),
    ]);

    if (linkedProjects > 0) {
      await this.prisma.team.update({ where: { id }, data: { isActive: false } });
      return { success: true, archived: true, message: 'Team archived because it is linked to project history' };
    }

    if (linkedTickets > 0) {
      throw new ConflictException(
        `This team is linked to ${linkedTickets} ticket${linkedTickets > 1 ? 's' : ''}. Reassign or unlink them before deleting this team.`,
      );
    }
    if (linkedRoleAssignments > 0) {
      throw new ConflictException(
        `This team has ${linkedRoleAssignments} role assignment${linkedRoleAssignments > 1 ? 's' : ''} linked to it. Remove them before deleting this team.`,
      );
    }

    await this.prisma.team.delete({ where: { id } });
    return { success: true };
  }

  async addMember(teamId: string, dto: AddTeamMemberDto, user: any) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, departmentId: true },
    });
    if (!team) throw new NotFoundException('Team not found');

    await this.assertCanManageTeam(user, team.departmentId);

    const existingMembership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: dto.userId } },
    });
    if (existingMembership) throw new ConflictException('This user is already a member of this team');

    await this.assertActiveDepartmentUser(dto.userId, team.departmentId, 'Team member');

    return this.prisma.teamMember.create({
      data: { teamId, userId: dto.userId, ...(dto.role ? { role: dto.role } : {}) },
      include: { user: { select: BASIC_USER_SELECT } },
    });
  }

  async updateMember(teamId: string, userId: string, dto: UpdateTeamMemberDto, user: any) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, departmentId: true },
    });
    if (!team) throw new NotFoundException('Team not found');

    await this.assertCanManageTeam(user, team.departmentId);

    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!membership) throw new NotFoundException('This user is not a member of this team');

    return this.prisma.teamMember.update({
      where: { teamId_userId: { teamId, userId } },
      data: { role: dto.role },
      include: { user: { select: BASIC_USER_SELECT } },
    });
  }

  async removeMember(teamId: string, userId: string, user: any) {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true, departmentId: true, teamLeadId: true },
    });
    if (!team) throw new NotFoundException('Team not found');

    await this.assertCanManageTeam(user, team.departmentId);

    if (team.teamLeadId === userId) {
      throw new ConflictException(
        'This user is the current team lead. Change or clear the team lead before removing them as a member.',
      );
    }

    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
    });
    if (!membership) throw new NotFoundException('This user is not a member of this team');

    await this.prisma.teamMember.delete({ where: { teamId_userId: { teamId, userId } } });
    return { success: true };
  }
}
