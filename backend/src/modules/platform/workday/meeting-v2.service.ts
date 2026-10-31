import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { HierarchyApprovalService, type ApproverCandidate } from '../../../common/services/hierarchy-approval.service';
import { NotificationsService } from '../../operations/notifications/notifications.service';
import { WorkdayService } from './workday.service';

/**
 * Meeting v2.
 *
 * A meeting is planned in one form before it starts: agenda, type, purpose,
 * collaborators and (for External/Custom) outside people. Starting it pauses
 * the organizer's work. Every collaborator gets an invite and only counts as
 * attending once they accept. Each attendee leaves on their own ("Resume
 * work"); the meeting completes when the last joined attendee leaves, and is
 * then approved through the reporting hierarchy.
 */

export const MEETING_TYPES = ['ONE_ON_ONE', 'INTERNAL', 'EXTERNAL', 'CUSTOM'] as const;
export const MEETING_PURPOSES = ['REVIEW', 'PLANNING', 'TRAINING', 'CLIENT', 'STATUS_UPDATE', 'OTHER'] as const;
type MeetingType = typeof MEETING_TYPES[number];

const RANK: Record<string, number> = { SUPER_ADMIN: 5, ADMIN: 4, MANAGER: 3, TEAM_LEAD: 2, EMPLOYEE: 1, INTERN: 0 };
const LEAD_ROLES = new Set(['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']);
const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);
export const MEETING_V2_SOURCE = 'MEETING_V2';
export const MEETING_CANCELLED_SOURCE = 'MEETING_CANCELLED';

export interface StartMeetingInput {
  agenda: string;
  type: string;
  purpose?: string;
  participantIds?: string[];
  clientName?: string;
  guestNames?: string;
  isDepartmental?: boolean;
  approverId?: string;
  approverIds?: string[];
}

type MeetingApprovalCandidate = {
  id: string;
  name: string;
  role: string;
  departmentIds: string[];
  onLeave: boolean;
};

type MeetingApprovalPlan = {
  candidates: MeetingApprovalCandidate[];
  mandatoryIds: string[];
  groups: { departmentId: string | null; departmentName: string; candidateIds: string[] }[];
  recommendedIds: string[];
};

