import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateWorkdayNoteDto } from './dto/create-workday-note.dto';

@Injectable()
export class WorkdayNotesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, page = 1, limit = 20) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
    const where = { userId };
    const [total, notes] = await Promise.all([
      this.prisma.workdayNote.count({ where }),
      this.prisma.workdayNote.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        select: { id: true, content: true, createdAt: true, workSessionId: true },
      }),
    ]);
    return { notes, total, page: safePage, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) };
  }

  async create(userId: string, dto: CreateWorkdayNoteDto) {
    const content = dto.content.trim();
    if (!content) throw new BadRequestException('Note cannot be empty');

    const existing = await this.prisma.workdayNote.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: dto.idempotencyKey } },
      select: { id: true, content: true, createdAt: true, workSessionId: true },
    });
    if (existing) return existing;

    const activeSession = await this.prisma.workSession.findFirst({
      where: { userId, logoutAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    try {
      return await this.prisma.workdayNote.create({
        data: {
          userId,
          content,
          idempotencyKey: dto.idempotencyKey,
          workSessionId: activeSession?.id ?? null,
        },
        select: { id: true, content: true, createdAt: true, workSessionId: true },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        return this.prisma.workdayNote.findUniqueOrThrow({
          where: { userId_idempotencyKey: { userId, idempotencyKey: dto.idempotencyKey } },
          select: { id: true, content: true, createdAt: true, workSessionId: true },
        });
      }
      throw error;
    }
  }
}
