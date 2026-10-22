import { TicketAccessService } from '../../src/common/services/ticket-access.service';

/**
 * The transfer review grant (D4, correction 2) is limited to the exact ticket,
 * the current review cycle and the REVIEW state. It confers nothing else.
 */
describe('Phase 4 ticket-bound review snapshot', () => {
  const T0 = new Date('2026-10-20T10:00:00Z');
  const ticket = (over: any = {}) => ({ id: 't1', status: 'REVIEW', type: 'TASK', submittedAt: T0, assignedToId: 'worker', assignees: [], ...over });
  const build = (snapshot: any) => {
    const prisma: any = { routingSnapshot: { findFirst: jest.fn(async () => snapshot) } };
    return { svc: new TicketAccessService(prisma, {} as any, {} as any), prisma };
  };
  const snap = (over: any = {}) => ({ resolvedApproverId: 'reviewer', createdAt: new Date(T0.getTime() + 3_600_000), ...over });

  it('grants the frozen reviewer for the current cycle', async () => {
    expect(await build(snap()).svc.transferReviewGrant('reviewer', ticket())).toBe(true);
  });

  it('never grants anyone else', async () => {
    expect(await build(snap()).svc.transferReviewGrant('someone-else', ticket())).toBe(false);
    expect(await build(snap()).svc.transferReviewGrant(undefined, ticket())).toBe(false);
  });

  it('ends when the review is decided (the ticket leaves REVIEW)', async () => {
    for (const status of ['IN_PROGRESS', 'DONE', 'CLOSED', 'OPEN']) {
      expect(await build(snap()).svc.transferReviewGrant('reviewer', ticket({ status }))).toBe(false);
    }
  });

  it('ends on resubmission: a snapshot older than submittedAt does not match the new cycle', async () => {
    const later = ticket({ submittedAt: new Date(T0.getTime() + 2 * 3_600_000) });
    expect(await build(snap()).svc.transferReviewGrant('reviewer', later)).toBe(false);
  });

  it('does not apply to QUERY tickets, to a worker on the ticket, or without a snapshot', async () => {
    expect(await build(snap()).svc.transferReviewGrant('reviewer', ticket({ type: 'QUERY' }))).toBe(false);
    expect(await build(snap({ resolvedApproverId: 'worker' })).svc.transferReviewGrant('worker', ticket())).toBe(false);
    expect(await build(snap({ resolvedApproverId: 'co' })).svc.transferReviewGrant('co', ticket({ assignees: [{ userId: 'co' }] }))).toBe(false);
    expect(await build(null).svc.transferReviewGrant('reviewer', ticket())).toBe(false);
  });

  it('reads only the one ticket (entity id) and the TICKET_REVIEW workflow, never a department', async () => {
    const { svc, prisma } = build(snap());
    await svc.transferReviewGrant('reviewer', ticket());
    expect(prisma.routingSnapshot.findFirst.mock.calls[0][0].where).toEqual({ workflow: 'TICKET_REVIEW', entityType: 'Ticket', entityId: 't1' });
  });

  it('is a REVIEW-exit grant only: viewerCanApprove reflects it, but a status change to REVIEW is not covered', async () => {
    const { svc } = build(snap());
    const user = { id: 'reviewer' };
    expect(await svc.viewerCanApprove(user, ticket())).toBe(true);
    // The transition shortcut applies only when leaving REVIEW.
    const spy = jest.spyOn(svc as any, 'assertCanUpdateTicket').mockRejectedValue(new Error('scope'));
    await expect(svc.assertCanTransitionTicket(user, ticket({ status: 'IN_PROGRESS' }), 'REVIEW' as any)).rejects.toThrow('scope');
    await expect(svc.assertCanTransitionTicket(user, ticket(), 'DONE' as any)).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
