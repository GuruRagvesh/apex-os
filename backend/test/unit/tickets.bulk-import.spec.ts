/**
 * Unit tests — Bulk ticket creation (POST /tickets/bulk) + Excel import preview.
 *
 * Covers:
 *  - createBulk(): all-or-nothing transaction, row-level validation, sequential
 *    ticket IDs, max-row limit, empty input, department-access enforcement.
 *  - previewImport(): name/email → id resolution, IST wall-clock → UTC conversion
 *    (the +5:30 scheduling bug regression), per-row valid/error reporting.
 *
 * TicketsService is constructed directly with mocks (no TestingModule) so the
 * Prisma transaction and the TicketImportService parser can be precisely faked.
 */

import { BadRequestException } from '@nestjs/common';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { TicketImportService } from '../../src/modules/operations/tickets/ticket-import.service';

function makePrisma() {
  // tx.ticket.create pushes here; tx.$queryRaw derives the high-water mark from its
  // length so generated ids come out sequential (TKT-001, TKT-002, ...).
  const created: any[] = [];

  const tx: any = {
    $queryRaw: jest.fn(async () => [{ max: created.length }]),
    ticket: {
      create: jest.fn(async ({ data }: any) => {
        const t = { id: `db-${created.length + 1}`, ...data, assignedTo: data.assignedToId ? { id: data.assignedToId } : null };
        created.push(t);
        return t;
      }),
    },
    ticketAssignee: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };

  const prisma: any = {
    _created: created,
    department: { findFirst: jest.fn(async () => ({ id: 'dept-1', name: 'Marketing' })) },
    user: { findFirst: jest.fn(async () => ({ id: 'user-1', name: 'Jane', email: 'jane@company.com' })) },
    taskType: { findFirst: jest.fn(async () => ({ id: 'tt-1', name: 'Design' })) },
    taskSubtype: { findFirst: jest.fn(async () => null) },
    project: { findFirst: jest.fn(async () => null) },
    ticket: { create: jest.fn() },
    ticketAssignee: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    activityLog: { create: jest.fn().mockResolvedValue({}) },
    appSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    $queryRaw: jest.fn().mockResolvedValue([{ max: 0 }]),
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };

  return { prisma, tx };
}

function makeService(prisma: any, ticketImport: any = {}, ticketAccess: any = {}) {
  return new TicketsService(
    prisma,
    { emitTicketCreated: jest.fn(), emitTicketStatusChanged: jest.fn() } as any, // gateway
    { sendNotification: jest.fn().mockResolvedValue(null) } as any, // notificationEventService
    { get: jest.fn() } as any, // configService
    { emit: jest.fn() } as any, // eventEmitter
    { log: jest.fn().mockReturnValue({ catch: jest.fn() }) } as any, // eventLogger
    { assertCanCreateInDepartment: jest.fn().mockResolvedValue(undefined), ...ticketAccess } as any, // ticketAccess
    { decorateTicket: jest.fn((t: any) => Promise.resolve(t)) } as any, // ticketTiming
    { startReviewCycle: jest.fn(), endReviewCycle: jest.fn() } as any, // ticketLedger
    ticketImport, // ticketImport
  );
}

const manager = { id: 'creator-1', role: { name: 'MANAGER' } };

