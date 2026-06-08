import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { TicketAccessService } from '../../src/common/services/ticket-access.service';
import { TicketTimingService } from '../../src/common/services/ticket-timing.service';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';

const prisma: any = {
  ticket: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn(),
  },
  attachment: {
    findFirst: jest.fn(),
  },
  department: { findFirst: jest.fn() },
  managerDeptAccess: { findMany: jest.fn().mockResolvedValue([]) },
  appSetting: { findUnique: jest.fn() },
};

describe('P1-D ticket attachment security', () => {
  let service: TicketsService;

  beforeEach(() => {
    jest.clearAllMocks();
    const accessPolicy = new AccessPolicyService(prisma);
    const ticketAccess = new TicketAccessService(prisma, accessPolicy);
    service = new TicketsService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      ticketAccess,
      new TicketTimingService(prisma),
      { now: () => new Date(), companyTimezone: () => 'Asia/Kolkata', companyDayStart: () => new Date(), companyDayEnd: () => new Date(), elapsedSeconds: () => 0 } as any, { startReviewCycle: jest.fn(), endReviewCycle: jest.fn(), getTicketTimers: jest.fn() } as any,
    );
  });

  it('returns attachment bytes metadata only after ticket scope is authorized', async () => {
    prisma.ticket.findFirst.mockResolvedValue({ id: 'ticket1' });
    prisma.ticket.count.mockResolvedValue(1);
    prisma.ticket.findUnique.mockResolvedValue({ id: 'ticket1', attachments: [] });
    prisma.attachment.findFirst.mockResolvedValue({
      id: 'att1',
      ticketId: 'ticket1',
      filename: 'proof.png',
      url: 'data:image/png;base64,AAAA',
    });

    const attachment = await service.getAttachmentForDownload('ticket1', 'att1', {
      id: 'manager1',
      role: { name: 'MANAGER' },
      departmentId: 'dept1',
    });

    expect(attachment.id).toBe('att1');
    expect(prisma.attachment.findFirst).toHaveBeenCalledWith({
      where: { id: 'att1', ticketId: 'ticket1' },
    });
  });

  it('blocks cross-scope direct attachment access through ticket visibility', async () => {
    prisma.ticket.findFirst.mockResolvedValue({ id: 'ticket1' });
    prisma.ticket.count.mockResolvedValue(0);

    await expect(
      service.getAttachmentForDownload('ticket1', 'att1', {
        id: 'employee2',
        role: { name: 'EMPLOYEE' },
        departmentId: 'dept2',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.attachment.findFirst).not.toHaveBeenCalled();
  });

  it('does not expose attachments for deleted or missing tickets', async () => {
    prisma.ticket.findFirst.mockResolvedValue(null);

    await expect(
      service.getAttachmentForDownload('missing-ticket', 'att1', {
        id: 'admin1',
        role: { name: 'ADMIN' },
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.attachment.findFirst).not.toHaveBeenCalled();
  });

  it('removes stored file URLs from attachment API responses', () => {
    const safe = service.sanitizeAttachmentForResponse('ticket1', {
      id: 'att1',
      filename: 'proof.png',
      url: 'https://storage.example/proof.png',
    });

    expect(safe.url).toBeUndefined();
    expect(safe.previewUrl).toContain('/api/tickets/ticket1/attachments/att1/download');
    expect(safe.downloadUrl).toContain('mode=download');
  });

  describe('Upload attachment permissions', () => {
    it('allows assigned employee to upload attachment', async () => {
      const ticket = { assignedToId: 'emp1', createdById: 'mgr1' };
      const user = { id: 'emp1', role: { name: 'EMPLOYEE' } };

      await expect(service.assertCanUploadAttachment(user, ticket)).resolves.toBeUndefined();
    });

    it('allows self-assigned employee to upload attachment', async () => {
      const ticket = { assignedToId: 'emp2', createdById: 'emp2' };
      const user = { id: 'emp2', role: { name: 'EMPLOYEE' } };

      await expect(service.assertCanUploadAttachment(user, ticket)).resolves.toBeUndefined();
    });

    it('blocks unauthorized employee from uploading attachment', async () => {
      const ticket = { assignedToId: 'emp1', createdById: 'mgr1' };
      const user = { id: 'emp3', role: { name: 'EMPLOYEE' } };

      await expect(service.assertCanUploadAttachment(user, ticket)).rejects.toThrow(ForbiddenException);
    });
  });
});
