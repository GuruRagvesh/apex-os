import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { MeetingV2Service } from '../../src/modules/platform/workday/meeting-v2.service';

/**
 * Meeting v2 rules: who may start which type, who can be invited, and who
 * approves. Prisma, the hierarchy, notifications and the workday are doubles.
 */
const user = (id: string, role: string, departmentId: string | null = 'd1') => ({
  id, name: id.toUpperCase(), role: { name: role }, departmentId, department: departmentId ? { id: departmentId, name: departmentId } : null, managedDepts: [], isActive: true,
});

function build(people: any[], chain: any[] = [{ id: 'tl', name: 'TL', tier: 'TEAM_LEAD' }, { id: 'mgr', name: 'MGR', tier: 'MANAGER' }, { id: 'adm', name: 'ADM', tier: 'ADMIN' }]) {
  const chainPeople = chain.map((candidate) => user(candidate.id, candidate.tier === 'ADMIN' ? 'ADMIN' : candidate.tier, candidate.tier === 'ADMIN' ? null : 'd1'));
  const allPeople = [...people, ...chainPeople.filter((candidate) => !people.some((person) => person.id === candidate.id))];
  const byId = new Map(allPeople.map((p) => [p.id, p]));
  const created: any[] = [];
  const prisma: any = {
    user: {
      findUnique: jest.fn(async ({ where }) => byId.get(where.id) ?? null),
      findMany: jest.fn(async ({ where }) => where?.id?.in
        ? where.id.in.map((id: string) => byId.get(id)).filter(Boolean)
        : where?.role?.name?.in
          ? allPeople.filter((person) => where.role.name.in.includes(person.role.name))
          : []),
    },
    leaveRequest: { findMany: jest.fn(async () => []) },
    breakLog: { findMany: jest.fn(async () => []), update: jest.fn(async () => ({})) },
    meeting: {
      create: jest.fn(async ({ data }) => { created.push(data); return { id: 'm1', ...data }; }),
      findUnique: jest.fn(async () => ({ id: 'm1', topic: 'x', meetingType: 'CUSTOM', approverIds: created[0]?.approverIds ?? [], participants: [], organizerId: 'me', organizerNameSnapshot: 'ME' })),
      update: jest.fn(async ({ data }) => data),
      updateMany: jest.fn(async () => ({ count: 1 })),
      delete: jest.fn(async () => ({})),
    },
    meetingApprovalResponse: {
      findUnique: jest.fn(async () => null),
      updateMany: jest.fn(async () => ({ count: 1 })),
      count: jest.fn(async () => 0),
    },
  };
  prisma.$transaction = jest.fn(async (work: any) => typeof work === 'function' ? work(prisma) : Promise.all(work));
  const hierarchy: any = { resolveApproverChainFor: jest.fn(async () => chain) };
  const notifications: any = { create: jest.fn(async () => ({})) };
  const workday: any = { startBreak: jest.fn(async () => ({ breakLog: { id: 'b1' } })) };
  const service = new MeetingV2Service(prisma, hierarchy, notifications, workday);
  return { service, prisma, created, workday, notifications };
}

