import { BadRequestException } from '@nestjs/common';
import { PolicyCenterService } from '../../src/modules/platform/settings/policy-center.service';
import { POLICY_CENTER_CATALOG } from '../../src/modules/platform/settings/policy-center.catalog';

describe('PolicyCenterService', () => {
  const findMany = jest.fn();
  const upsert = jest.fn();
  const revisionFindMany = jest.fn();
  const revisionFindFirst = jest.fn();
  const revisionCreate = jest.fn();
  const revisionUpdateMany = jest.fn();
  const revisionFindUniqueOrThrow = jest.fn();
  const log = jest.fn();
  const settings = {
    getLeaveQuotas: jest.fn(), getWorkdayPolicy: jest.fn(),
    getSlaHours: jest.fn(), getReviewSlaHours: jest.fn(),
  };
  const service = new PolicyCenterService(
    { policyAcknowledgement: { findMany, upsert }, policyDocumentRevision: { findMany: revisionFindMany, findFirst: revisionFindFirst, create: revisionCreate, updateMany: revisionUpdateMany, findUniqueOrThrow: revisionFindUniqueOrThrow } } as any,
    { log } as any,
    settings as any,
  );

  beforeEach(() => {
    jest.clearAllMocks(); revisionFindMany.mockResolvedValue([]); revisionFindFirst.mockResolvedValue(null);
    settings.getLeaveQuotas.mockResolvedValue({ EMPLOYEE: 12, TEAM_LEAD: 12, MANAGER: 15, INTERN: 6 });
    settings.getWorkdayPolicy.mockResolvedValue({ timezone: 'Asia/Kolkata', minimumWorkdayMinutes: 540, employeeTiming: { start: '09:30', end: '18:30' }, tlTiming: { entryStart: '09:30', entryEnd: '10:30', exitStart: '18:30', exitEnd: '19:30' }, managerTiming: { flexible: true }, autoClose: true, autoCloseTime: '23:59' });
    settings.getSlaHours.mockResolvedValue({ URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 });
    settings.getReviewSlaHours.mockResolvedValue({ URGENT: 2, HIGH: 4, MEDIUM: 24, LOW: 48 });
  });

  it('publishes the complete employee-safe policy catalogue with acknowledgement status', async () => {
    findMany.mockResolvedValue([{ policyKey: 'policy-01-01', policyVersion: 1, acknowledgedAt: new Date('2026-11-05'), viewedAt: new Date('2026-11-05') }]);

    const result = await service.getForUser('user-1');

    expect(result.sections).toHaveLength(6);
    expect(result.sections.flatMap((section) => section.items)).toHaveLength(31);
    expect(result.summary.total).toBe(30);
    expect(result.summary.awaitingPublication).toBe(1);
    expect(result.summary.linkedTopics).toBe(5);
    expect(result.summary.acknowledged).toBe(1);
    expect(result.sections[0].items[0].acknowledgement?.acknowledgedAt).toBeTruthy();
    expect(result.sections[0].items[0]).not.toHaveProperty('sourceIds');
    const conduct = result.sections[3].items[0];
    expect(conduct.title).toBe('Code of Conduct');
    expect(conduct.version).toBe(2);
    expect(conduct.documentSections).toHaveLength(11);
    expect(conduct.documentSections?.find((section) => section.number === '7')?.parts.some((part) => part.title.includes('No Retaliation'))).toBe(true);
    expect(result.sections[3].items.map((policy) => policy.title)).toEqual(['Code of Conduct', 'Respectful workplace & POSH']);
    expect(result.systemPolicies).toHaveLength(4);
    expect(result.systemPolicies[0]).toMatchObject({ key: 'system-leave', acknowledgementRequired: false });
  });

  it('retains a one-to-one mapping for every refined company-policy topic', () => {
    const expected = [
      ...Array.from({ length: 6 }, (_, index) => `1.${index + 1}`),
      ...Array.from({ length: 8 }, (_, index) => `2.${index + 1}`),
      ...Array.from({ length: 3 }, (_, index) => `3.${index + 1}`),
      ...Array.from({ length: 7 }, (_, index) => `4.${index + 1}`),
      ...Array.from({ length: 7 }, (_, index) => `5.${index + 1}`),
      ...Array.from({ length: 7 }, (_, index) => `6.${index + 1}`),
      ...Array.from({ length: 7 }, (_, index) => `7.${index + 1}`),
      ...Array.from({ length: 8 }, (_, index) => `8.${index + 1}`),
      ...Array.from({ length: 7 }, (_, index) => `9.${index + 1}`),
    ];
    const mapped = POLICY_CENTER_CATALOG.flatMap((section) => section.items.flatMap((policy) => policy.sourceIds));
    expect(mapped).toHaveLength(60);
    expect(new Set(mapped).size).toBe(60);
    expect([...mapped].sort()).toEqual([...expected].sort());
  });

  it('records an acknowledgement against the current published policy version only', async () => {
    upsert.mockResolvedValue({ policyKey: 'policy-01-01', policyVersion: 1, acknowledgedAt: new Date(), viewedAt: new Date() });

    await service.acknowledge('user-1', 'policy-01-01', 1);

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_policyKey_policyVersion: { userId: 'user-1', policyKey: 'policy-01-01', policyVersion: 1 } },
    }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'POLICY_ACKNOWLEDGED' }));
  });

  it('does not let a user acknowledge a policy awaiting legal publication', async () => {
    await expect(service.acknowledge('user-1', 'policy-04-04', 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('requires the full Code version and prevents separate acknowledgement of a linked conduct topic', async () => {
    await expect(service.acknowledge('user-1', 'policy-04-01', 1)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.acknowledge('user-1', 'policy-04-02', 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('allows HR to draft a company policy but refuses a system policy', async () => {
    revisionCreate.mockImplementation(async ({ data }) => ({ id: 'draft-1', status: 'DRAFT', ...data }));
    const hr = { id: 'hr-1', role: { name: 'EMPLOYEE' }, isHR: true };
    const input = { domain: 'COMPANY', title: 'Joining', summary: 'Joining rules', guidance: 'Follow the joining process', owner: 'HR', content: { rules: ['Rule'], process: ['Step'], examples: [] } };
    const draft = await service.saveDraft(hr, 'policy-01-01', input);
    expect(draft.version).toBe(2);
    await expect(service.saveDraft(hr, 'system-attendance', { ...input, domain: 'SYSTEM', content: { body: 'System rule' } })).rejects.toThrow('You cannot edit this policy domain');
  });

  it('keeps a future published version out of the employee reader until its effective date', async () => {
    findMany.mockResolvedValue([]);
    revisionFindMany.mockResolvedValue([]);
    const result = await service.getForUser('user-1');
    expect(result.sections[3].items[0].version).toBe(2);
    expect(result.sections[3].items[0].title).toBe('Code of Conduct');
    expect(revisionFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ effectiveFrom: expect.any(Object) }) }));
  });

  it('shows a published company revision and requires acknowledgement of that exact version', async () => {
    findMany.mockResolvedValue([{ policyKey: 'policy-04-01', policyVersion: 2, acknowledgedAt: new Date(), viewedAt: new Date() }]);
    const revision = { id: 'rev-3', policyKey: 'policy-04-01', domain: 'COMPANY', version: 3, status: 'PUBLISHED', title: 'Code of Conduct', summary: 'Updated conduct', guidance: 'Read this version', owner: 'People Operations', content: { documentSections: [{ number: '0', title: 'Introduction', parts: [{ number: '', title: '', text: 'New text' }] }] } };
    revisionFindMany.mockResolvedValue([revision]);
    revisionFindFirst.mockResolvedValue(revision);
    const result = await service.getForUser('user-1');
    const conduct = result.sections[3].items[0];
    expect(conduct.version).toBe(3);
    expect(conduct.acknowledgement).toBeNull();
    expect(conduct.documentSections?.[0].parts[0].text).toBe('New text');
    await expect(service.acknowledge('user-1', 'policy-04-01', 2)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prevents publication of the held POSH entry', async () => {
    revisionFindFirst.mockResolvedValue({ id: 'posh-draft', policyKey: 'policy-04-04', domain: 'COMPANY', version: 2, status: 'DRAFT' });
    await expect(service.publishDraft({ id: 'admin-1', role: { name: 'ADMIN' } }, 'policy-04-04', { effectiveFrom: '2026-11-05' })).rejects.toThrow('formal authorization');
    expect(revisionUpdateMany).not.toHaveBeenCalled();
  });

  it('lets a Super Admin publish a System Policy revision without changing operational settings', async () => {
    const superAdmin = { id: 'super-1', role: { name: 'SUPER_ADMIN' } };
    const draft = { id: 'system-draft', policyKey: 'system-leave', domain: 'SYSTEM', version: 2, status: 'DRAFT', title: 'Leave rules', summary: 'Summary', guidance: 'Guidance', owner: 'HR', content: { body: 'Approved system policy text' } };
    revisionFindFirst.mockResolvedValue(draft);
    revisionUpdateMany.mockResolvedValue({ count: 1 });
    revisionFindUniqueOrThrow.mockResolvedValue({ ...draft, status: 'PUBLISHED', effectiveFrom: new Date('2026-11-05') });
    const result = await service.publishDraft(superAdmin, 'system-leave', { effectiveFrom: '2026-11-05' });
    expect(result.status).toBe('PUBLISHED');
    expect(revisionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'system-draft', status: 'DRAFT' } }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'POLICY_PUBLISHED', metadata: expect.objectContaining({ domain: 'SYSTEM' }) }));
  });

  it('does not allow acknowledgement of live System Policy configuration', async () => {
    await expect(service.acknowledge('user-1', 'system-leave', 1)).rejects.toThrow('do not require acknowledgement');
    expect(upsert).not.toHaveBeenCalled();
  });
});
