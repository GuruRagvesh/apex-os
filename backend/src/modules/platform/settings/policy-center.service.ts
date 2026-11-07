import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventLoggerService } from '../../../common/services/event-logger.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { findPolicyCatalogItem, POLICY_CENTER_CATALOG } from './policy-center.catalog';
import { SettingsService } from './settings.service';

const POLICY_CENTER_VERSION = 1;
type PolicyDomain = 'COMPANY' | 'SYSTEM';
const SYSTEM_POLICY_TEMPLATES = [
  { key: 'system-leave', title: 'Leave rules', summary: 'The published rules behind leave requests and balances.', guidance: 'Describe the approved system behavior and effective date.', owner: 'People Operations' },
  { key: 'system-work-schedule', title: 'Work schedule rules', summary: 'The published rules behind shifts and attendance configuration.', guidance: 'Describe the approved system behavior and effective date.', owner: 'People Operations' },
  { key: 'system-ticket-types', title: 'Ticket classification rules', summary: 'The published rules behind ticket types and assignment categories.', guidance: 'Describe the approved system behavior and effective date.', owner: 'Operations' },
  { key: 'system-service-levels', title: 'Service level rules', summary: 'The published rules behind ticket response and review targets.', guidance: 'Describe the approved system behavior and effective date.', owner: 'Operations' },
];
type SystemPolicy = (typeof SYSTEM_POLICY_TEMPLATES)[number] & {
  domain: 'SYSTEM'; code: string; state: 'PUBLISHED'; version: 1;
  content: { body: string }; acknowledgementRequired: false;
};

function companyEffectiveDate(): Date {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: process.env.COMPANY_TIMEZONE || 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return new Date(`${value('year')}-${value('month')}-${value('day')}T00:00:00.000Z`);
}

function canEdit(user: any, domain: PolicyDomain): boolean {
  const role = user?.role?.name ?? user?.role;
  return domain === 'SYSTEM'
    ? role === 'SUPER_ADMIN'
    : role === 'SUPER_ADMIN' || role === 'ADMIN' || user?.isHR === true;
}

function assertDomain(value: unknown): PolicyDomain {
  if (value !== 'COMPANY' && value !== 'SYSTEM') throw new BadRequestException('Invalid policy domain');
  return value;
}

function cleanText(value: unknown, name: string, max = 10000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new BadRequestException(`${name} must contain 1 to ${max} characters`);
  }
  return value.trim();
}

function cleanLines(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some((line) => typeof line !== 'string' || !line.trim() || line.length > 3000)) {
    throw new BadRequestException(`${name} must be a list of policy statements`);
  }
  return value.map((line) => line.trim());
}

function cleanContent(value: any, domain: PolicyDomain): any {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('Policy content is required');
  if (domain === 'SYSTEM') return { body: cleanText(value.body, 'Policy body', 100000) };
  if (value.documentSections !== undefined) {
    if (!Array.isArray(value.documentSections) || value.documentSections.length < 1 || value.documentSections.length > 100 ||
        value.documentSections.some((section: any) => typeof section?.number !== 'string' || typeof section?.title !== 'string' ||
          !Array.isArray(section.parts) || section.parts.length > 100 || section.parts.some((part: any) =>
            typeof part?.number !== 'string' || typeof part?.title !== 'string' || typeof part?.text !== 'string' || !part.text.trim() || part.text.length > 20000))) {
      throw new BadRequestException('Invalid document sections');
    }
    return { documentSections: value.documentSections.map((section: any) => ({
      number: section.number, title: section.title.trim(), parts: section.parts.map((part: any) => ({
        number: part.number, title: part.title.trim(), text: part.text.trim(),
      })),
    })) };
  }
  const statements = {
    rules: cleanLines(value.rules, 'Rules'),
    process: cleanLines(value.process, 'Process'),
    examples: cleanLines(value.examples, 'Examples'),
  };
  if (!statements.rules.length && !statements.process.length) throw new BadRequestException('A company policy needs rules or process steps');
  return statements;
}

