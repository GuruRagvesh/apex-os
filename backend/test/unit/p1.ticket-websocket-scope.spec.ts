import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { EventsGateway } from '../../src/modules/platform/gateway/events.gateway';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TicketAccessService } from '../../src/common/services/ticket-access.service';

// BUG-H — ticket:created and ticket:status_changed were emitted with
// server.emit(), so every authenticated socket received them regardless of REST
// ticket visibility. ticket:created carried the whole ticket including the
// creator's and assignee's emails and the latest comment body.
//
// These tests pin the fix behaviourally: the audience must be exactly the
// connected users that TicketAccessService.canViewTicket allows, and nothing
// may fall back to a global broadcast.

const TICKET_ID = 'ticket-1';

// A ticket payload shaped like the real one (includeOptions) so a regression
// that leaks it is obvious in the assertion.
const TICKET = {
  id: TICKET_ID,
  ticketId: 'TKT-001',
  title: 'Payroll discrepancy for March',
  description: 'Confidential: salary correction required',
  departmentId: 'dept-finance',
  createdBy: { id: 'u-manager', name: 'Manager', email: 'manager@technoedge.test' },
  assignedTo: { id: 'u-assignee', name: 'Assignee', email: 'assignee@technoedge.test' },
  comments: [{ content: 'Confidential comment body', author: { id: 'u-manager', name: 'Manager' } }],
};

// Connected users: one authorised (assignee), one not (an intern in another
// department). The intern is the case the disclosure was proven reachable by.
const AUTHORISED = { id: 'u-assignee', role: { name: 'EMPLOYEE' }, departmentId: 'dept-finance' };
const UNAUTHORISED = { id: 'u-intern', role: { name: 'INTERN' }, departmentId: 'dept-other' };

