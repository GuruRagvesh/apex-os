import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { EventLoggerService } from '../../../../common/services/event-logger.service';
import { badRequest, forbidden, isSuperAdmin, TRANSITION_CODE, TransitionActor, unavailable } from './transitions-codes';

/**
 * Phase 4 rollout switches (correction 14).
 *
 * A capability is enabled only when BOTH its AppSetting switch is ON and a
 * schema probe confirms the Phase 4 tables/columns it needs exist, so the UI
 * can never offer an action before the migration and backend are in place.
 * Every switch defaults OFF. Only a Super Admin changes them, from Settings,
 * and each change writes an audit event.
 */

export const SWITCHES = {
  transfer: 'transitions.transferEnabled',
  exit: 'transitions.exitEnabled',
  compliance: 'compliance.adminEnabled',
  retentionDefaultDeny: 'compliance.retentionDefaultDeny',
  payrollAck: 'payroll.unresolvedAckRequired',
} as const;
export type Capability = keyof typeof SWITCHES;

const PROBES: Record<Capability, Array<[string, string | null]>> = {
  transfer: [['transition_request_keys', null], ['department_transfers', 'previewFingerprint'], ['department_transfer_impacts', 'reviewedAt']],
  exit: [['transition_request_keys', null], ['exit_cases', 'separationDueAt'], ['users', 'accessEndsAt'], ['fnf_adjustment_requests', null]],
  compliance: [['retention_rule_proposals', null], ['retention_rule_versions', null], ['user_legal_holds', 'idempotencyKey']],
  retentionDefaultDeny: [['retention_rules', 'noExpiry']],
  payrollAck: [['attendance_month_closes', 'unresolvedSummary']],
};

const PROBE_TTL_MS = 60_000;

@Injectable()
export class TransitionCapabilitiesService {
  private probeCache: { at: number; ok: Record<string, boolean> } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventLoggerService,
  ) {}

  private async schemaReady(): Promise<Record<string, boolean>> {
    if (this.probeCache && Date.now() - this.probeCache.at < PROBE_TTL_MS) return this.probeCache.ok;
    const ok: Record<string, boolean> = {};
    try {
      const rows: Array<{ table_name: string; column_name: string }> = await this.prisma.$queryRaw`
        SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name IN ('transition_request_keys','department_transfers','department_transfer_impacts','exit_cases','users',
                              'fnf_adjustment_requests','retention_rule_proposals','retention_rule_versions','user_legal_holds',
                              'retention_rules','attendance_month_closes')`;
      const have = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
      const tables = new Set(rows.map((r) => r.table_name));
      for (const cap of Object.keys(PROBES) as Capability[]) {
        ok[cap] = PROBES[cap].every(([t, c]) => (c ? have.has(`${t}.${c}`) : tables.has(t)));
      }
    } catch {
      for (const cap of Object.keys(PROBES)) ok[cap] = false;
    }
    this.probeCache = { at: Date.now(), ok };
    return ok;
  }

  private async switches(): Promise<Record<Capability, boolean>> {
    const rows = await this.prisma.appSetting.findMany({ where: { key: { in: Object.values(SWITCHES) } }, select: { key: true, value: true } });
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const out = {} as Record<Capability, boolean>;
    for (const [cap, key] of Object.entries(SWITCHES) as Array<[Capability, string]>) out[cap] = byKey.get(key) === true;
    return out;
  }

  /** Enabled = switch ON and schema present. */
  async capabilities(): Promise<Record<Capability, { enabled: boolean; switchOn: boolean; schemaReady: boolean }>> {
    const [sw, schema] = await Promise.all([this.switches(), this.schemaReady()]);
    const out = {} as Record<Capability, { enabled: boolean; switchOn: boolean; schemaReady: boolean }>;
    for (const cap of Object.keys(SWITCHES) as Capability[]) {
      out[cap] = { enabled: sw[cap] && !!schema[cap], switchOn: sw[cap], schemaReady: !!schema[cap] };
    }
    return out;
  }

  async isEnabled(cap: Capability): Promise<boolean> {
    return (await this.capabilities())[cap].enabled;
  }

  /** 503 FEATURE_NOT_AVAILABLE unless the capability is enabled. */
  async require(cap: Capability): Promise<void> {
    if (!(await this.isEnabled(cap))) unavailable(cap);
  }

  async setSwitch(actor: TransitionActor, cap: string, enabled: unknown) {
    if (!isSuperAdmin(actor)) forbidden(TRANSITION_CODE.FORBIDDEN, 'Only a Super Admin can change rollout switches.');
    if (!(cap in SWITCHES)) badRequest(TRANSITION_CODE.NOT_FOUND, 'Unknown capability.');
    if (typeof enabled !== 'boolean') badRequest(TRANSITION_CODE.REASON_REQUIRED, 'enabled must be true or false.');
    const key = SWITCHES[cap as Capability];
    if (enabled) {
      const schema = await this.schemaReady();
      if (!schema[cap]) badRequest(TRANSITION_CODE.FEATURE_NOT_AVAILABLE, 'The database migration for this feature has not been applied yet.');
    }
    const before = await this.prisma.appSetting.findUnique({ where: { key } });
    await this.prisma.appSetting.upsert({ where: { key }, create: { key, value: enabled, updatedBy: actor.id }, update: { value: enabled, updatedBy: actor.id } });
    await this.events.log({
      actorId: actor.id, entityType: 'AppSetting', entityId: key, action: 'TRANSITION_SWITCH_CHANGED',
      fromState: String(before?.value === true), toState: String(enabled), metadata: { capability: cap },
    });
    return this.capabilities();
  }
}