@Injectable()
export class MeetingV2Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hierarchy: HierarchyApprovalService,
    private readonly notifications: NotificationsService,
    private readonly workday: WorkdayService,
  ) {}

  private roleOf(user: any): string {
    return String(user?.role?.name ?? '').toUpperCase();
  }

  private async actor(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { role: true, department: true } });
    if (!user || !user.isActive) throw new ForbiddenException('Your account is not active.');
    return user;
  }

  private personShape(user: any) {
    return {
      id: user.id,
      name: user.name,
      role: this.roleOf(user),
      departmentId: user.departmentId ?? null,
      departmentName: user.department?.name ?? null,
    };
  }

  /** People currently inside a running meeting (their work is paused for it). */
  private async busyUserIds(userIds: string[]): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const open = await this.prisma.breakLog.findMany({
      where: { userId: { in: userIds }, breakType: 'MEETING', endAt: null },
      select: { userId: true },
    });
    return new Set(open.map((row) => row.userId));
  }

  /** Everything the start form needs, from real records only. */
  async options(userId: string) {
    const me = await this.actor(userId);
    const role = this.roleOf(me);
    const [people, departments, chain] = await Promise.all([
      this.prisma.user.findMany({
        where: { isActive: true, id: { not: userId } },
        include: { role: true, department: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.hierarchy.resolveApproverChainFor(userId),
    ]);
    const [busy, approvalCandidates] = await Promise.all([
      this.busyUserIds(people.map((p) => p.id)),
      this.approvalCandidates(),
    ]);
    return {
      me: this.personShape(me),
      canCreateInternal: LEAD_ROLES.has(role),
      departments,
      people: people.map((p) => ({ ...this.personShape(p), inMeeting: busy.has(p.id) })),
      approverChain: chain,
      approvalCandidates,
      myTeamLeadId: chain.find((c) => c.tier === 'TEAM_LEAD')?.id ?? null,
      myManagerId: chain.find((c) => c.tier === 'MANAGER')?.id ?? null,
    };
  }

  private cleanList(value?: string): string | null {
    const text = String(value ?? '').split(',').map((part) => part.trim()).filter(Boolean).join(', ');
    return text ? text.slice(0, 500) : null;
  }

  /** Active senior people who can validate a meeting, including manager department access. */
  private async approvalCandidates(): Promise<MeetingApprovalCandidate[]> {
    const now = new Date();
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999);
    const [seniors, leaveRows] = await Promise.all([
      this.prisma.user.findMany({
        where: { isActive: true, role: { name: { in: ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'] } } },
        include: { role: true, department: true, managedDepts: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.leaveRequest.findMany({
        where: { status: 'APPROVED', startDate: { lte: dayEnd }, endDate: { gte: dayStart } },
        select: { userId: true },
      }),
    ]);
    const away = new Set(leaveRows.map((row) => row.userId));
    return seniors.map((person: any) => ({
      id: person.id,
      name: person.name,
      role: this.roleOf(person),
      departmentIds: [...new Set([
        person.departmentId,
        ...(person.managedDepts ?? []).map((access: any) => access.departmentId),
      ].filter(Boolean))] as string[],
      onLeave: away.has(person.id),
    }));
  }

  /**
   * One approval plan covers all meeting shapes. Every represented department
   * gets a senior validator. Senior attendees are mandatory validators; an
   * uncovered department falls back TL -> Manager -> Admin. The organizer is
   * never allowed to approve their own meeting.
   */
  private async buildApprovalPlan(organizer: any, attendees: any[], type?: MeetingType, input?: StartMeetingInput): Promise<MeetingApprovalPlan> {
    const allCandidates = await this.approvalCandidates();
    const available = allCandidates.filter((candidate) => candidate.id !== organizer.id && !candidate.onLeave);
    const attendeeIds = new Set(attendees.map((person) => person.id));
    const mandatory = available.filter((candidate) => attendeeIds.has(candidate.id));
    const mandatoryIds = mandatory.map((candidate) => candidate.id);
    const departmentMap = new Map<string, string>();
    for (const person of attendees) {
      if (person.departmentId) departmentMap.set(person.departmentId, person.department?.name ?? person.departmentId);
    }

    const groups: MeetingApprovalPlan['groups'] = [];
    for (const [departmentId, departmentName] of departmentMap) {
      if (mandatory.some((candidate) => candidate.departmentIds.includes(departmentId) || ADMIN_ROLES.has(candidate.role))) continue;

      const organizerRank = organizer.departmentId === departmentId ? (RANK[this.roleOf(organizer)] ?? 0) : 0;
      const clientOnly = type === 'EXTERNAL' && Boolean(input?.clientName?.trim()) && attendees.length === 1;
      const minimumRank = Math.max(clientOnly ? RANK.MANAGER : RANK.TEAM_LEAD, organizerRank + 1);
      let choices = available.filter((candidate) =>
        candidate.departmentIds.includes(departmentId) && (RANK[candidate.role] ?? 0) >= minimumRank,
      ).sort((a, b) => (RANK[a.role] ?? 0) - (RANK[b.role] ?? 0) || a.name.localeCompare(b.name));
      if (!choices.length) {
        const admins = available.filter((candidate) => ADMIN_ROLES.has(candidate.role));
        const adminRank = Math.min(Infinity, ...admins.map((candidate) => RANK[candidate.role] ?? 0));
        choices = admins.filter((candidate) => (RANK[candidate.role] ?? 0) === adminRank);
      }
      groups.push({ departmentId, departmentName, candidateIds: choices.map((candidate) => candidate.id) });
    }

    // A client-only meeting still needs the organizer's hierarchy represented.
    if (!departmentMap.size) {
      const chain = await this.hierarchy.resolveApproverChainFor(organizer.id);
      const firstAvailable = chain.find((entry) => available.some((candidate) => candidate.id === entry.id));
      groups.push({ departmentId: null, departmentName: 'Company', candidateIds: firstAvailable ? [firstAvailable.id] : [] });
    }

    const candidateIds = new Set([...mandatoryIds, ...groups.flatMap((group) => group.candidateIds)]);
    const candidates = allCandidates.filter((candidate) => candidateIds.has(candidate.id));
    return {
      candidates,
      mandatoryIds,
      groups,
      recommendedIds: [...new Set([...mandatoryIds, ...groups.map((group) => group.candidateIds[0]).filter(Boolean)])],
    };
  }

  /**
   * Who approves, from the rules agreed with the business:
   * Custom → the most senior attendees (Admin present → Admin + Managers present;
   * otherwise the top-ranked attendees, Team Lead or above); Client → the
   * organizer's direct manager; Departmental → the organizer's Team Lead;
   * everything else → the organizer's first approver, or a chosen one from
   * their chain when the usual approver is away.
   */
  private async resolveApprovers(
    organizer: any,
    type: MeetingType,
    attendees: any[],
    input: StartMeetingInput,
    chain: ApproverCandidate[],
  ): Promise<string[]> {
    const plan = await this.buildApprovalPlan(organizer, attendees, type, input);
    const requested = [...new Set((input.approverIds ?? (input.approverId ? [input.approverId] : [])).map(String))];
    if (requested.length) {
      const eligible = new Set(plan.candidates.filter((candidate) => !candidate.onLeave).map((candidate) => candidate.id));
      if (requested.some((id) => !eligible.has(id))) {
        throw new BadRequestException('Choose approvers suggested for the departments in this meeting.');
      }
      if (plan.mandatoryIds.some((id) => !requested.includes(id))) {
        throw new BadRequestException('Every senior person attending this meeting must remain in the approval list.');
      }
      const uncovered = plan.groups.find((group) => !group.candidateIds.some((id) => requested.includes(id)));
      if (uncovered) throw new BadRequestException(`Choose an approver for ${uncovered.departmentName}.`);
      return requested;
    }
    if (plan.recommendedIds.length) return plan.recommendedIds;

    const others = attendees.filter((a) => a.id !== organizer.id);
    const internalWithoutSenior = type === 'INTERNAL'
      && others.every((attendee) => (RANK[this.roleOf(attendee)] ?? 0) < RANK.TEAM_LEAD);

    if (internalWithoutSenior) {
      const eligible = chain.filter((candidate) => candidate.tier === 'TEAM_LEAD' || candidate.tier === 'MANAGER');
      if (input.approverId) {
        const chosen = eligible.find((candidate) => candidate.id === input.approverId);
        if (!chosen) throw new BadRequestException('Choose a Team Leader or Manager from your reporting hierarchy.');
        return [chosen.id];
      }
      const usual = eligible.find((candidate) => candidate.tier === 'TEAM_LEAD')
        ?? eligible.find((candidate) => candidate.tier === 'MANAGER');
      if (!usual) throw new BadRequestException('No Team Leader or Manager is assigned to approve this meeting.');
      return [usual.id];
    }

    if (type === 'CUSTOM') {
      const top = Math.max(-1, ...others.map((a) => RANK[this.roleOf(a)] ?? 0));
      if (top < RANK.TEAM_LEAD) return chain[0] ? [chain[0].id] : [];
      const picked = top >= RANK.ADMIN
        ? others.filter((a) => (RANK[this.roleOf(a)] ?? 0) >= RANK.MANAGER)
        : others.filter((a) => (RANK[this.roleOf(a)] ?? 0) === top);
      return picked.map((a) => a.id);
    }
    if (type === 'EXTERNAL' && input.clientName?.trim()) {
      const manager = chain.find((c) => c.tier === 'MANAGER') ?? chain.find((c) => c.tier === 'ADMIN');
      return manager ? [manager.id] : [];
    }
    if (input.isDepartmental) {
      const lead = chain.find((c) => c.tier === 'TEAM_LEAD') ?? chain[0];
      return lead ? [lead.id] : [];
    }
    if (input.approverId) {
      if (!chain.some((c) => c.id === input.approverId)) throw new BadRequestException('Choose an approver from your reporting line.');
      return [input.approverId];
    }
    return chain[0] ? [chain[0].id] : [];
  }

  async start(userId: string, input: StartMeetingInput) {
    const organizer = await this.actor(userId);
    const role = this.roleOf(organizer);
    const agenda = String(input.agenda ?? '').trim();
    if (agenda.length < 3 || agenda.length > 200) throw new BadRequestException('The agenda must be 3 to 200 characters.');
    const type = String(input.type ?? '').toUpperCase() as MeetingType;
    if (!MEETING_TYPES.includes(type)) throw new BadRequestException('Choose a meeting type.');
    const purpose = input.purpose ? String(input.purpose).toUpperCase() : null;
    if (purpose && !(MEETING_PURPOSES as readonly string[]).includes(purpose)) throw new BadRequestException('Choose a valid purpose.');
    const isDepartmental = type === 'INTERNAL' && (Boolean(input.isDepartmental) || !LEAD_ROLES.has(role));
    if (type === 'INTERNAL' && !LEAD_ROLES.has(role) && !isDepartmental) {
      throw new ForbiddenException('Employees can start a departmental meeting only.');
    }

    const ids = [...new Set((input.participantIds ?? []).map(String))].filter((id) => id && id !== userId);
    const people = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, include: { role: true, department: true } })
      : [];
    if (people.length !== ids.length) throw new BadRequestException('One or more selected people are not available.');
    const clientName = type === 'EXTERNAL' ? this.cleanList(input.clientName) : null;
    const guestNames = type === 'CUSTOM' || type === 'EXTERNAL' ? this.cleanList(input.guestNames) : null;

    const sameDept = (p: any) => Boolean(organizer.departmentId) && p.departmentId === organizer.departmentId;
    if (type === 'ONE_ON_ONE') {
      if (people.length !== 1) throw new BadRequestException('A one-on-one meeting has exactly one other person.');
      if (!sameDept(people[0])) throw new BadRequestException('A one-on-one is with someone in your department. Use External or Custom for others.');
    }
    if (type === 'INTERNAL') {
      if (!people.length) throw new BadRequestException('Add at least one person from your department.');
      const outside = people.filter((p) => !sameDept(p) && !(ADMIN_ROLES.has(this.roleOf(p)) && LEAD_ROLES.has(role)));
      if (outside.length) throw new BadRequestException(`${outside.map((p) => p.name).join(', ')} ${outside.length === 1 ? 'is' : 'are'} not in your department.`);
    }
    if (type === 'EXTERNAL' && !people.length && !clientName) throw new BadRequestException('Add people from another department, or a client.');
    if (type === 'CUSTOM' && !people.length && !guestNames) throw new BadRequestException('Add at least one person.');

    const busy = await this.busyUserIds(ids);
    if (busy.size) {
      const names = people.filter((p) => busy.has(p.id)).map((p) => p.name);
      throw new ConflictException(`${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} already in a meeting.`);
    }

    const chain = await this.hierarchy.resolveApproverChainFor(userId);
    const approverIds = await this.resolveApprovers(organizer, type, [organizer, ...people], { ...input, isDepartmental }, chain);
    const approverPeople = approverIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, name: true } })
      : [];
    const now = new Date();
    const counterparty = people[0] ?? organizer;

    const meeting = await this.prisma.meeting.create({
      data: {
        topic: agenda,
        meetingType: type,
        timingMode: 'IMMEDIATE',
        departmentId: organizer.departmentId,
        organizerId: userId,
        organizerNameSnapshot: organizer.name,
        counterpartyId: counterparty.id,
        counterpartyNameSnapshot: counterparty.name,
        visibility: people.length ? 'SHARED' : 'PERSONAL',
        createdByRole: role,
        status: 'IN_PROGRESS',
        requestedAt: now,
        startedAt: now,
        purpose,
        clientName,
        guestNames,
        isDepartmental,
        approverIds,
        approvalStatus: approverIds.length ? 'PENDING' : 'NOT_REQUIRED',
        participants: {
          create: [
            { userId, displayNameSnapshot: organizer.name, status: 'ACCEPTED', respondedAt: now, joinedAt: now },
            ...people.map((p) => ({ userId: p.id, displayNameSnapshot: p.name, status: 'INVITED' })),
          ],
        },
        approvalResponses: approverPeople.length ? {
          create: approverPeople.map((approver) => ({
            approverId: approver.id,
            approverNameSnapshot: approver.name,
            status: 'PENDING',
          })),
        } : undefined,
      },
    });

    try {
      const { breakLog } = await this.workday.startBreak(userId, { breakType: 'MEETING' });
      await this.prisma.breakLog.update({ where: { id: breakLog.id }, data: { meetingId: meeting.id, source: MEETING_V2_SOURCE } });
    } catch (error) {
      await this.prisma.meeting.delete({ where: { id: meeting.id } });
      throw error;
    }

    await Promise.all(people.map((p) => this.notifications.create(
      p.id,
      'Meeting invite',
      `${organizer.name} added you to "${agenda}". Open Apex to join or decline.`,
      NotificationType.INFO,
      '/dashboard',
      meeting.id,
      'Meeting',
    ).catch(() => undefined)));
    await Promise.all(approverIds.map((id) => this.notifications.create(
      id,
      'Meeting started — validation will be needed',
      `${organizer.name} started "${agenda}". You will be asked to validate its recorded time after the meeting ends.`,
      NotificationType.INFO,
      '/dashboard',
      meeting.id,
      'Meeting',
    ).catch(() => undefined)));

    return this.summary(meeting.id, userId);
  }

  /** A meeting as the screens need it, from the viewer's point of view. */
  async summary(meetingId: string, viewerId: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: {
        participants: { include: { user: { select: { id: true, name: true, role: { select: { name: true } } } } } },
        approvalResponses: { select: { approverId: true, approverNameSnapshot: true, status: true, decidedAt: true } },
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found.');
    const approverNames = meeting.approverIds.length
      ? (await this.prisma.user.findMany({ where: { id: { in: meeting.approverIds } }, select: { name: true } })).map((u) => u.name)
      : [];
    return {
      id: meeting.id,
      agenda: meeting.topic,
      type: meeting.meetingType,
      purpose: meeting.purpose,
      isDepartmental: meeting.isDepartmental,
      clientName: meeting.clientName,
      guestNames: meeting.guestNames,
      status: meeting.status,
      approvalStatus: meeting.approvalStatus,
      approverNames,
      approvalResponses: meeting.approvalResponses,
      startedAt: meeting.startedAt,
      endedAt: meeting.endedAt,
      organizer: { id: meeting.organizerId, name: meeting.organizerNameSnapshot },
      isOrganizer: meeting.organizerId === viewerId,
      attendees: meeting.participants.map((p) => ({
        userId: p.userId,
        name: p.displayNameSnapshot,
        role: (p.user as any)?.role?.name ?? null,
        status: p.status,
        joinedAt: p.joinedAt,
        leftAt: p.leftAt,
      })),
    };
  }

  /** The viewer's running meeting, if their work is paused for one. */
  async active(userId: string) {
    const open = await this.prisma.breakLog.findFirst({
      where: { userId, breakType: 'MEETING', endAt: null, meetingId: { not: null } },
      select: { meetingId: true },
      orderBy: { startAt: 'desc' },
    });
    return open?.meetingId ? this.summary(open.meetingId, userId) : null;
  }

  async invites(userId: string) {
    const rows = await this.prisma.meetingParticipant.findMany({
      where: { userId, status: 'INVITED', meeting: { status: 'IN_PROGRESS' } },
      select: { meetingId: true },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(rows.map((row) => this.summary(row.meetingId, userId)));
  }

  async respond(userId: string, meetingId: string, accept: boolean) {
    const participant = await this.prisma.meetingParticipant.findUnique({
      where: { meetingId_userId: { meetingId, userId } },
      include: { meeting: true },
    });
    if (!participant) throw new NotFoundException('You are not invited to this meeting.');
    if (participant.status !== 'INVITED') throw new ConflictException('You have already answered this invite.');
    if (participant.meeting.status !== 'IN_PROGRESS') throw new ConflictException('This meeting has already ended.');
    const now = new Date();

    if (!accept) {
      await this.prisma.meetingParticipant.update({ where: { id: participant.id }, data: { status: 'REJECTED', respondedAt: now } });
      return { joined: false, recorded: false };
    }

    // Joining pauses work the same way the organizer's did. Someone on a
    // normal break ends it first; someone who has not started work is marked
    // as attending but no time is recorded for them.
    const session = await this.prisma.workSession.findFirst({
      where: { userId, logoutAt: null, status: { in: ['WORKING', 'ON_BREAK', 'IDLE'] } },
      orderBy: { createdAt: 'desc' },
      include: { breakLogs: { where: { endAt: null } } },
    });
    if (session?.breakLogs.some((b) => b.breakType === 'MEETING')) throw new ConflictException('You are already in a meeting.');
    if (session?.status === 'ON_BREAK') await this.workday.endBreak(userId, 'MEETING_JOIN');

    if (!session) {
      await this.prisma.meetingParticipant.update({ where: { id: participant.id }, data: { status: 'ACCEPTED', respondedAt: now } });
      return { joined: true, recorded: false };
    }
    const { breakLog } = await this.workday.startBreak(userId, { breakType: 'MEETING' });
    await this.prisma.$transaction([
      this.prisma.breakLog.update({ where: { id: breakLog.id }, data: { meetingId, source: MEETING_V2_SOURCE } }),
      this.prisma.meetingParticipant.update({ where: { id: participant.id }, data: { status: 'ACCEPTED', respondedAt: now, joinedAt: now } }),
    ]);
    return { joined: true, recorded: true };
  }

  /** "Resume work": ends the meeting for the viewer only. */
  async leave(userId: string, meetingId: string) {
    const open = await this.prisma.breakLog.findFirst({ where: { userId, meetingId, breakType: 'MEETING', endAt: null } });
    if (!open) throw new ConflictException('You are not in this meeting.');
    const result = await this.workday.endBreak(userId, 'MEETING_LEAVE');
    await this.prisma.meetingParticipant.updateMany({ where: { meetingId, userId }, data: { status: 'LEFT', leftAt: new Date() } });
    await this.completeIfEmpty(meetingId);
    return result;
  }

  /** The last joined attendee leaving completes the meeting and asks for approval. */
  private async completeIfEmpty(meetingId: string) {
    const stillIn = await this.prisma.breakLog.count({ where: { meetingId, breakType: 'MEETING', endAt: null } });
    if (stillIn > 0) return;
    const now = new Date();
    const meeting = await this.prisma.meeting.update({
      where: { id: meetingId },
      data: { status: 'COMPLETED', endedAt: now },
    });
    await this.prisma.meetingParticipant.updateMany({ where: { meetingId, status: 'INVITED' }, data: { status: 'REJECTED', respondedAt: now } });
    if (meeting.approvalStatus === 'PENDING') {
      await Promise.all(meeting.approverIds.map((id) => this.notifications.create(
        id,
        'Meeting waiting for your approval',
        `${meeting.organizerNameSnapshot}'s meeting "${meeting.topic}" has ended. Approve or reject it in Apex.`,
        NotificationType.INFO,
        '/dashboard',
        meeting.id,
        'Meeting',
      ).catch(() => undefined)));
    }
  }

  /** The organizer says the meeting never happened: nothing is recorded for anyone. */
  async cancel(userId: string, meetingId: string) {
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) throw new NotFoundException('Meeting not found.');
    if (meeting.organizerId !== userId) throw new ForbiddenException('Only the person who started the meeting can cancel it.');
    if (meeting.status !== 'IN_PROGRESS') throw new ConflictException('This meeting has already ended.');
    const open = await this.prisma.breakLog.findMany({ where: { meetingId, breakType: 'MEETING', endAt: null }, select: { userId: true } });
    for (const row of open) await this.workday.endBreak(row.userId, 'MEETING_CANCEL');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.breakLog.updateMany({ where: { meetingId }, data: { source: MEETING_CANCELLED_SOURCE } }),
      this.prisma.meetingParticipant.updateMany({ where: { meetingId, status: 'INVITED' }, data: { status: 'REJECTED', respondedAt: now } }),
      this.prisma.meeting.update({ where: { id: meetingId }, data: { status: 'CANCELLED', endedAt: now, approvalStatus: 'NOT_REQUIRED' } }),
    ]);
    return { cancelled: true };
  }

  async approvals(userId: string) {
    const rows = await this.prisma.meeting.findMany({
      where: {
        approvalStatus: 'PENDING',
        status: 'COMPLETED',
        OR: [
          { approvalResponses: { some: { approverId: userId, status: 'PENDING' } } },
          // Compatibility for meetings created before the response ledger.
          { approvalResponses: { none: {} }, approverIds: { has: userId } },
        ],
      },
      select: { id: true },
      orderBy: { endedAt: 'asc' },
      take: 50,
    });
    return Promise.all(rows.map((row) => this.summary(row.id, userId)));
  }

  async decide(userId: string, meetingId: string, approve: boolean) {
    const meeting = await this.prisma.meeting.findUnique({ where: { id: meetingId } });
    if (!meeting) throw new NotFoundException('Meeting not found.');
    if (!meeting.approverIds.includes(userId)) throw new ForbiddenException('You are not an approver for this meeting.');
    if (meeting.approvalStatus !== 'PENDING' || meeting.status !== 'COMPLETED') throw new ConflictException('This meeting has already been decided.');
    const response = await this.prisma.meetingApprovalResponse.findUnique({
      where: { meetingId_approverId: { meetingId, approverId: userId } },
    });
    let finalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
    if (!response) {
      // Compatibility for meetings created before the per-approver ledger.
      const decided = await this.prisma.meeting.updateMany({
        where: { id: meetingId, approvalStatus: 'PENDING' },
        data: { approvalStatus: approve ? 'APPROVED' : 'REJECTED', decidedById: userId, decidedAt: new Date() },
      });
      if (decided.count === 0) throw new ConflictException('This meeting has already been decided.');
      finalStatus = approve ? 'APPROVED' : 'REJECTED';
    } else {
      if (response.status !== 'PENDING') throw new ConflictException('You have already decided this meeting.');
      finalStatus = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.meetingApprovalResponse.updateMany({
          where: { id: response.id, status: 'PENDING' },
          data: { status: approve ? 'APPROVED' : 'REJECTED', decidedAt: new Date() },
        });
        if (changed.count === 0) throw new ConflictException('You have already decided this meeting.');
        if (!approve) {
          await tx.meeting.update({ where: { id: meetingId }, data: { approvalStatus: 'REJECTED', decidedById: userId, decidedAt: new Date() } });
          return 'REJECTED' as const;
        }
        const remaining = await tx.meetingApprovalResponse.count({ where: { meetingId, status: 'PENDING' } });
        if (remaining > 0) return 'PENDING' as const;
        await tx.meeting.update({ where: { id: meetingId }, data: { approvalStatus: 'APPROVED', decidedById: userId, decidedAt: new Date() } });
        return 'APPROVED' as const;
      });
    }
    await this.notifications.create(
      meeting.organizerId,
      finalStatus === 'PENDING' ? 'Meeting approval received' : finalStatus === 'APPROVED' ? 'Meeting approved' : 'Meeting rejected',
      finalStatus === 'PENDING'
        ? `One approval was received for "${meeting.topic}". Other department approvals are still pending.`
        : `"${meeting.topic}" was ${finalStatus.toLowerCase()}.`,
      finalStatus === 'REJECTED' ? NotificationType.WARNING : NotificationType.SUCCESS,
      '/dashboard',
      meeting.id,
      'Meeting',
    ).catch(() => undefined);
    return { approvalStatus: finalStatus };
  }
}