describe('MeetingV2Service.start', () => {
  it('lets an employee start Internal only as a departmental meeting, approved by their Team Lead', async () => {
    const { service, created } = build([user('me', 'EMPLOYEE'), user('p1', 'EMPLOYEE')]);
    await service.start('me', { agenda: 'Sprint sync', type: 'INTERNAL', participantIds: ['p1'] });
    expect(created[0].isDepartmental).toBe(true);
    expect(created[0].approverIds).toEqual(['tl']);
    expect(created[0].participants.create.map((p: any) => [p.userId, p.status])).toEqual([['me', 'ACCEPTED'], ['p1', 'INVITED']]);
  });

  it('lets an employee choose their Manager for an employee-only Internal meeting', async () => {
    const { service, created } = build([user('me', 'EMPLOYEE'), user('p1', 'EMPLOYEE')]);
    await service.start('me', { agenda: 'Peer planning', type: 'INTERNAL', participantIds: ['p1'], approverId: 'mgr' });
    expect(created[0].approverIds).toEqual(['mgr']);
  });

  it('does not allow Admin as the manual approver for an employee-only Internal meeting', async () => {
    const { service } = build([user('me', 'EMPLOYEE'), user('p1', 'EMPLOYEE')]);
    await expect(service.start('me', { agenda: 'Peer planning', type: 'INTERNAL', participantIds: ['p1'], approverId: 'adm' })).rejects.toThrow('Choose approvers suggested');
  });

  it('falls back to the Manager when no Team Leader is assigned', async () => {
    const chain = [{ id: 'mgr', name: 'MGR', tier: 'MANAGER' }, { id: 'adm', name: 'ADM', tier: 'ADMIN' }];
    const { service, created } = build([user('me', 'EMPLOYEE'), user('p1', 'EMPLOYEE')], chain);
    await service.start('me', { agenda: 'Peer planning', type: 'INTERNAL', participantIds: ['p1'] });
    expect(created[0].approverIds).toEqual(['mgr']);
  });

  it('rejects a one-on-one outside the department', async () => {
    const { service } = build([user('me', 'EMPLOYEE', 'd1'), user('p1', 'EMPLOYEE', 'd2')]);
    await expect(service.start('me', { agenda: 'Chat', type: 'ONE_ON_ONE', participantIds: ['p1'] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a one-on-one with more than one person', async () => {
    const { service } = build([user('me', 'EMPLOYEE'), user('p1', 'EMPLOYEE'), user('p2', 'EMPLOYEE')]);
    await expect(service.start('me', { agenda: 'Chat', type: 'ONE_ON_ONE', participantIds: ['p1', 'p2'] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('routes a client meeting to the direct manager', async () => {
    const { service, created } = build([user('me', 'EMPLOYEE')]);
    await service.start('me', { agenda: 'Kickoff', type: 'EXTERNAL', clientName: 'Acme' });
    expect(created[0].approverIds).toEqual(['mgr']);
    expect(created[0].clientName).toBe('Acme');
  });

  it('routes a Custom meeting with Admin and Managers to all of them', async () => {
    const { service, created } = build([user('me', 'TEAM_LEAD'), user('a1', 'ADMIN', null), user('m1', 'MANAGER', 'd2'), user('m2', 'MANAGER', 'd3'), user('e1', 'EMPLOYEE')]);
    await service.start('me', { agenda: 'Review', type: 'CUSTOM', participantIds: ['a1', 'm1', 'm2', 'e1'] });
    expect(created[0].approverIds.sort()).toEqual(['a1', 'm1', 'm2']);
  });

  it('routes a Custom meeting with only Team Leads to those Team Leads', async () => {
    const { service, created } = build([user('me', 'EMPLOYEE'), user('t1', 'TEAM_LEAD', 'd2'), user('t2', 'TEAM_LEAD', 'd3')]);
    await service.start('me', { agenda: 'Sync', type: 'CUSTOM', participantIds: ['t1', 't2'] });
    expect(created[0].approverIds.sort()).toEqual(['t1', 't2', 'tl']);
  });

  it('requires the Team Leader of every department in a cross-department employee meeting', async () => {
    const tlA = user('tl-a', 'TEAM_LEAD', 'd1');
    const tlB = user('tl-b', 'TEAM_LEAD', 'd2');
    const { service, created } = build([user('me', 'EMPLOYEE', 'd1'), user('b1', 'EMPLOYEE', 'd2'), tlA, tlB], []);
    await service.start('me', { agenda: 'A and B sync', type: 'EXTERNAL', participantIds: ['b1'], approverIds: ['tl-a', 'tl-b'] });
    expect(created[0].approverIds.sort()).toEqual(['tl-a', 'tl-b']);
  });

  it('rejects a cross-department meeting when one department has no selected approver', async () => {
    const { service } = build([
      user('me', 'EMPLOYEE', 'd1'), user('b1', 'EMPLOYEE', 'd2'),
      user('tl-a', 'TEAM_LEAD', 'd1'), user('tl-b', 'TEAM_LEAD', 'd2'),
    ], []);
    await expect(service.start('me', { agenda: 'A and B sync', type: 'EXTERNAL', participantIds: ['b1'], approverIds: ['tl-a'] }))
      .rejects.toThrow('Choose an approver for d2');
  });

  it('skips a department Team Leader on approved leave and offers its Manager', async () => {
    const tl = user('tl-b', 'TEAM_LEAD', 'd2');
    const manager = user('mgr-b', 'MANAGER', 'd2');
    const { service, prisma, created } = build([user('me', 'EMPLOYEE', 'd1'), user('b1', 'EMPLOYEE', 'd2'), user('tl-a', 'TEAM_LEAD', 'd1'), tl, manager], []);
    prisma.leaveRequest.findMany.mockResolvedValue([{ userId: 'tl-b' }]);
    await service.start('me', { agenda: 'A and B sync', type: 'EXTERNAL', participantIds: ['b1'], approverIds: ['tl-a', 'mgr-b'] });
    expect(created[0].approverIds.sort()).toEqual(['mgr-b', 'tl-a']);
  });

  it('only accepts an approver override from the reporting line', async () => {
    const { service } = build([user('me', 'EMPLOYEE'), user('p1', 'EMPLOYEE')]);
    await expect(service.start('me', { agenda: 'Sync', type: 'ONE_ON_ONE', participantIds: ['p1'], approverId: 'someone-else' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses people who are already in a meeting', async () => {
    const { service, prisma } = build([user('me', 'TEAM_LEAD'), user('p1', 'EMPLOYEE')]);
    prisma.breakLog.findMany.mockResolvedValue([{ userId: 'p1' }]);
    await expect(service.start('me', { agenda: 'Sync', type: 'INTERNAL', participantIds: ['p1'] })).rejects.toBeInstanceOf(ConflictException);
  });

  it('removes the meeting again if work could not be paused', async () => {
    const { service, prisma, workday } = build([user('me', 'TEAM_LEAD'), user('p1', 'EMPLOYEE')]);
    workday.startBreak.mockRejectedValue(new ForbiddenException('No active working session'));
    await expect(service.start('me', { agenda: 'Sync', type: 'INTERNAL', participantIds: ['p1'] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.meeting.delete).toHaveBeenCalled();
  });

  it('notifies every invited collaborator', async () => {
    const { service, notifications } = build([user('me', 'TEAM_LEAD'), user('p1', 'EMPLOYEE'), user('p2', 'EMPLOYEE')]);
    await service.start('me', { agenda: 'Sync', type: 'INTERNAL', participantIds: ['p1', 'p2'] });
    expect(notifications.create.mock.calls.filter((c: any[]) => c[1] === 'Meeting invite').map((c: any[]) => c[0]).sort()).toEqual(['p1', 'p2']);
  });

  it('notifies required approvers as soon as the meeting starts', async () => {
    const { service, notifications } = build([user('me', 'EMPLOYEE'), user('p1', 'EMPLOYEE')]);
    await service.start('me', { agenda: 'Sync', type: 'INTERNAL', participantIds: ['p1'] });
    expect(notifications.create).toHaveBeenCalledWith(
      'tl',
      'Meeting started — validation will be needed',
      expect.stringContaining('You will be asked to validate'),
      expect.anything(),
      '/dashboard',
      'm1',
      'Meeting',
    );
  });

  it('keeps a multi-department meeting pending until every required approver responds', async () => {
    const { service, prisma } = build([user('me', 'EMPLOYEE'), user('tl-a', 'TEAM_LEAD'), user('tl-b', 'TEAM_LEAD', 'd2')], []);
    prisma.meeting.findUnique.mockResolvedValue({
      id: 'm1', topic: 'A and B sync', organizerId: 'me', approverIds: ['tl-a', 'tl-b'], approvalStatus: 'PENDING', status: 'COMPLETED',
    });
    prisma.meetingApprovalResponse.findUnique.mockResolvedValue({ id: 'r1', meetingId: 'm1', approverId: 'tl-a', status: 'PENDING' });
    prisma.meetingApprovalResponse.count.mockResolvedValue(1);
    await expect(service.decide('tl-a', 'm1', true)).resolves.toEqual({ approvalStatus: 'PENDING' });
    expect(prisma.meeting.update).not.toHaveBeenCalled();
  });

  it('confirms a multi-department meeting after the final required approval', async () => {
    const { service, prisma } = build([user('me', 'EMPLOYEE'), user('tl-a', 'TEAM_LEAD'), user('tl-b', 'TEAM_LEAD', 'd2')], []);
    prisma.meeting.findUnique.mockResolvedValue({
      id: 'm1', topic: 'A and B sync', organizerId: 'me', approverIds: ['tl-a', 'tl-b'], approvalStatus: 'PENDING', status: 'COMPLETED',
    });
    prisma.meetingApprovalResponse.findUnique.mockResolvedValue({ id: 'r2', meetingId: 'm1', approverId: 'tl-b', status: 'PENDING' });
    prisma.meetingApprovalResponse.count.mockResolvedValue(0);
    await expect(service.decide('tl-b', 'm1', true)).resolves.toEqual({ approvalStatus: 'APPROVED' });
    expect(prisma.meeting.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ approvalStatus: 'APPROVED' }) }));
  });
});
