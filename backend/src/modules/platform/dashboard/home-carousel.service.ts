import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DailyAttendanceEvaluationState, DailyAttendanceStatus, NotificationType, TicketStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { TicketAccessService } from '../../../common/services/ticket-access.service';
import { TVAService } from '../../../common/services/tva.service';
import { NotificationEventService } from '../../operations/notifications/notification-event.service';

const SETTINGS_KEY = 'home_announcements_v1';
const ROLES = ['INTERN', 'EMPLOYEE', 'TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'];
const PRIORITIES = ['GENERAL', 'IMPORTANT', 'CRITICAL'];
export type Announcement = {
  id: string;
  title: string;
  body: string;
  priority: 'GENERAL' | 'IMPORTANT' | 'CRITICAL';
  audience: 'COMPANY' | 'ROLE' | 'DEPARTMENT';
  targetIds: string[];
  startsAt: string;
  endsAt: string | null;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  creatorName?: string;
};

@Injectable()
export class HomeCarouselService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
    private readonly ticketAccess: TicketAccessService,
    private readonly tva: TVAService,
    private readonly notifications: NotificationEventService,
  ) {}

  private async announcements(): Promise<Announcement[]> {
    const setting = await this.prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
    return Array.isArray(setting?.value)
      ? (setting.value as unknown[]).filter((item): item is Announcement =>
          Boolean(item && typeof item === 'object' && typeof (item as Announcement).title === 'string' &&
            typeof (item as Announcement).body === 'string' && Array.isArray((item as Announcement).targetIds) &&
            typeof (item as Announcement).startsAt === 'string'))
      : [];
  }

  private visibleTo(item: Announcement, user: any): boolean {
    if (item.audience === 'COMPANY') return true;
    if (item.audience === 'ROLE') return item.targetIds.includes(this.access.roleName(user));
    return Boolean(user.departmentId && item.targetIds.includes(user.departmentId));
  }

  private expiresAt(item: Announcement): Date {
    // Legacy records sometimes had no end. Treat those as 24-hour notices too
    // so no announcement can remain live indefinitely.
    return item.endsAt
      ? new Date(item.endsAt)
      : new Date(new Date(item.startsAt).getTime() + 24 * 60 * 60 * 1000);
  }

  private isLive(item: Announcement, now: Date): boolean {
    return item.active && new Date(item.startsAt) <= now && this.expiresAt(item) > now;
  }

  async getCarousel(user: any) {
    const now = this.tva.now();
    const [announcements, spotlight, recognition] = await Promise.all([
      this.announcements(),
      this.getPunctualitySpotlight(user),
      this.getRecognition(user, now),
    ]);
    const visible = announcements.filter((item) => this.isLive(item, now) && this.visibleTo(item, user))
      .sort((a, b) => Number(b.priority === 'IMPORTANT') - Number(a.priority === 'IMPORTANT') ||
      new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());

    return {
      announcements: visible,
      announcement: visible.find((item) => item.priority !== 'CRITICAL') ?? null,
      criticalAnnouncements: visible.filter((item) => item.priority === 'CRITICAL'),
      spotlight,
      recognition,
    };
  }

  /** Lightweight feed for the app-wide blocking announcement guard. */
  async getCurrentAnnouncements(user: any) {
    const now = this.tva.now();
    return (await this.announcements())
      .filter((item) => this.isLive(item, now) && this.visibleTo(item, user))
      .sort((a, b) => new Date(b.updatedAt ?? b.startsAt).getTime() - new Date(a.updatedAt ?? a.startsAt).getTime());
  }

  private canManageAnnouncements(user: any): boolean {
    return Boolean(user?.isHR) || ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(this.access.roleName(user));
  }

  private assertCanManage(user: any) {
    if (!this.canManageAnnouncements(user)) {
      throw new ForbiddenException('HR, Manager, Admin or Super Admin access required');
    }
  }

  private validateAnnouncementInput(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Invalid announcement');
    const item = input as Record<string, unknown>;
    if (Object.keys(item).some((key) => !['title', 'body', 'priority', 'audience', 'targetIds'].includes(key))) {
      throw new BadRequestException('Unknown announcement field');
    }
    if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 140 ||
        typeof item.body !== 'string' || !item.body.trim() || item.body.length > 2000 ||
        !PRIORITIES.includes(String(item.priority ?? 'GENERAL')) ||
        !['COMPANY', 'ROLE', 'DEPARTMENT'].includes(String(item.audience ?? 'COMPANY')) ||
        !Array.isArray(item.targetIds ?? []) || (item.targetIds as unknown[]).length > 30 ||
        (item.targetIds as unknown[]).some((target) => typeof target !== 'string')) {
      throw new BadRequestException('Invalid announcement fields');
    }
    const audience = String(item.audience ?? 'COMPANY') as Announcement['audience'];
    const targets = [...new Set((item.targetIds ?? []) as string[])];
    if ((audience === 'COMPANY' && targets.length) || (audience !== 'COMPANY' && !targets.length) ||
        (audience === 'ROLE' && targets.some((target) => !ROLES.includes(target)))) {
      throw new BadRequestException('Invalid announcement audience');
    }
    return { title: item.title.trim(), body: item.body.trim(), priority: String(item.priority ?? 'GENERAL') as Announcement['priority'], audience, targetIds: targets };
  }

  private async assertDepartmentTargets(audience: Announcement['audience'], targets: string[]) {
    if (audience !== 'DEPARTMENT') return;
    const count = await this.prisma.department.count({ where: { id: { in: targets } } });
    if (count !== targets.length) throw new BadRequestException('Unknown department target');
  }

  private async saveAnnouncements(announcements: Announcement[], userId: string) {
    // Keep current and historical announcements together. The bounded history
    // prevents this settings document from growing forever.
    const bounded = announcements
      .sort((a, b) => new Date(b.createdAt ?? b.startsAt).getTime() - new Date(a.createdAt ?? a.startsAt).getTime())
      .slice(0, 250);
    await this.prisma.appSetting.upsert({ where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value: bounded, updatedBy: userId },
      update: { value: bounded, updatedBy: userId } });
  }

  private async notifyAudience(item: Announcement) {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true,
        isSystemAccount: false,
        ...(item.audience === 'ROLE' ? { role: { name: { in: item.targetIds as any } } } : {}),
        ...(item.audience === 'DEPARTMENT' ? { departmentId: { in: item.targetIds } } : {}),
      },
      select: { id: true },
    });
    // Publishing must not become a duplicate-prone failure if one recipient's
    // optional push channel is unavailable. Each durable notification is
    // independently deduplicated by user + announcement revision.
    await Promise.allSettled(users.map(({ id }) => this.notifications.sendNotification(id, 'announcement', {
      title: item.title,
      message: item.body,
      type: item.priority === 'CRITICAL' ? NotificationType.ERROR : item.priority === 'IMPORTANT' ? NotificationType.WARNING : NotificationType.INFO,
      link: '/dashboard',
      entityId: item.id,
      entityType: 'announcement',
      dedupeKey: `announcement:${item.id}:${item.updatedAt}`,
    })));
  }

  async createAnnouncement(user: any, input: unknown) {
    this.assertCanManage(user);
    const value = this.validateAnnouncementInput(input);
    await this.assertDepartmentTargets(value.audience, value.targetIds);
    const now = this.tva.now();
    const item: Announcement = {
      id: randomUUID(), ...value, active: true,
      startsAt: now.toISOString(),
      endsAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
      createdBy: user.id, creatorName: user.name ?? 'Apex OS',
    };
    await this.saveAnnouncements([item, ...(await this.announcements())], user.id);
    await this.notifyAudience(item);
    return item;
  }

  async updateAnnouncement(user: any, id: string, input: unknown) {
    this.assertCanManage(user);
    const value = this.validateAnnouncementInput(input);
    await this.assertDepartmentTargets(value.audience, value.targetIds);
    const announcements = await this.announcements();
    const index = announcements.findIndex((item) => item.id === id);
    if (index < 0) throw new NotFoundException('Announcement not found');
    const existing = announcements[index];
    const now = this.tva.now();
    if (!this.isLive(existing, now)) {
      throw new BadRequestException('Only a current announcement can be edited');
    }
    const updated: Announcement = { ...existing, ...value, updatedAt: now.toISOString() };
    announcements[index] = updated;
    await this.saveAnnouncements(announcements, user.id);
    await this.notifyAudience(updated);
    return updated;
  }

  async getAnnouncementHistory(user: any) {
    this.assertCanManage(user);
    const now = this.tva.now();
    return (await this.announcements())
      .filter((item) => !this.isLive(item, now))
      .sort((a, b) => new Date(b.createdAt ?? b.startsAt).getTime() - new Date(a.createdAt ?? a.startsAt).getTime());
  }

  private async getRecognition(user: any, now: Date) {
    const scope = await this.ticketAccess.buildTicketWhereForUser({}, user);
    const tickets = await this.prisma.ticket.findMany({
      where: {
        AND: [
          scope,
          { status: { in: [TicketStatus.DONE, TicketStatus.CLOSED] } },
          { resolvedAt: { gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) } },
        ],
      },
      select: { id: true, ticketId: true, title: true, resolvedAt: true, assignedTo: { select: { name: true } } },
      orderBy: { resolvedAt: 'desc' },
      take: 5,
    });
    return tickets.map((ticket) => ({
      id: ticket.id,
      person: ticket.assignedTo?.name ?? 'Team member',
      title: ticket.title,
      ticketId: ticket.ticketId,
      date: ticket.resolvedAt,
      url: `/tickets/${ticket.id}`,
    }));
  }

  /** The current company week, Monday through the last completed business day. */
  private async getPunctualitySpotlight(user: any) {
    const today = this.tva.companyToday();
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const monday = new Date(todayDate);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const end = new Date(todayDate);
    end.setUTCDate(end.getUTCDate() - 1);
    const weekStart = monday.toISOString().slice(0, 10);
    if (end < monday) return { weekStart, leaders: [], basis: 'FINALIZED_ATTENDANCE' };

    const visibleIds = await this.ticketAccess.visibleUserIdsForWorkload(user);
    const rows = await this.prisma.dailyAttendance.findMany({
      where: {
        date: { gte: monday, lte: end },
        evaluationState: DailyAttendanceEvaluationState.FINALIZED,
        user: { isActive: true, ...(visibleIds ? { id: { in: visibleIds } } : {}) },
      },
      select: { userId: true, status: true, exceptionFlags: true, attendancePolicyId: true,
        user: { select: { name: true } } },
    });
    const byUser = new Map<string, { id: string; name: string; onTime: number; eligible: number }>();
    for (const row of rows) {
      // Approved leave, holidays, weekly offs, exemptions and unresolved evidence
      // are neutral. Only finalized scheduled workdays count in the denominator.
      if (row.exceptionFlags.length || !row.attendancePolicyId ||
          (row.status !== DailyAttendanceStatus.PRESENT && row.status !== DailyAttendanceStatus.LATE)) continue;
      const person = byUser.get(row.userId) ?? { id: row.userId, name: row.user.name, onTime: 0, eligible: 0 };
      person.eligible += 1;
      if (row.status === DailyAttendanceStatus.PRESENT) person.onTime += 1;
      byUser.set(row.userId, person);
    }
    const leaders = [...byUser.values()]
      .filter((person) => person.eligible >= 2 && person.onTime > 0)
      .sort((a, b) => b.onTime / b.eligible - a.onTime / a.eligible || b.onTime - a.onTime || a.name.localeCompare(b.name))
      .slice(0, 5)
      .map((person) => ({ ...person, rate: Math.round(person.onTime / person.eligible * 100) }));
    return { weekStart, leaders, basis: 'FINALIZED_ATTENDANCE' };
  }

  /** Admin-only publishing boundary. Replaces a bounded, validated announcement set. */
  async publishAnnouncements(user: any, input: unknown) {
    this.assertCanManage(user);
    if (!Array.isArray(input) || input.length > 50) throw new BadRequestException('Expected up to 50 announcements');
    const announcements: Announcement[] = [];
    const ids = new Set<string>();
    for (const entry of input) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new BadRequestException('Invalid announcement');
      const item = entry as Record<string, unknown>;
      if (Object.keys(item).some((key) => !['id', 'title', 'body', 'priority', 'audience', 'targetIds', 'startsAt', 'endsAt', 'active'].includes(key))) {
        throw new BadRequestException('Unknown announcement field');
      }
      const id = typeof item.id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(item.id) ? item.id : randomUUID();
      if (ids.has(id) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 140 ||
          typeof item.body !== 'string' || !item.body.trim() || item.body.length > 2000 ||
          !PRIORITIES.includes(String(item.priority)) || !['COMPANY', 'ROLE', 'DEPARTMENT'].includes(String(item.audience)) ||
          !Array.isArray(item.targetIds) || item.targetIds.length > 30 || item.targetIds.some((target) => typeof target !== 'string') ||
          typeof item.active !== 'boolean' || typeof item.startsAt !== 'string' || !Number.isFinite(Date.parse(item.startsAt)) ||
          (item.endsAt !== null && (typeof item.endsAt !== 'string' || !Number.isFinite(Date.parse(item.endsAt))))) {
        throw new BadRequestException('Invalid announcement fields');
      }
      const targets = item.targetIds as string[];
      if ((item.audience === 'COMPANY' && targets.length > 0) ||
          (item.audience !== 'COMPANY' && targets.length === 0) ||
          (item.audience === 'ROLE' && targets.some((target) => !ROLES.includes(target))) ||
          (item.endsAt && new Date(item.endsAt as string) <= new Date(item.startsAt))) {
        throw new BadRequestException('Invalid audience or publishing period');
      }
      if (item.audience === 'DEPARTMENT') {
        const count = await this.prisma.department.count({ where: { id: { in: targets } } });
        if (count !== new Set(targets).size) throw new BadRequestException('Unknown department target');
      }
      ids.add(id);
      announcements.push({ id, title: item.title.trim(), body: item.body.trim(),
        priority: item.priority as Announcement['priority'], audience: item.audience as Announcement['audience'],
        targetIds: [...new Set(targets)], startsAt: new Date(item.startsAt).toISOString(),
        endsAt: item.endsAt ? new Date(item.endsAt as string).toISOString() : null, active: item.active });
    }
    await this.prisma.appSetting.upsert({ where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value: announcements, updatedBy: user.id },
      update: { value: announcements, updatedBy: user.id } });
    return { count: announcements.length };
  }
}
