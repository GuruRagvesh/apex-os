import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../../prisma/prisma.service';
import { TicketAccessService } from '../../../common/services/ticket-access.service';

const WS_ORIGINS = [
  'http://localhost:3000',    // local frontend dev server
  process.env.FRONTEND_URL,  // production / staging frontend URL
].filter(Boolean) as string[];

@WebSocketGateway({
  cors: { origin: WS_ORIGINS, credentials: true },
  transports: ['websocket', 'polling'],
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger('EventsGateway');

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private ticketAccess: TicketAccessService,
  ) {}

  afterInit() {
    this.logger.log('WebSocket Gateway initialized');
  }

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        (client.handshake.headers?.authorization as string)?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      // SECURITY: No fallback — same rule as auth.module.ts (Stage 1 fix).
      // A missing JWT_SECRET means main.ts already exited; reaching here would
      // be a serious bypass. Throw so the WS handshake fails safely.
      const jwtSecret = this.configService.get<string>('JWT_SECRET');
      if (!jwtSecret) throw new Error('JWT_SECRET not configured');
      const payload = this.jwtService.verify<{ sub: string; email: string }>(token, {
        secret: jwtSecret,
      });

      client.data.userId = payload.sub;
      client.join(`user:${payload.sub}`);
      this.logger.log(`Connected: ${payload.sub} (${client.id})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Disconnected: ${client.id}`);
  }

  // ── Ticket events: scoped to the users who may actually VIEW the ticket ────
  //
  // These two were `server.emit(...)` — every authenticated socket received
  // them regardless of REST ticket visibility, which disclosed the full created
  // ticket (title, description, department, project, assignees, creator and
  // assignee emails, and the latest comment body) to any logged-in user
  // including an INTERN. That was BUG-H.
  //
  // The audience is now derived from the SAME authority the REST API uses —
  // TicketAccessService.canViewTicket -> buildTicketWhereForUser -> the scope
  // rules. No role, department or ownership rule is restated here; if REST
  // visibility changes, this changes with it automatically.

  /** The user ids currently holding at least one authenticated socket. */
  private connectedUserIds(): string[] {
    const sockets = this.server?.sockets?.sockets;
    if (!sockets) return [];
    const ids = new Set<string>();
    for (const [, client] of sockets) {
      const userId = (client as Socket).data?.userId;
      if (userId) ids.add(userId);
    }
    return [...ids];
  }

  /**
   * Exactly the connected users allowed to view this ticket.
   *
   * Only connected users are authorised because only they can receive anything
   * — this narrows the candidate set, it can never widen the audience.
   *
   * FAILS CLOSED. Any error resolving the audience returns an empty list, so a
   * live refresh is missed rather than a ticket disclosed. Clients converge
   * anyway: the ticket list refetches on its own queries and the kanban board
   * polls on a 30s interval.
   */
  private async ticketAudience(ticketId: string): Promise<string[]> {
    try {
      const userIds = this.connectedUserIds();
      if (userIds.length === 0) return [];
      // Same shape AccessPolicyService.hydrateUser produces — the scope rules
      // read user.id, user.role.name and user.departmentId.
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        include: { role: true, department: true },
      });
      const allowed: string[] = [];
      for (const user of users) {
        if (await this.ticketAccess.canViewTicket(user, ticketId)) allowed.push(user.id);
      }
      return allowed;
    } catch (err: any) {
      this.logger.error(
        `Could not resolve the audience for ticket ${ticketId}; emitting to nobody: ${err?.message}`,
      );
      return [];
    }
  }

  // Callers fire these without awaiting, so this must never reject — an
  // unhandled rejection would take the process down.
  private async emitToTicketAudience(ticketId: string, event: string, payload: any) {
    try {
      if (!ticketId) return;
      for (const userId of await this.ticketAudience(ticketId)) {
        this.server?.to(`user:${userId}`).emit(event, payload);
      }
    } catch (err: any) {
      this.logger.error(`Failed to emit ${event} for ticket ${ticketId}: ${err?.message}`);
    }
  }

  /** Send to the users who may view this ticket. Payload unchanged. */
  async emitTicketCreated(ticket: any) {
    await this.emitToTicketAudience(ticket?.id, 'ticket:created', { ticket });
  }

  /** Send to the users who may view this ticket. Payload unchanged. */
  async emitTicketStatusChanged(ticketId: string, newStatus: string, updatedBy: string) {
    await this.emitToTicketAudience(ticketId, 'ticket:status_changed', {
      ticketId,
      newStatus,
      updatedBy,
    });
  }

  /** Send a notification only to the target user's room */
  emitNotificationToUser(userId: string, notification: any) {
    this.server.to(`user:${userId}`).emit('notification:new', { notification });
  }

  /** Notify the leave owner about an approval/rejection decision */
  emitLeaveStatusChanged(leaveId: string, status: string, userId: string) {
    this.server.to(`user:${userId}`).emit('leave:status_changed', { leaveId, status });
  }
}
