import { ScheduledUserActivationService } from '../../src/modules/core/users/scheduled-user-activation.service';

const D = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('ScheduledUserActivationService', () => {
  function fixture(ids = ['future-1']) {
    const tx = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      operationalEvent: { create: jest.fn().mockResolvedValue({}) },
      notification: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue(ids.map((id) => ({ id }))) },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    const tva = { companyDateOnly: jest.fn().mockReturnValue(D('2026-10-16')) };
    return { service: new ScheduledUserActivationService(prisma as any, tva as any), prisma, tx };
  }

  it('activates due users and records one durable event and notification', async () => {
    const { service, prisma, tx } = fixture();
    await expect(service.activateDue(D('2026-10-16'))).resolves.toEqual({ checked: 1, activated: 1, failed: [] });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ employmentState: 'SCHEDULED_TO_JOIN', scheduledActivationOn: { lte: D('2026-10-16') } }),
    }));
    expect(tx.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { isActive: true, employmentState: 'ACTIVE', scheduledActivationOn: null },
    }));
    expect(tx.operationalEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'USER_SCHEDULED_ACTIVATED' }) });
    expect(tx.notification.create).toHaveBeenCalled();
  });

  it('does not duplicate evidence when another worker already activated the row', async () => {
    const { service, tx } = fixture();
    tx.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.activateDue(D('2026-10-16'))).resolves.toEqual({ checked: 1, activated: 0, failed: [] });
    expect(tx.operationalEvent.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('isolates one employee failure and continues with the next', async () => {
    const { service, prisma } = fixture(['bad', 'good']);
    prisma.$transaction
      .mockRejectedValueOnce(new Error('database problem'))
      .mockImplementationOnce(async (callback: any) => callback({
        user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        operationalEvent: { create: jest.fn().mockResolvedValue({}) },
        notification: { create: jest.fn().mockResolvedValue({}) },
      }));
    await expect(service.activateDue(D('2026-10-16'))).resolves.toEqual({ checked: 2, activated: 1, failed: ['bad'] });
  });
});
