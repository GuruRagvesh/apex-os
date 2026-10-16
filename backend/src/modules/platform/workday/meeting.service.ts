import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';

const SHARED_MEETING_ROLES = new Set(['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']);
const MEETING_TYPES = new Set(['SELF', 'INTERNAL', 'EXTERNAL', 'REVIEW', 'ONE_ON_ONE']);
const MATCH_TOLERANCE_MS = 2 * 60 * 1000;

export interface ClassifyMeetingInput {
  breakLogId: string;
  mode: 'NEW' | 'EXISTING';
  counterpartyId: string;
  meetingCode?: string;
  topic?: string;
  meetingType?: string;
  endedAt?: string;
}

@Injectable()
export class MeetingService {
  constructor(private readonly prisma: PrismaService) {}

  private async actor(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true, department: true },
    });
    if (!user || !user.isActive) throw new ForbiddenException('Your account is not active.');
    return user;
  }

  private roleName(user: any) {
    return String(user?.role?.name ?? '').toUpperCase();
  }

  private userShape(user: any) {
    return {
      id: user.id,
      name: user.name,
      departmentId: user.departmentId,
      department: user.department ? { id: user.department.id, name: user.department.name } : null,
      role: user.role ? { name: user.role.name } : null,
    };
  }

  private meetingInclude() {
    return {
      organizer: { select: { id: true, name: true } },
      counterparty: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      participants: { include: { user: { select: { id: true, name: true, departmentId: true } } } },
      breakLogs: { select: { id: true, userId: true, startAt: true, endAt: true, durationMinutes: true } },
    } as const;
  }

  private presentMeeting(meeting: any) {
    if (!meeting) return meeting;
    return {
      ...meeting,
      organizer: {
        ...(meeting.organizer ?? {}),
        name: meeting.organizerNameSnapshot,
      },
      counterparty: {
        ...(meeting.counterparty ?? {}),
        name: meeting.counterpartyNameSnapshot,
      },
      participants: (meeting.participants ?? []).map((participant: any) => ({
        ...participant,
        user: {
          ...(participant.user ?? {}),
          name: participant.displayNameSnapshot,
        },
      })),
    };
  }

  async options(userId: string) {
    const actor = await this.actor(userId);
    const role = this.roleName(actor);
    const people = await this.prisma.user.findMany({
      where: { isActive: true, id: { not: userId } },
      include: { role: true, department: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
    return {
      currentUser: this.userShape(actor),
      role,
      canCreateSharedMeeting: SHARED_MEETING_ROLES.has(role),
      people: people.map((person) => this.userShape(person)),
    };
  }

  async list(userId: string) {
    const meetings = await this.prisma.meeting.findMany({
      where: {
        OR: [
          { organizerId: userId },
          { AND: [{ visibility: 'SHARED' }, { counterpartyId: userId }] },
          { participants: { some: { userId } } },
          { breakLogs: { some: { userId } } },
        ],
      },
      include: this.meetingInclude(),
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return meetings.map((meeting) => this.presentMeeting(meeting));
  }

  async pendingClassification(userId: string) {
    return this.prisma.breakLog.findFirst({
      where: {
        userId,
        breakType: 'MEETING',
        source: 'MEETING_UNCLASSIFIED',
        endAt: { not: null },
        meetingId: null,
      },
      orderBy: { endAt: 'desc' },
      select: { id: true, startAt: true, endAt: true, durationMinutes: true },
    });
  }

  async lookup(userId: string, rawCode: string) {
    await this.actor(userId);
    const meetingCode = this.normalizeCode(rawCode);
    const meeting = await this.prisma.meeting.findUnique({
      where: { meetingCode },
      include: this.meetingInclude(),
    });
    if (!meeting || meeting.visibility !== 'SHARED') throw new NotFoundException('That meeting ID does not exist.');
    return this.presentMeeting(meeting);
  }

  private normalizeCode(value?: string) {
    const code = String(value ?? '').trim().toUpperCase();
    if (!/^MTG-[A-Z0-9]{8}$/.test(code)) throw new BadRequestException('Enter a valid meeting ID.');
    return code;
  }

  private normalizeEnd(startAt: Date, capturedEnd: Date, value?: string) {
    if (!value) return capturedEnd;
    const requested = new Date(value);
    if (Number.isNaN(requested.getTime())) throw new BadRequestException('Enter a valid meeting end time.');
    if (requested.getTime() < startAt.getTime() || requested.getTime() > capturedEnd.getTime() + MATCH_TOLERANCE_MS) {
      throw new BadRequestException('The meeting end time must fall within the captured meeting timer.');
    }
    return requested;
  }

  private async capturedBreak(userId: string, breakLogId: string) {
    const breakLog = await this.prisma.breakLog.findFirst({
      where: { id: breakLogId, userId, breakType: 'MEETING' },
    });
    if (!breakLog) throw new NotFoundException('The captured meeting timer was not found.');
    if (!breakLog.endAt) throw new ConflictException('Resume work before recording the meeting details.');
    if (breakLog.meetingId) throw new ConflictException('This meeting timer has already been recorded.');
    return breakLog;
  }

  async classify(userId: string, input: ClassifyMeetingInput) {
    const actor = await this.actor(userId);
    const role = this.roleName(actor);
    const breakLog = await this.capturedBreak(userId, String(input.breakLogId ?? ''));
    const mode = String(input.mode ?? '').toUpperCase();
    if (mode !== 'NEW' && mode !== 'EXISTING') throw new BadRequestException('Choose new meeting or existing meeting.');
    if (!input.counterpartyId || input.counterpartyId === userId) {
      throw new BadRequestException('Select the person you met with.');
    }
    const counterparty = await this.prisma.user.findFirst({
      where: { id: input.counterpartyId, isActive: true },
    });
    if (!counterparty) throw new BadRequestException('The selected person is unavailable.');

    const capturedEnd = breakLog.endAt!;
    const endedAt = this.normalizeEnd(breakLog.startAt, capturedEnd, input.endedAt);
    const durationMinutes = Math.max(0, Math.floor((endedAt.getTime() - breakLog.startAt.getTime()) / 60_000));

    if (mode === 'EXISTING') {
      const meetingCode = this.normalizeCode(input.meetingCode);
      const meeting = await this.prisma.meeting.findUnique({
        where: { meetingCode },
        include: { participants: true },
      });
      if (!meeting || meeting.visibility !== 'SHARED' || !meeting.startedAt || !meeting.endedAt) {
        throw new NotFoundException('That shared meeting ID does not exist.');
      }
      const knownPeople = new Set([meeting.organizerId, meeting.counterpartyId, ...meeting.participants.map((p) => p.userId)]);
      if (!knownPeople.has(input.counterpartyId)) {
        throw new BadRequestException('The selected person does not match this meeting ID.');
      }
      const startMatches = Math.abs(breakLog.startAt.getTime() - meeting.startedAt.getTime()) <= MATCH_TOLERANCE_MS;
      const endMatches = Math.abs(endedAt.getTime() - meeting.endedAt.getTime()) <= MATCH_TOLERANCE_MS;
      if (!startMatches || !endMatches) {
        throw new BadRequestException('The captured time does not match this meeting ID (2 minute tolerance).');
      }

      return this.prisma.$transaction(async (tx) => {
        await tx.meetingParticipant.upsert({
          where: { meetingId_userId: { meetingId: meeting.id, userId } },
          update: {},
          create: { meetingId: meeting.id, userId, displayNameSnapshot: actor.name },
        });
        await tx.breakLog.update({
          where: { id: breakLog.id },
          data: { meetingId: meeting.id, endAt: endedAt, durationMinutes, source: 'MEETING_ID_VERIFIED' },
        });
        const saved = await tx.meeting.findUnique({ where: { id: meeting.id }, include: this.meetingInclude() });
        return this.presentMeeting(saved);
      });
    }

    const topic = String(input.topic ?? '').trim();
    const meetingType = String(input.meetingType ?? '').toUpperCase();
    if (topic.length < 3 || topic.length > 200) throw new BadRequestException('Meeting topic must be 3 to 200 characters.');
    if (!MEETING_TYPES.has(meetingType)) throw new BadRequestException('Select a valid meeting type.');
    const shared = SHARED_MEETING_ROLES.has(role);
    const meetingCode = shared ? `MTG-${randomBytes(4).toString('hex').toUpperCase()}` : null;

    return this.prisma.$transaction(async (tx) => {
      const meeting = await tx.meeting.create({
        data: {
          topic,
          meetingType,
          timingMode: 'IMMEDIATE',
          departmentId: actor.departmentId,
          organizerId: userId,
          organizerNameSnapshot: actor.name,
          counterpartyId: counterparty.id,
          counterpartyNameSnapshot: counterparty.name,
          meetingCode,
          visibility: shared ? 'SHARED' : 'PERSONAL',
          createdByRole: role,
          status: 'COMPLETED',
          requestedAt: breakLog.startAt,
          startedAt: breakLog.startAt,
          endedAt,
          plannedMinutes: durationMinutes || 1,
          participants: {
            create: shared
              ? [
                  { userId, displayNameSnapshot: actor.name },
                  { userId: counterparty.id, displayNameSnapshot: counterparty.name },
                ]
              : [{ userId, displayNameSnapshot: actor.name }],
          },
        },
      });
      await tx.breakLog.update({
        where: { id: breakLog.id },
        data: { meetingId: meeting.id, endAt: endedAt, durationMinutes, source: shared ? 'MEETING_ID_CREATED' : 'PERSONAL_MEETING' },
      });
      const saved = await tx.meeting.findUnique({ where: { id: meeting.id }, include: this.meetingInclude() });
      return this.presentMeeting(saved);
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  // Meeting capture is driven entirely by each user's timer, so there is
  // nothing for the scheduler to do until scheduled capture is implemented.
  async processSchedule() {
    return undefined;
  }
}
