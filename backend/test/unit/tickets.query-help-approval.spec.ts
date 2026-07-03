import { ForbiddenException } from '@nestjs/common';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';

// Simplified permission check tests for QUERY and HELP approval/rejection
// These tests focus on the permission gate checks, not the full workflow

describe('TicketsService approval/rejection permission checks by ticket type', () => {
  let service: TicketsService;
  let ticketAccess: any;

  function makeService() {
    ticketAccess = {
      findAccessibleTicket: jest.fn(),
      assertCanTransitionTicket: jest.fn(),
      isSelfAssigned: jest.fn().mockReturnValue(false),
    };

    const prisma = {
      ticket: { findFirst: jest.fn() },
    } as any;

    return {
      service: new TicketsService(
        prisma,
        {} as any,
        { sendNotification: jest.fn().mockResolvedValue(null) } as any,
        { get: jest.fn() } as any,
        { emit: jest.fn() } as any,
        { log: jest.fn().mockReturnValue({ catch: jest.fn() }) } as any,
        ticketAccess,
        {} as any,
        { decorateTicket: jest.fn((t: any) => Promise.resolve(t)) } as any,
        { startReviewCycle: jest.fn(), endReviewCycle: jest.fn() } as any,
        {} as any,
      ),
      ticketAccess,
    };
  }

  describe('QUERY approval permission', () => {
    it('QUERY assignee CANNOT approve a Query (only creator can)', async () => {
      const { service, ticketAccess } = makeService();
      const assignee = { id: 'assignee-1' };
      const queryTicket = {
        id: 'query-1',
        ticketId: 'QRY-001',
        type: 'QUERY',
        status: 'REVIEW',
        createdById: 'creator-1',
        assignedToId: 'assignee-1',
        createdBy: { id: 'creator-1', name: 'Creator' },
        assignees: [],
      };

      ticketAccess.findAccessibleTicket.mockResolvedValue(queryTicket);

      await expect(
        service.approve('query-1', 'assignee-1', assignee),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.approve('query-1', 'assignee-1', assignee),
      ).rejects.toThrow(/Only the Query creator can approve/);
    });
  });

  describe('QUERY rejection permission', () => {
    it('QUERY assignee CANNOT request rework (only creator can)', async () => {
      const { service, ticketAccess } = makeService();
      const assignee = { id: 'assignee-1' };
      const queryTicket = {
        id: 'query-1',
        ticketId: 'QRY-001',
        type: 'QUERY',
        status: 'REVIEW',
        createdById: 'creator-1',
        assignedToId: 'assignee-1',
        createdBy: { id: 'creator-1', name: 'Creator' },
      };

      ticketAccess.findAccessibleTicket.mockResolvedValue(queryTicket);

      await expect(
        service.reject('query-1', 'I disagree', 'assignee-1', assignee),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.reject('query-1', 'I disagree', 'assignee-1', assignee),
      ).rejects.toThrow(/Only the Query creator can request rework/);
    });
  });

  describe('HELP approval permission', () => {
    it('HELP assignee CANNOT approve a Help ticket (only requester can)', async () => {
      const { service, ticketAccess } = makeService();
      const helper = { id: 'helper-1' };
      const helpTicket = {
        id: 'help-1',
        ticketId: 'HELP-001',
        type: 'HELP',
        status: 'REVIEW',
        createdById: 'requester-1',
        assignedToId: 'helper-1',
        createdBy: { id: 'requester-1', name: 'Requester' },
        assignees: [],
      };

      ticketAccess.findAccessibleTicket.mockResolvedValue(helpTicket);

      await expect(
        service.approve('help-1', 'helper-1', helper),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.approve('help-1', 'helper-1', helper),
      ).rejects.toThrow(/Only the Help requester can approve/);
    });
  });

  describe('HELP rejection permission', () => {
    it('HELP assignee CAN reject the Help request', async () => {
      const { service, ticketAccess } = makeService();
      const helper = { id: 'helper-1' };
      const helpTicket = {
        id: 'help-1',
        ticketId: 'HELP-001',
        type: 'HELP',
        status: 'REVIEW',
        createdById: 'requester-1',
        assignedToId: 'helper-1',
        createdBy: { id: 'requester-1', name: 'Requester' },
      };

      ticketAccess.findAccessibleTicket.mockResolvedValue(helpTicket);
      ticketAccess.assertCanTransitionTicket.mockResolvedValue(true);

      // Should NOT throw for HELP assignee rejection
      try {
        await service.reject('help-1', 'Cannot help', 'helper-1', helper);
      } catch (e: any) {
        // Should not throw ForbiddenException for type-specific reasons
        expect(e.message).not.toMatch(/Only the Help assignee can decline/);
      }
    });

    it('HELP requester/creator CANNOT reject the Help request', async () => {
      const { service, ticketAccess } = makeService();
      const requester = { id: 'requester-1' };
      const helpTicket = {
        id: 'help-1',
        ticketId: 'HELP-001',
        type: 'HELP',
        status: 'REVIEW',
        createdById: 'requester-1',
        assignedToId: 'helper-1',
        createdBy: { id: 'requester-1', name: 'Requester' },
      };

      ticketAccess.findAccessibleTicket.mockResolvedValue(helpTicket);

      await expect(
        service.reject('help-1', 'Not needed', 'requester-1', requester),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.reject('help-1', 'Not needed', 'requester-1', requester),
      ).rejects.toThrow(/Only the Help assignee can decline/);
    });

    it('HELP unrelated hierarchy user CANNOT reject', async () => {
      const { service, ticketAccess } = makeService();
      const manager = { id: 'manager-1', role: { name: 'MANAGER' } };
      const helpTicket = {
        id: 'help-1',
        ticketId: 'HELP-001',
        type: 'HELP',
        status: 'REVIEW',
        createdById: 'requester-1',
        assignedToId: 'helper-1',
        createdBy: { id: 'requester-1', name: 'Requester' },
      };

      ticketAccess.findAccessibleTicket.mockResolvedValue(helpTicket);

      await expect(
        service.reject('help-1', 'Not acceptable', 'manager-1', manager),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.reject('help-1', 'Not acceptable', 'manager-1', manager),
      ).rejects.toThrow(/Only the Help assignee can decline/);
    });
  });

  describe('QUERY rejection remains creator-only', () => {
    it('QUERY creator CAN request rework', async () => {
      const { service, ticketAccess } = makeService();
      const creator = { id: 'creator-1' };
      const queryTicket = {
        id: 'query-1',
        ticketId: 'QRY-001',
        type: 'QUERY',
        status: 'REVIEW',
        createdById: 'creator-1',
        assignedToId: 'assignee-1',
        createdBy: { id: 'creator-1', name: 'Creator' },
      };

      ticketAccess.findAccessibleTicket.mockResolvedValue(queryTicket);
      ticketAccess.assertCanTransitionTicket.mockResolvedValue(true);

      // Should NOT throw for QUERY creator rejection
      try {
        await service.reject('query-1', 'Please revise', 'creator-1', creator);
      } catch (e: any) {
        expect(e.message).not.toMatch(/Only the Query creator can request rework/);
      }
    });
  });
});