@Injectable()
export class PolicyCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogger: EventLoggerService,
    private readonly settings: SettingsService,
  ) {}

  async getForUser(userId: string) {
    const [acknowledgements, revisions, systemBaselines] = await Promise.all([this.prisma.policyAcknowledgement.findMany({
      where: { userId },
      select: { policyKey: true, policyVersion: true, acknowledgedAt: true, viewedAt: true },
    }), this.activeRevisions(), this.systemPolicyBaselines()]);
    const acknowledgementByKey = new Map(acknowledgements.map((acknowledgement) => [`${acknowledgement.policyKey}:${acknowledgement.policyVersion}`, acknowledgement]));
    const revisionByKey = new Map(revisions.map((revision) => [revision.policyKey, revision]));

    const sections = POLICY_CENTER_CATALOG.map((section) => ({
      ...section,
      items: section.items.filter((policy) => policy.state !== 'REFERENCE').map((baseline) => {
        const revision = revisionByKey.get(baseline.key);
        const policy = revision ? { ...baseline, ...this.revisionFields(revision), state: 'PUBLISHED' as const } : baseline;
        const version = revision?.version ?? baseline.version ?? POLICY_CENTER_VERSION;
        // Source identifiers are provenance metadata, not employee-facing policy text.
        const { sourceIds, ...employeePolicy } = policy;
        return {
          ...employeePolicy,
          version,
          acknowledgement: policy.state === 'PUBLISHED'
            ? acknowledgementByKey.get(`${policy.key}:${version}`) ?? null
            : null,
        };
      }),
    }));
    const publishable = sections.flatMap((section) => section.items).filter((policy) => policy.state === 'PUBLISHED');
    const acknowledged = publishable.filter((policy) => policy.acknowledgement?.acknowledgedAt).length;

    return {
      version: POLICY_CENTER_VERSION,
      sections,
      systemPolicies: this.mergeSystemPolicies(systemBaselines, revisions).map((policy) => ({
        ...policy,
        acknowledgement: null,
      })),
      summary: {
        total: publishable.length,
        acknowledged,
        pending: publishable.length - acknowledged,
        awaitingPublication: sections.flatMap((section) => section.items).filter((policy) => policy.state === 'HOLD').length,
        linkedTopics: POLICY_CENTER_CATALOG.flatMap((section) => section.items).filter((policy) => policy.state === 'REFERENCE').length,
      },
    };
  }

  async acknowledge(userId: string, policyKey: string, policyVersion: unknown) {
    const revision = await this.currentRevision(policyKey);
    const systemPolicy = (await this.systemPolicyBaselines()).find((policy) => policy.key === policyKey);
    if (systemPolicy || revision?.domain === 'SYSTEM') {
      throw new BadRequestException('System policies reflect current workspace configuration and do not require acknowledgement.');
    }
    const policy = findPolicyCatalogItem(policyKey);
    if (!policy) throw new NotFoundException('Policy section not found');
    const currentVersion = revision?.version ?? policy.version ?? POLICY_CENTER_VERSION;
    if (policyVersion !== currentVersion) {
      throw new BadRequestException('This policy version is no longer current. Refresh the policy library and review the latest version.');
    }
    if (policy.state !== 'PUBLISHED' && !revision) {
      throw new BadRequestException('This policy topic cannot be acknowledged separately. Review its primary policy or wait for publication.');
    }

    const acknowledgement = await this.prisma.policyAcknowledgement.upsert({
      where: { userId_policyKey_policyVersion: { userId, policyKey, policyVersion: currentVersion } },
      create: { userId, policyKey, policyVersion: currentVersion, acknowledgedAt: new Date() },
      update: { acknowledgedAt: new Date(), viewedAt: new Date() },
      select: { policyKey: true, policyVersion: true, acknowledgedAt: true, viewedAt: true },
    });

    await this.eventLogger.log({
      actorId: userId,
      entityType: 'POLICY_ACKNOWLEDGEMENT',
      entityId: acknowledgement.policyKey,
      action: 'POLICY_ACKNOWLEDGED',
      metadata: { policyVersion: acknowledgement.policyVersion },
    });

    return { acknowledgement };
  }

  private revisionFields(revision: any) {
    const content = revision.content as any;
    return {
      title: revision.title, summary: revision.summary, guidance: revision.guidance, owner: revision.owner,
      rules: content.rules ?? [], process: content.process ?? [], examples: content.examples ?? [],
      documentSections: content.documentSections, body: content.body,
    };
  }

  private async activeRevisions() {
    const rows = await this.prisma.policyDocumentRevision.findMany({
      where: { status: 'PUBLISHED', effectiveFrom: { lte: companyEffectiveDate() } },
      orderBy: [{ version: 'desc' }],
    });
    const seen = new Set<string>();
    return rows.filter((row) => { if (seen.has(row.policyKey)) return false; seen.add(row.policyKey); return true; });
  }

  private async currentRevision(key: string) {
    return this.prisma.policyDocumentRevision.findFirst({
      where: { policyKey: key, status: 'PUBLISHED', effectiveFrom: { lte: companyEffectiveDate() } },
      orderBy: { version: 'desc' },
    });
  }

  /**
   * System Policies are generated from the live configuration rather than an
   * uploaded company document. They are intentionally read-only for employees
   * and never treated as an acknowledgement or employment-contract record.
   */
  private async systemPolicyBaselines(): Promise<SystemPolicy[]> {
    const [leave, workday, executionSla, reviewSla] = await Promise.all([
      this.settings.getLeaveQuotas(), this.settings.getWorkdayPolicy(),
      this.settings.getSlaHours(), this.settings.getReviewSlaHours(),
    ]);
    const duration = (minutes: unknown) => {
      const value = Number(minutes);
      if (!Number.isFinite(value) || value <= 0) return 'the configured minimum';
      const hours = Math.floor(value / 60);
      const remaining = value % 60;
      return `${hours} hour${hours === 1 ? '' : 's'}${remaining ? ` ${remaining} minute${remaining === 1 ? '' : 's'}` : ''}`;
    };
    const levels = (values: Record<string, number>) => Object.entries(values)
      .map(([priority, hours]) => `${priority}: ${hours} hour${Number(hours) === 1 ? '' : 's'}`).join('\n');
    return [
      {
        ...SYSTEM_POLICY_TEMPLATES[0], domain: 'SYSTEM', code: 'SYS-01', state: 'PUBLISHED', version: 1, acknowledgementRequired: false,
        summary: 'The current application settings used for leave balances and leave requests.',
        guidance: 'These values reflect the live workspace configuration.',
        content: { body: `Current leave configuration\n\nAnnual balances by role\n${Object.entries(leave).map(([role, days]) => `${role}: ${days} day${Number(days) === 1 ? '' : 's'}`).join('\n')}\n\nChanges to live leave rules are made through the authorized operational workflow and become effective according to that workflow.` },
      },
      {
        ...SYSTEM_POLICY_TEMPLATES[1], domain: 'SYSTEM', code: 'SYS-02', state: 'PUBLISHED', version: 1, acknowledgementRequired: false,
        summary: 'The current application settings used for attendance and working-time calculations.',
        guidance: 'These values reflect the live workspace configuration.',
        content: { body: `Current work schedule configuration\n\nTimezone: ${workday?.timezone ?? 'Asia/Kolkata'}\nMinimum workday: ${duration(workday?.minimumWorkdayMinutes)}\nEmployee schedule: ${workday?.employeeTiming?.start ?? 'Not set'} to ${workday?.employeeTiming?.end ?? 'Not set'}\nTeam Lead entry window: ${workday?.tlTiming?.entryStart ?? 'Not set'} to ${workday?.tlTiming?.entryEnd ?? 'Not set'}\nTeam Lead exit window: ${workday?.tlTiming?.exitStart ?? 'Not set'} to ${workday?.tlTiming?.exitEnd ?? 'Not set'}\nManager timing: ${workday?.managerTiming?.flexible ? 'Flexible' : 'Configured schedule'}\nAutomatic close: ${workday?.autoClose ? `Enabled at ${workday?.autoCloseTime ?? 'the configured time'}` : 'Disabled'}\n\nChanges to live schedule rules are made through the authorized operational workflow.` },
      },
      {
        ...SYSTEM_POLICY_TEMPLATES[2], domain: 'SYSTEM', code: 'SYS-03', state: 'PUBLISHED', version: 1, acknowledgementRequired: false,
        summary: 'The rules used to classify work in the ticketing workspace.',
        guidance: 'Ticket types and subtypes are maintained by authorized administrators.',
        content: { body: 'Ticket classification configuration\n\nGlobal and department-specific ticket types classify work at creation. A ticket can use the types available to its department, with authorized administrators maintaining types and subtypes.\n\nThis information reflects current workspace configuration. Changes are made through Operational settings.' },
      },
      {
        ...SYSTEM_POLICY_TEMPLATES[3], domain: 'SYSTEM', code: 'SYS-04', state: 'PUBLISHED', version: 1, acknowledgementRequired: false,
        summary: 'The current response and review targets used by the ticketing workspace.',
        guidance: 'Execution and review targets are maintained separately.',
        content: { body: `Current service-level configuration\n\nExecution targets\n${levels(executionSla)}\n\nReview targets\n${levels(reviewSla)}\n\nChanges to live service levels are made through the authorized operational workflow.` },
      },
    ];
  }

  private mergeSystemPolicies(baselines: SystemPolicy[], revisions: any[]) {
    const revisionByKey = new Map(revisions.filter((revision) => revision.domain === 'SYSTEM').map((revision) => [revision.policyKey, revision]));
    const baselineKeys = new Set(baselines.map((policy) => policy.key));
    const merged = baselines.map((baseline) => {
      const revision = revisionByKey.get(baseline.key);
      return revision ? {
        ...baseline, version: revision.version, ...this.revisionFields(revision), acknowledgementRequired: false,
      } : baseline;
    });
    for (const revision of revisions.filter((entry) => entry.domain === 'SYSTEM' && !baselineKeys.has(entry.policyKey))) {
      merged.push({ key: revision.policyKey, code: 'SYS', domain: 'SYSTEM', state: 'PUBLISHED', version: revision.version,
        acknowledgementRequired: false, ...this.revisionFields(revision) } as any);
    }
    return merged;
  }

  async getAdministration(user: any) {
    if (!canEdit(user, 'COMPANY')) throw new ForbiddenException('Policy administration requires HR or administrator access');
    const [revisions, systemBaselines] = await Promise.all([
      this.prisma.policyDocumentRevision.findMany({ orderBy: { version: 'desc' } }),
      this.systemPolicyBaselines(),
    ]);
    const latest = new Map<string, any>();
    const drafts = new Map<string, any>();
    for (const row of revisions) {
      if (row.status === 'DRAFT' && !drafts.has(row.policyKey)) drafts.set(row.policyKey, row);
      if (row.status === 'PUBLISHED' && !latest.has(row.policyKey)) latest.set(row.policyKey, row);
    }
    const company = POLICY_CENTER_CATALOG.flatMap((section) => section.items)
      .filter((policy) => policy.state !== 'REFERENCE')
      .map(({ sourceIds, ...policy }) => ({
        ...policy, version: policy.version ?? 1,
        published: latest.get(policy.key) ? this.adminRevision(latest.get(policy.key)) : null,
        draft: drafts.get(policy.key) ? this.adminRevision(drafts.get(policy.key)) : null,
      }));
    const systemKeys = new Set([...systemBaselines.map((policy) => policy.key), ...revisions.filter((row) => row.domain === 'SYSTEM').map((row) => row.policyKey)]);
    const system = [...systemKeys].map((key) => ({
      key, ...(systemBaselines.find((policy) => policy.key === key) ?? {}),
      published: latest.get(key) ? this.adminRevision(latest.get(key)) : this.adminBaseline(systemBaselines.find((policy) => policy.key === key)),
      draft: drafts.get(key) ? this.adminRevision(drafts.get(key)) : null,
    }));
    return { company, system, canEditCompany: true, canEditSystem: canEdit(user, 'SYSTEM') };
  }

  private adminRevision(row: any) {
    return { id: row.id, key: row.policyKey, domain: row.domain, version: row.version,
      status: row.status, title: row.title, summary: row.summary, guidance: row.guidance,
      owner: row.owner, content: row.content, effectiveFrom: row.effectiveFrom, createdAt: row.createdAt };
  }

  private adminBaseline(policy?: SystemPolicy) {
    if (!policy) return null;
    return { key: policy.key, domain: policy.domain, version: policy.version, status: policy.state,
      title: policy.title, summary: policy.summary, guidance: policy.guidance, owner: policy.owner,
      content: policy.content, effectiveFrom: null, createdAt: null };
  }

  async saveDraft(user: any, key: string, input: any) {
    const domain = assertDomain(input?.domain);
    if (!canEdit(user, domain)) throw new ForbiddenException('You cannot edit this policy domain');
    const baseline = findPolicyCatalogItem(key);
    if (domain === 'COMPANY' && (!baseline || baseline.state === 'REFERENCE')) throw new BadRequestException('Edit the primary company policy instead');
    if (domain === 'SYSTEM' && baseline) throw new BadRequestException('Company policies cannot be moved into System Policies');
    if (domain === 'SYSTEM' && !/^system-[a-z0-9-]{3,70}$/.test(key)) throw new BadRequestException('Invalid system policy key');
    const title = cleanText(input?.title, 'Title', 200);
    const summary = cleanText(input?.summary, 'Summary', 1000);
    const guidance = cleanText(input?.guidance, 'Guidance', 3000);
    const owner = cleanText(input?.owner, 'Owner', 200);
    const content = cleanContent(input?.content, domain);
    const existing = await this.prisma.policyDocumentRevision.findFirst({ where: { policyKey: key, status: 'DRAFT' }, orderBy: { version: 'desc' } });
    if (existing) {
      if (existing.domain !== domain) throw new BadRequestException('Policy domain cannot change');
      return this.adminRevision(await this.prisma.policyDocumentRevision.update({
        where: { id: existing.id }, data: { title, summary, guidance, owner, content },
      }));
    }
    const latest = await this.prisma.policyDocumentRevision.findFirst({ where: { policyKey: key }, orderBy: { version: 'desc' } });
    const version = Math.max(latest?.version ?? 0, baseline?.version ?? 0, POLICY_CENTER_VERSION) + 1;
    return this.adminRevision(await this.prisma.policyDocumentRevision.create({ data: {
      policyKey: key, domain, version, title, summary, guidance, owner, content, createdById: user.id ?? user.sub,
    } }));
  }

  async publishDraft(user: any, key: string, input: any) {
    const draft = await this.prisma.policyDocumentRevision.findFirst({ where: { policyKey: key, status: 'DRAFT' }, orderBy: { version: 'desc' } });
    if (!draft) throw new NotFoundException('Draft policy not found');
    if (!canEdit(user, assertDomain(draft.domain))) throw new ForbiddenException('You cannot publish this policy domain');
    if (findPolicyCatalogItem(key)?.state === 'HOLD') {
      throw new BadRequestException('This policy requires separate formal authorization before publication');
    }
    const date = String(input?.effectiveFrom ?? '');
    const effectiveFrom = new Date(`${date}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(effectiveFrom.getTime()) || effectiveFrom.toISOString().slice(0, 10) !== date) {
      throw new BadRequestException('A valid effective date is required');
    }
    const changed = await this.prisma.policyDocumentRevision.updateMany({ where: { id: draft.id, status: 'DRAFT' }, data: {
      status: 'PUBLISHED', effectiveFrom, publishedAt: new Date(), publishedById: user.id ?? user.sub,
    } });
    if (changed.count !== 1) throw new BadRequestException('This draft has already been published');
    const published = await this.prisma.policyDocumentRevision.findUniqueOrThrow({ where: { id: draft.id } });
    await this.eventLogger.log({ actorId: user.id ?? user.sub, entityType: 'POLICY_DOCUMENT', entityId: key,
      action: 'POLICY_PUBLISHED', metadata: { domain: draft.domain, version: draft.version, effectiveFrom: date } });
    return this.adminRevision(published);
  }
}
