import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DailyAttendanceEvaluationState, DailyAttendanceStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessPolicyService } from '../../../common/services/access-policy.service';
import { TicketAccessService } from '../../../common/services/ticket-access.service';
import { TVAService } from '../../../common/services/tva.service';

const SETTINGS_KEY = 'home_announcements_v1';
const ROLES = ['INTERN', 'EMPLOYEE', 'TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'];
const PRIORITIES = ['GENERAL', 'IMPORTANT', 'CRITICAL'];
type Announcement = {
  id: string;
  title: string;
  body: string;
  priority: 'GENERAL' | 'IMPORTANT' | 'CRITICAL';
  audience: 'COMPANY' | 'ROLE' | 'DEPARTMENT';
  targetIds: string[];
  startsAt: string;
  endsAt: string | null;
  active: boolean;
};

@Injectable()
export class HomeCarouselService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessPolicyService,
    private readonly ticketAccess: TicketAccessService,
    private readonly tva: TVAService,
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

  async getCarousel(user: any) {
    const now = this.tva.now();
    const visible = (await this.announcements()).filter((item) =>
      item.active && this.visibleTo(item, user) &&
      new Date(item.startsAt) <= now && (!item.endsAt || new Date(item.endsAt) >= now),
    ).sort((a, b) => Number(b.priority === 'IMPORTANT') - Number(a.priority === 'IMPORTANT') ||
      new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());

    return {
      announcement: visible.find((item) => item.priority !== 'CRITICAL') ?? null,
      criticalAnnouncements: visible.filter((item) => item.priority === 'CRITICAL'),
      spotlight: await this.getPunctualitySpotlight(user),
    };
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
    if (!this.access.isAdmin(user)) throw new ForbiddenException('Administrator access required');
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
