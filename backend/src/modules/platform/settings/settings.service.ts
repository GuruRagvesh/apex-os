import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

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
  sla: { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 },
  smtp: { host: '', port: '587', email: '', password: '' },
};

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async get(key: string): Promise<any> {
    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    return row ? (row.value as any) : DEFAULTS[key] ?? {};
  }

  async set(key: string, value: any, updatedBy?: string): Promise<any> {
    const saved = await this.prisma.appSetting.upsert({
      where: { key },
      create: { key, value, updatedBy },
      update: { value, updatedBy },
    });
    return saved.value;
  }

  // ── Convenience getters used by other services (e.g. SLA hours in tickets) ──

  async getSlaHours(): Promise<Record<string, number>> {
    const stored = await this.get('sla');
    return { URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72, ...stored };
  }

  async getLeaveQuotas(): Promise<Record<string, number>> {
    const stored = await this.get('leave_policy');
    return { EMPLOYEE: 12, TEAM_LEAD: 12, MANAGER: 15, INTERN: 6, ...(stored?.quotas ?? {}) };
  }
}
