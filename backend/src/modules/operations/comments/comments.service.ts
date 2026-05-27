import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TicketAccessService } from '../../../common/services/ticket-access.service';

@Injectable()
export class CommentsService {
  constructor(
    private prisma: PrismaService,
    private ticketAccess: TicketAccessService,
  ) {}

  async findByTicket(ticketId: string, user: any) {
    await this.ticketAccess.assertCanViewTicket(user, ticketId);
    return this.prisma.comment.findMany({
      where: { ticketId },
      include: { author: { select: { id: true, name: true, avatar: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(ticketId: string, content: string, authorId: string, user: any) {
    await this.ticketAccess.assertCanCreateComment(user, ticketId);
    const comment = await this.prisma.comment.create({
      data: { ticketId, content, authorId },
      include: { author: { select: { id: true, name: true, avatar: true, role: true } } },
    });

    await this.prisma.activityLog.create({
      data: { userId: authorId, action: 'COMMENTED', entityType: 'TICKET', entityId: ticketId },
    });

    return comment;
  }

  async update(id: string, content: string, userId: string, user?: any) {
    const comment = await this.prisma.comment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (user) await this.ticketAccess.assertCanViewTicket(user, comment.ticketId);
    if (comment.authorId !== userId) throw new ForbiddenException('Cannot edit others comments');

    return this.prisma.comment.update({
      where: { id },
      data: { content },
      include: { author: { select: { id: true, name: true, avatar: true } } },
    });
  }

  async remove(id: string, userId: string, userRole: string, user?: any) {
    const comment = await this.prisma.comment.findUnique({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (user) await this.ticketAccess.assertCanViewTicket(user, comment.ticketId);
    if (comment.authorId !== userId && !['ADMIN', 'SUPER_ADMIN'].includes(userRole)) throw new ForbiddenException();
    return this.prisma.comment.delete({ where: { id } });
  }
}
