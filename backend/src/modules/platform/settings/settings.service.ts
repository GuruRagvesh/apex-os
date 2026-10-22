import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EventLoggerService, OperationalAction } from '../../../common/services/event-logger.service';
import {
  GOVERNING_POLICY_STATUSES,
  POLICY_BASELINE_DATE,
  resolveContinuousPolicy,
} from '../attendance/policy/policy-continuity';

// ── Default values ────────────────────────────────────────────────────────────
const DEFAULTS: Record<string, any> = {
  company: {
    companyName: 'TechnoEdge Learning Services',
    logoUrl: '/brand/technoedge-logo.png',
    contactEmail: 'hr@technoedgels.com',
    website: 'https://www.technoedgels.com/',
    country: 'India',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    registeredOffice: 'Office No. B-2/201,\nUmang Premiere,\nG.No.677, 687(P), 6 Tal-Haveli,\nDist-Pune, Wagholi-412207,\nMaharashtra, India',
    headOffice: 'Baner Biz Bay,\nOffice No. B-704, B-705 & B-706,\n7th Floor, Laxman Nagar,\nBaner, Pune - 411045,\nMaharashtra, India',
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
    // AR-1. Employee attendance corrections, Manager -> HR reviewed.
    regularizationEnabled: false,
    // SS-1. Automated evaluation, shadow calculation, and permission to write
    // the official record. All three off: attendance must be switched on
    // deliberately, never by deploying code.
    shadowEnabled: false,
    automaticEvaluationEnabled: false,
    officialWriteEnabled: false,
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

/** Today as a company business date (yyyy-MM-dd). */
function companyBusinessDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.COMPANY_TIMEZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

@Injectable()
export class SettingsService {
  constructor(
    private prisma: PrismaService,
    private eventLogger: EventLoggerService,
  ) {}

  async get(key: string): Promise<any> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    if (!row) return DEFAULTS[key] ?? {};
    
    if (key === 'workday_policy' || key === 'company') {
      const merged = { ...DEFAULTS[key], ...(row.value as any) };
      if (key === 'company') {
        for (const [field, defaultValue] of Object.entries(DEFAULTS.company)) {
          if (typeof defaultValue === 'string' && (!merged[field] || !String(merged[field]).trim())) {
            merged[field] = defaultValue;
          }
        }
      }
      return merged;
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
    const parsed = this.parseThemeDefaults(themeRaw?.value);
    return {
      ...company,
      defaultTheme: parsed.theme === 'john-wick-dark' ? 'john-wick-dark' : 'technoedge-light',
      defaultAccent: ['royal-blue', 'emerald', 'violet', 'gold', 'crimson', 'slate'].includes(parsed.accent) ? parsed.accent : 'royal-blue',
    };
  }

  private parseThemeDefaults(value: unknown): Record<string, any> {
    if (!value) return {};
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch { return {}; }
    }
    return typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
  }

  async upsertThemeDefaults(theme?: string, accent?: string, updatedBy?: string): Promise<void> {
    if (theme !== undefined && !['technoedge-light', 'john-wick-dark'].includes(theme)) {
      throw new BadRequestException('Unsupported company theme');
    }
    if (accent !== undefined && !['royal-blue', 'emerald', 'violet', 'gold', 'crimson', 'slate'].includes(accent)) {
      throw new BadRequestException('Unsupported company accent');
    }
    const current = await this.prisma.appSetting.findFirst({ where: { key: 'theme_defaults' } });
    const currentVal = this.parseThemeDefaults(current?.value);
    const newVal = {
      theme: theme || currentVal.theme || 'technoedge-light',
      accent: accent || currentVal.accent || 'royal-blue',
    };
    await this.prisma.appSetting.upsert({
      where: { key: 'theme_defaults' },
      update: { value: JSON.stringify(newVal), updatedBy },
      create: { key: 'theme_defaults', value: JSON.stringify(newVal), updatedBy },
    });
    if (updatedBy) {
      this.eventLogger.log({
        actorId: updatedBy,
        entityType: 'Setting',
        entityId: 'theme_defaults',
        action: OperationalAction.SETTINGS_UPDATED,
        metadata: { key: 'theme_defaults' },
      }).catch(() => {});
    }
  }

  async getSlaHours(): Promise<Record<string, number>> {
    const stored = await this.get('sla');
    return { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72, ...stored };
  }

  async getReviewSlaHours(): Promise<Record<string, number>> {
    const stored = await this.get('review_sla');
    return { URGENT: 2, HIGH: 4, MEDIUM: 24, LOW: 48, ...stored };
  }

  /**
   * The leave policy version that governs today in each series, resolved by
   * the Phase 3 continuity rule (a SCHEDULED version governs from its own date
   * even before the settle job runs; a gap continues the previous version).
   * Emergency is a submission mode, not a pool, so the buckets are Casual and Sick.
   */
  async getActiveLeavePolicies() {
    const authority = await this.get('attendance_v2');
    const rows = await this.prisma.leavePolicy.findMany({
      where: { status: { in: [...GOVERNING_POLICY_STATUSES] } },
      select: {
        id: true, name: true, policyKey: true, version: true, status: true,
        financialYear: true, effectiveFrom: true, effectiveTo: true,
        totalPaidLeaves: true, casualLeaveAllocation: true, sickLeaveAllocation: true,
      },
      orderBy: [{ policyKey: 'asc' }, { version: 'desc' }],
    });
    const today = companyBusinessDate();
    const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    const series = new Map<string, typeof rows>();
    for (const row of rows) series.set(row.policyKey, [...(series.get(row.policyKey) ?? []), row]);
    const policies = [...series.values()]
      .map((versions) => resolveContinuousPolicy(
        versions.map((row) => ({ id: row.id, version: row.version, effectiveFrom: ymd(row.effectiveFrom) ?? POLICY_BASELINE_DATE, effectiveTo: ymd(row.effectiveTo), row })),
        today,
      ).policy?.row)
      .filter((row): row is (typeof rows)[number] => !!row);
    return { leaveAuthorityEnabled: authority?.leaveAuthorityEnabled === true, policies };
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
