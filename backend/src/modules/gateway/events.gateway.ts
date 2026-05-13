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

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  transports: ['websocket', 'polling'],
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger('EventsGateway');

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
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

      const payload = this.jwtService.verify<{ sub: string; email: string }>(token, {
        secret: this.configService.get<string>('JWT_SECRET', 'nexus-secret'),
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

  /** Broadcast to every connected client */
  emitTicketCreated(ticket: any) {
    this.server.emit('ticket:created', { ticket });
  }

  /** Broadcast status change to everyone (kanban/list pages update live) */
  emitTicketStatusChanged(ticketId: string, newStatus: string, updatedBy: string) {
    this.server.emit('ticket:status_changed', { ticketId, newStatus, updatedBy });
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