describe('TicketsService.createBulk — all-or-nothing bulk creation', () => {
  const validRow = (over: any = {}) => ({
    type: 'TASK',
    title: 'Bulk ticket',
    departmentId: 'dept-1',
    taskTypeId: 'tt-1',
    assignedToId: 'user-1',
    assigneeIds: ['user-1'],
    priority: 'HIGH',
    dueDate: '2026-06-26T12:30:00.000Z',
    ...over,
  });

  it('creates one ticket per row with sequential TKT ids', async () => {
    const { prisma, tx } = makePrisma();
    const service = makeService(prisma);

    const result = await service.createBulk([validRow(), validRow({ title: 'Second' })], 'creator-1', manager);

    expect(result).toHaveLength(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.ticket.create).toHaveBeenCalledTimes(2);
    const ids = tx.ticket.create.mock.calls.map((c: any) => c[0].data.ticketId);
    expect(ids).toEqual(['TKT-001', 'TKT-002']);
    // category defaulted to a valid enum even though rows never supplied one
    expect(tx.ticket.create.mock.calls[0][0].data.category).toBe('OPERATIONS');
  });

  it('creates ZERO tickets if any row is invalid (all-or-nothing) and returns row errors', async () => {
    const { prisma, tx } = makePrisma();
    const service = makeService(prisma);

    let err: any;
    try {
      await service.createBulk([validRow(), validRow({ title: '' })], 'creator-1', manager);
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(BadRequestException);
    const body = err.getResponse();
    expect(body.errors).toEqual([{ row: 2, error: expect.stringContaining('Title is required') }]);
    // The transaction must never start when validation fails.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.ticket.create).not.toHaveBeenCalled();
  });

  it('rejects an empty batch', async () => {
    const { prisma } = makePrisma();
    const service = makeService(prisma);
    await expect(service.createBulk([], 'creator-1', manager)).rejects.toThrow(BadRequestException);
  });

  it('rejects a batch larger than the 100-row limit', async () => {
    const { prisma } = makePrisma();
    const service = makeService(prisma);
    const rows = Array.from({ length: 101 }, () => validRow());
    await expect(service.createBulk(rows, 'creator-1', manager)).rejects.toThrow(/maximum|more than 100/i);
  });

  it('blocks creation in a department the creator cannot access (no tickets created)', async () => {
    const { prisma, tx } = makePrisma();
    const service = makeService(prisma, {}, {
      assertCanCreateInDepartment: jest.fn().mockRejectedValue(new Error('You do not have permission to create tickets in this department')),
    });

    let err: any;
    try {
      await service.createBulk([validRow()], 'creator-1', manager);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().errors[0].error).toMatch(/permission to create tickets/i);
    expect(tx.ticket.create).not.toHaveBeenCalled();
  });
});

describe('TicketsService.previewImport — Excel row mapping + validation', () => {
  const baseRaw = (over: any = {}) => ({
    type: 'TASK',
    title: 'Create poster design',
    department: 'Marketing',
    taskType: 'Design',
    assigneeEmail: 'jane@company.com',
    priority: 'HIGH',
    dueDate: '2026-06-26',
    dueTime: '18:00',
    ...over,
  });

  const importWith = (rawRows: any[]) => ({
    parseRows: jest.fn().mockResolvedValue(rawRows.map((raw, i) => ({ row: i + 1, raw }))),
  });

  it('resolves names + email to ids and marks a complete row valid', async () => {
    const { prisma } = makePrisma();
    const service = makeService(prisma, importWith([baseRaw()]));

    const out = await service.previewImport(Buffer.from(''), 'creator-1', manager);

    expect(out.totalRows).toBe(1);
    expect(out.validCount).toBe(1);
    expect(out.errorCount).toBe(0);
    const row = out.rows[0];
    expect(row.valid).toBe(true);
    expect(row.payload.departmentId).toBe('dept-1');
    expect(row.payload.taskTypeId).toBe('tt-1');
    expect(row.payload.assignedToId).toBe('user-1');
    expect(row.display.assignee).toBe('Jane (jane@company.com)');
  });

  it('combines Due Date + Due Time as IST wall-clock and converts to UTC (no +5:30 drift)', async () => {
    const { prisma } = makePrisma();
    const service = makeService(prisma, importWith([baseRaw()]));

    const out = await service.previewImport(Buffer.from(''), 'creator-1', manager);
    // 18:00 IST on 2026-06-26 == 12:30 UTC. Must NOT be stored as 18:00Z.
    expect(out.rows[0].payload.dueDate).toBe('2026-06-26T12:30:00.000Z');
  });

  it('converts Schedule Start wall-clock 14:15 IST to 08:45 UTC (scheduling bug regression)', async () => {
    const { prisma } = makePrisma();
    const service = makeService(prisma, importWith([baseRaw({ scheduleStart: '2026-06-25T14:15', scheduleEnd: '2026-06-25T16:15' })]));

    const out = await service.previewImport(Buffer.from(''), 'creator-1', manager);
    expect(out.rows[0].payload.scheduledStartAt).toBe('2026-06-25T08:45:00.000Z');
    expect(out.rows[0].payload.scheduledEndAt).toBe('2026-06-25T10:45:00.000Z');
  });

  it('sums Est Hours + Est Minutes into total minutes', async () => {
    const { prisma } = makePrisma();
    const service = makeService(prisma, importWith([baseRaw({ estHours: '2', estMinutes: '30' })]));

    const out = await service.previewImport(Buffer.from(''), 'creator-1', manager);
    expect(out.rows[0].payload.estimatedMinutes).toBe(150);
  });

  it('flags a row whose assignee email matches no active user', async () => {
    const { prisma } = makePrisma();
    prisma.user.findFirst.mockResolvedValue(null); // email resolves to nobody
    const service = makeService(prisma, importWith([baseRaw({ assigneeEmail: 'ghost@company.com' })]));

    const out = await service.previewImport(Buffer.from(''), 'creator-1', manager);
    expect(out.rows[0].valid).toBe(false);
    expect(out.rows[0].error).toMatch(/No active user with email "ghost@company.com"/);
  });

  it('flags a row whose department name does not exist (single, precise message)', async () => {
    const { prisma } = makePrisma();
    prisma.department.findFirst.mockResolvedValue(null);
    const service = makeService(prisma, importWith([baseRaw({ department: 'Nope' })]));

    const out = await service.previewImport(Buffer.from(''), 'creator-1', manager);
    expect(out.rows[0].valid).toBe(false);
    expect(out.rows[0].error).toContain('Department "Nope" not found');
    // generic "Department is required" should be suppressed in favor of the precise one
    expect(out.rows[0].error).not.toMatch(/Department is required/);
  });

  it('flags Schedule End that is not after Schedule Start', async () => {
    const { prisma } = makePrisma();
    const service = makeService(prisma, importWith([baseRaw({ scheduleStart: '2026-06-25T16:00', scheduleEnd: '2026-06-25T15:00' })]));

    const out = await service.previewImport(Buffer.from(''), 'creator-1', manager);
    expect(out.rows[0].valid).toBe(false);
    expect(out.rows[0].error).toMatch(/Scheduled End must be after Scheduled Start/);
  });

  it('rejects a file with no data rows', async () => {
    const { prisma } = makePrisma();
    const service = makeService(prisma, importWith([]));
    await expect(service.previewImport(Buffer.from(''), 'creator-1', manager)).rejects.toThrow(/No ticket rows/i);
  });
});

describe('TicketImportService — template generate/parse round-trip', () => {
  const svc = new TicketImportService();

  it('generates a non-empty .xlsx buffer', async () => {
    const buf = await svc.generateTemplate();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('parses the example row back with header → key mapping intact', async () => {
    const buf = await svc.generateTemplate();
    const rows = await svc.parseRows(buf);
    expect(rows).toHaveLength(1); // the single italic example row
    const { raw } = rows[0];
    expect(raw.type).toBe('TASK');
    expect(raw.title).toBe('Create poster design');
    expect(raw.department).toBe('Marketing');
    expect(raw.assigneeEmail).toBe('jane@company.com');
    expect(raw.priority).toBe('HIGH');
    // a date typed into a date cell must round-trip as the same calendar date,
    // not shift by the process timezone
    expect(raw.dueDate).toMatch(/^2026-06-26/);
  });

  it('skips fully blank rows on parse', async () => {
    const buf = await svc.generateTemplate();
    const rows = await svc.parseRows(buf);
    // template has header + 1 example row only; no trailing blank rows returned
    expect(rows.every((r) => Object.values(r.raw).some((v) => v))).toBe(true);
  });
});
