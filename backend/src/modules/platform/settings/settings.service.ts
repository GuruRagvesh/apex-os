import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';

// ── Default values ────────────────────────────────────────────────────────────
const DEFAULTS: Record<string, any> = {
  company: {
    companyName: 'TechnoEdge Learning Services',
    tagline: '',
    contactEmail: '',
    workingDays: 'Mon-Sat',
  },
  leave_policy: {
    quotas: { EMPLOYEE: 12, TEAM_LEAD: 12, MANAGER: 15, INTERN: 6 },
    workingDays: 'Mon–Sat',
  },
  // Attendance V2 (PE-1). Every flag defaults OFF: the punch pipeline must be
  // enabled deliberately, never by deploying code.
  attendance_v2: {
    punchEvidenceEnabled: false,
    // LH-1. Makes the attendance foundation the authority for leave duration
    // and paid-leave allocation. Off means the legacy leave rules answer.
    leaveAuthorityEnabled: false,
    // LH-2. Manager -> HR approval chain with funding settlement at final
    // approval. Off keeps today's single-approver behaviour.
    leaveApprovalEnabled: false,
  },
  sla: { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 },
  review_sla: { URGENT: 2, HIGH: 4, MEDIUM: 24, LOW: 48 },
  smtp: { host: '', port: '587', email: '', password: '' },
  workday_policy: {
    timezone: 'Asia/Kolkata',
    minimumWorkdayMinutes: 540,
    employeeTiming: { start: '09:30', end: '18:30', flexible: false },
    tlTiming: { entryStart: '09:30', entryEnd: '10:30', exitStart: '18:30', exitEnd: '19:30', minimumWorkdayMinutes: 540 },
    managerTiming: { flexible: true },
    autoClose: true,
    autoCloseTime: '23:59',
  }
};

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private eventLogger: EventLoggerService,
  ) {}

  async get(key: string): Promise<any> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    if (!row) return DEFAULTS[key] ?? {};
    
    if (key === 'workday_policy') {
      return { ...DEFAULTS[key], ...(row.value as any) };
    }
    return row.value as any;
  }

  async set(key: string, value: any, updatedBy?: string): Promise<any> {
    const saved = await this.prisma.appSetting.upsert({
      where: { key },
      create: { key, value, updatedBy },
      update: { value, updatedBy },
    });
    if (updatedBy) {
      this.eventLogger.log({
        actorId: updatedBy,
        entityType: 'Setting',
        entityId: key,
        action: OperationalAction.SETTINGS_UPDATED,
        metadata: { key },
      }).catch(() => {});
    }
    return saved.value;
  }

  // ── Convenience getters used by other services (e.g. SLA hours in tickets) ──

  async getCompanyWithTheme(): Promise<any> {
    const company = await this.get('company');
    const themeRaw = await this.prisma.appSetting.findFirst({ where: { key: 'theme_defaults' } });
    const parsed = themeRaw?.value ? JSON.parse(themeRaw.value as string) : {};
    return {
      ...company,
      defaultTheme: parsed.theme || 'technoedge-light',
      defaultAccent: parsed.accent || 'royal-blue',
    };
  }

  async upsertThemeDefaults(theme?: string, accent?: string): Promise<void> {
    const current = await this.prisma.appSetting.findFirst({ where: { key: 'theme_defaults' } });
    const currentVal = current?.value ? JSON.parse(current.value as string) : {};
    const newVal = {
      theme: theme || currentVal.theme || 'technoedge-light',
      accent: accent || currentVal.accent || 'royal-blue',
    };
    await this.prisma.appSetting.upsert({
      where: { key: 'theme_defaults' },
      update: { value: JSON.stringify(newVal) },
      create: { key: 'theme_defaults', value: JSON.stringify(newVal) },
    });
  }

  async getSlaHours(): Promise<Record<string, number>> {
    const stored = await this.get('sla');
    return { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72, ...stored };
  }

  async getReviewSlaHours(): Promise<Record<string, number>> {
    const stored = await this.get('review_sla');
    return { URGENT: 2, HIGH: 4, MEDIUM: 24, LOW: 48, ...stored };
  }

  async getLeaveQuotas(): Promise<Record<string, number>> {
    const stored = await this.get('leave_policy');
    return { EMPLOYEE: 12, TEAM_LEAD: 12, MANAGER: 15, INTERN: 6, ...(stored?.quotas ?? {}) };
  }

  async getWorkdayPolicy(): Promise<any> {
    return this.get('workday_policy');
  }

  async updateWorkdayPolicy(data: any, updatedBy?: string): Promise<any> {
    return this.set('workday_policy', data, updatedBy);
  }
}
