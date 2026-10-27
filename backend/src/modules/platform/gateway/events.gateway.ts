import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';

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
    @Optional() private prisma?: PrismaService,
  ) {}

  afterInit() {
    this.logger.log('WebSocket Gateway initialized');
  }

  /** True when the account may hold a socket: active, not revoked, not separated. */
  private accountGate = async (userId: string, iat?: number): Promise<boolean> => {
    if (!this.prisma) return true;
    const user: any = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, isSystemAccount: true, sessionsRevokedAt: true, accessEndsAt: true },
    });
    if (!user || !user.isActive || user.isSystemAccount) return false;
    if (user.sessionsRevokedAt && (typeof iat !== 'number' || iat < Math.floor(user.sessionsRevokedAt.getTime() / 1000))) return false;
    if (user.accessEndsAt && user.accessEndsAt.getTime() <= Date.now()) return false;
    return true;
  };

  /** Drops every live socket of a user (separation, deactivation, revocation). */
  disconnectUser(userId: string) {
    try {
      this.server?.in(`user:${userId}`).disconnectSockets(true);
    } catch (err: any) {
      this.logger.warn(`disconnectUser failed for ${userId}: ${err?.message ?? err}`);
    }
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
      const payload = this.jwtService.verify<{ sub: string; email: string; iat?: number }>(token, {
        secret: jwtSecret,
      });

      // Same account checks as the HTTP JWT strategy: an inactive, revoked or
      // separated account keeps no live socket (Phase 4, issue 4).
      if (this.accountGate && !(await this.accountGate(payload.sub, payload.iat))) {
        client.disconnect(true);
        return;
      }

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

  /** Broadcast to every connected client */
  emitTicketCreated(ticket: any) {
    this.server?.emit('ticket:created', { ticket });
  }

  /** Broadcast status change to everyone (kanban/list pages update live) */
  emitTicketStatusChanged(ticketId: string, newStatus: string, updatedBy: string) {
    this.server?.emit('ticket:status_changed', { ticketId, newStatus, updatedBy });
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
