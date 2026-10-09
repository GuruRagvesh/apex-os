import { BadRequestException } from '@nestjs/common';
import { WorkdayNotesService } from '../../src/modules/platform/workday/workday-notes.service';

describe('WorkdayNotesService', () => {
  let prisma: any;
  let service: WorkdayNotesService;

  beforeEach(() => {
    prisma = {
      workdayNote: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
      },
      workSession: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    service = new WorkdayNotesService(prisma);
  });

  it('lists only the authenticated user, newest first, with bounded pagination', async () => {
    await service.list('u1', 0, 500);
    expect(prisma.workdayNote.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 50,
    }));
  });

  it('creates a note without an active workday and trims plain text', async () => {
    prisma.workdayNote.create.mockImplementation(async ({ data }: any) => ({ id: 'n1', ...data }));
    const note = await service.create('u1', { content: '  remember this  ', idempotencyKey: 'request-123' });
    expect(note).toMatchObject({ userId: 'u1', content: 'remember this', workSessionId: null });
  });

  it('returns the existing note for a duplicate submit key', async () => {
    prisma.workdayNote.findUnique.mockResolvedValue({ id: 'n1', content: 'once' });
    await expect(service.create('u1', { content: 'once', idempotencyKey: 'request-123' })).resolves.toEqual({ id: 'n1', content: 'once' });
    expect(prisma.workdayNote.create).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only notes', async () => {
    await expect(service.create('u1', { content: '   ', idempotencyKey: 'request-123' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