describe('EventsGateway — ticket event scope (BUG-H)', () => {
  let gateway: EventsGateway;
  let emitted: Array<{ room: string | null; event: string; payload: any }>;
  let canViewTicket: jest.Mock;

  const makeServer = (connectedUsers: any[]) => {
    const sockets = new Map<string, any>(
      connectedUsers.map((u, i) => [`sock-${i}`, { data: { userId: u.id } }]),
    );
    return {
      sockets: { sockets },
      // A global broadcast would land here with room === null.
      emit: (event: string, payload: any) => emitted.push({ room: null, event, payload }),
      to: (room: string) => ({
        emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
      }),
    };
  };

  const setup = async (connectedUsers: any[]) => {
    emitted = [];
    canViewTicket = jest.fn(async (user: any) => user.id === AUTHORISED.id);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventsGateway,
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn(() => 'test-secret') } },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findMany: jest.fn(async ({ where }: any) =>
                connectedUsers.filter((u) => where.id.in.includes(u.id)),
              ),
            },
          },
        },
        { provide: TicketAccessService, useValue: { canViewTicket } },
      ],
    }).compile();

    gateway = module.get(EventsGateway);
    (gateway as any).server = makeServer(connectedUsers);
    return gateway;
  };

  const roomsFor = (event: string) =>
    emitted.filter((e) => e.event === event).map((e) => e.room);

  describe('ticket:created', () => {
    it('reaches a user authorised to view the ticket', async () => {
      await setup([AUTHORISED, UNAUTHORISED]);
      await gateway.emitTicketCreated(TICKET);
      expect(roomsFor('ticket:created')).toEqual([`user:${AUTHORISED.id}`]);
    });

    it('does NOT reach an unauthorised low-authority user (INTERN)', async () => {
      await setup([AUTHORISED, UNAUTHORISED]);
      await gateway.emitTicketCreated(TICKET);
      expect(roomsFor('ticket:created')).not.toContain(`user:${UNAUTHORISED.id}`);
    });

    it('never broadcasts globally, so no confidential field can leak', async () => {
      await setup([AUTHORISED, UNAUTHORISED]);
      await gateway.emitTicketCreated(TICKET);
      const global = emitted.filter((e) => e.room === null);
      expect(global).toHaveLength(0);
      // and the payload only ever went to the authorised room
      const leaked = emitted.filter((e) => e.room !== `user:${AUTHORISED.id}`);
      expect(leaked).toHaveLength(0);
    });

    it('consults the REST visibility authority for every connected user', async () => {
      await setup([AUTHORISED, UNAUTHORISED]);
      await gateway.emitTicketCreated(TICKET);
      expect(canViewTicket).toHaveBeenCalledTimes(2);
      expect(canViewTicket).toHaveBeenCalledWith(
        expect.objectContaining({ id: UNAUTHORISED.id }),
        TICKET_ID,
      );
    });
  });

  describe('ticket:status_changed', () => {
    it('reaches a user authorised to view the ticket', async () => {
      await setup([AUTHORISED, UNAUTHORISED]);
      await gateway.emitTicketStatusChanged(TICKET_ID, 'IN_PROGRESS', 'u-manager');
      expect(roomsFor('ticket:status_changed')).toEqual([`user:${AUTHORISED.id}`]);
    });

    it('does NOT reach an unauthorised low-authority user (INTERN)', async () => {
      await setup([AUTHORISED, UNAUTHORISED]);
      await gateway.emitTicketStatusChanged(TICKET_ID, 'IN_PROGRESS', 'u-manager');
      expect(roomsFor('ticket:status_changed')).not.toContain(`user:${UNAUTHORISED.id}`);
      expect(emitted.filter((e) => e.room === null)).toHaveLength(0);
    });

    it('preserves the payload contract the ticket detail screen reads', async () => {
      await setup([AUTHORISED]);
      await gateway.emitTicketStatusChanged(TICKET_ID, 'REVIEW', 'u-manager');
      expect(emitted[0].payload).toEqual({
        ticketId: TICKET_ID,
        newStatus: 'REVIEW',
        updatedBy: 'u-manager',
      });
    });
  });

  describe('fails closed', () => {
    it('emits to nobody when the audience cannot be resolved', async () => {
      await setup([AUTHORISED, UNAUTHORISED]);
      canViewTicket.mockRejectedValue(new Error('db down'));
      await gateway.emitTicketCreated(TICKET);
      expect(emitted).toHaveLength(0);
    });

    it('emits to nobody when no user is connected', async () => {
      await setup([]);
      await gateway.emitTicketStatusChanged(TICKET_ID, 'DONE', 'u-manager');
      expect(emitted).toHaveLength(0);
    });

    it('does not reject when called without await, as the ticket service does', async () => {
      await setup([AUTHORISED]);
      canViewTicket.mockRejectedValue(new Error('db down'));
      await expect(gateway.emitTicketCreated(TICKET)).resolves.toBeUndefined();
    });
  });

  describe('user-scoped events are unchanged', () => {
    it('notification:new still targets only the recipient room', async () => {
      await setup([AUTHORISED, UNAUTHORISED]);
      gateway.emitNotificationToUser('u-target', { title: 'Hi' });
      expect(emitted).toEqual([
        { room: 'user:u-target', event: 'notification:new', payload: { notification: { title: 'Hi' } } },
      ]);
    });

    it('leave:status_changed still targets only the leave owner room', async () => {
      await setup([AUTHORISED, UNAUTHORISED]);
      gateway.emitLeaveStatusChanged('leave-1', 'APPROVED', 'u-target');
      expect(emitted).toEqual([
        { room: 'user:u-target', event: 'leave:status_changed', payload: { leaveId: 'leave-1', status: 'APPROVED' } },
      ]);
    });
  });

  describe('no global ticket emit remains in the source', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../src/modules/platform/gateway/events.gateway.ts'),
      'utf8',
    );

    it('has no server.emit for ticket:created', () => {
      expect(src).not.toMatch(/server\??\.emit\(\s*['"]ticket:created['"]/);
    });

    it('has no server.emit for ticket:status_changed', () => {
      expect(src).not.toMatch(/server\??\.emit\(\s*['"]ticket:status_changed['"]/);
    });

    it('routes both ticket events through the audience resolver', () => {
      expect(src).toContain("emitToTicketAudience(ticket?.id, 'ticket:created'");
      expect(src).toContain("emitToTicketAudience(ticketId, 'ticket:status_changed'");
    });
  });
});
