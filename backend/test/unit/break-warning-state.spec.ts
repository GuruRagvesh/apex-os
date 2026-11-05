import { ConflictException } from '@nestjs/common';
import { WorkdayService } from '../../src/modules/platform/workday/workday.service';
import { dueBreakWarningsWhere } from '../../src/modules/platform/scheduler/scheduler.service';

describe('break warning state on BreakLog', () => {
  const now = new Date('2026-11-05T10:00:00.000Z');

  function build() {
    const prisma = {
      breakLog: { findFirst: jest.fn(), updateMany: jest.fn() },
    };
    const notifications = { emitBreakWarningChanged: jest.fn() };
    const tva = { now: jest.fn().mockReturnValue(now) };
    const service = new WorkdayService(
      prisma as any, {} as any, {} as any, {} as any, notifications as any, {} as any, tva as any,
    );
    return { prisma, notifications, service };
  }

  it('reads the active warning from the break row, not app settings', async () => {
    const { prisma, service } = build();
    prisma.breakLog.findFirst.mockResolvedValue({
      id: 'b1', breakType: 'TEA', estimatedMinutes: 30, plannedEndAt: now, startAt: now,
      warningStage: 'EARLY_ACTIVE', warningUpdatedAt: now,
    });

    await expect(service.getActiveBreakWarning('u1')).resolves.toMatchObject({
      warning: { breakLogId: 'b1', phase: 'EARLY', triggeredAt: now },
    });
    expect(prisma.breakLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', endAt: null, warningStage: { in: ['EARLY_ACTIVE', 'FINAL_ACTIVE'] } },
    }));
  });

  it('arms the final alarm when Later is chosen on the early warning', async () => {
    const { prisma, notifications, service } = build();
    prisma.breakLog.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.handleBreakWarning('u1', { breakLogId: 'b1', phase: 'EARLY', action: 'LATER' }))
      .resolves.toEqual({ ok: true, warningStage: 'FINAL_PENDING' });
    expect(prisma.breakLog.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', userId: 'u1', endAt: null, warningStage: 'EARLY_ACTIVE' },
      data: { warningStage: 'FINAL_PENDING', warningUpdatedAt: now },
    });
    expect(notifications.emitBreakWarningChanged).toHaveBeenCalledWith('u1', 'b1');
  });

  it('rejects Later once the warning was already handled on another device', async () => {
    const { prisma, notifications, service } = build();
    prisma.breakLog.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.handleBreakWarning('u1', { breakLogId: 'b1', phase: 'FINAL', action: 'LATER' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(notifications.emitBreakWarningChanged).not.toHaveBeenCalled();
  });

  it('selects only open, non-meeting breaks whose alarm is due', () => {
    const where: any = dueBreakWarningsWhere(now);
    const earlyCutoff = new Date('2026-11-05T10:05:00.000Z');
    expect(where.endAt).toBeNull();
    expect(where.breakType).toEqual({ not: 'MEETING' });
    expect(where.OR).toEqual([
      { warningStage: 'PENDING', estimatedMinutes: { gt: 5 }, plannedEndAt: { lte: earlyCutoff } },
      { warningStage: 'PENDING', estimatedMinutes: null, plannedEndAt: { lte: earlyCutoff } },
      { warningStage: 'PENDING', estimatedMinutes: { lte: 5 }, plannedEndAt: { lte: now } },
      { warningStage: 'FINAL_PENDING', plannedEndAt: { lte: now } },
    ]);
  });
});
