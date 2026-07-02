import { BadRequestException } from '@nestjs/common';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';

// TicketsService.getRoutingDepartments — selectable TARGET departments for
// cross-department QUERY/HELP routing (GET /tickets/routing-departments).
// Deliberately unscoped by caller — unlike GET /departments (DepartmentsService
// .findAll), which is filtered to the caller's own/managed department(s) for every
// non-admin role. That scoping is exactly what broke the Target Department dropdown
// on the create-ticket page: a Team Lead or Employee raising a QUERY/HELP request
// could only ever see their own department as a "target", defeating the entire
// point of cross-department routing.
describe('TicketsService.getRoutingDepartments', () => {
  let prisma: any;
  let service: TicketsService;

  // Deliberately includes fields beyond the minimal DTO (description, color,
  // createdAt) to prove the response mapping strips everything but id/name.
  const allDepartments = [
    { id: 'dept-c', name: 'Customer Success', description: 'CS team', color: '#fff', createdAt: new Date('2025-01-01') },
    { id: 'dept-a', name: 'Accounting', description: 'Finance', color: '#000', createdAt: new Date('2025-02-01') },
    { id: 'dept-b', name: 'Backend Engineering', description: 'Eng', color: '#111', createdAt: new Date('2025-03-01') },
  ];

  function makeService(departments: any[]) {
    prisma = {
      department: {
        // select-only query — the mock returns whichever fields the caller asked
        // for, mirroring real Prisma `select` behavior, so the test can prove the
        // service only requests {id, name} rather than trusting a hand-picked mock.
        findMany: jest.fn(async ({ select, orderBy }: any) => {
          let rows = departments.map((d) => {
            if (!select) return d;
            const picked: any = {};
            for (const key of Object.keys(select)) if (select[key]) picked[key] = (d as any)[key];
            return picked;
          });
          if (orderBy?.name === 'asc') rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
          return rows;
        }),
      },
    };
    return new TicketsService(
      prisma,
      {} as any, // gateway
      {} as any, // notificationEventService
      {} as any, // configService
      {} as any, // eventEmitter
      {} as any, // eventLogger
      {} as any, // ticketAccess (not used by getRoutingDepartments)
      {} as any, // hierarchyApprovalService
      {} as any, // ticketTiming
      {} as any, // ticketLedger
      {} as any, // ticketImport
    );
  }

  it('rejects type=TASK — TASK keeps its existing department-scoped flow, never this endpoint', async () => {
    service = makeService(allDepartments);
    await expect(service.getRoutingDepartments('TASK')).rejects.toThrow(BadRequestException);
  });

  it('rejects a missing/empty type', async () => {
    service = makeService(allDepartments);
    await expect(service.getRoutingDepartments(undefined)).rejects.toThrow(BadRequestException);
  });

  it('QUERY returns every department in the company, not just the caller\'s own', async () => {
    service = makeService(allDepartments);
    const result = await service.getRoutingDepartments('QUERY');
    expect(result.map((d: any) => d.id).sort()).toEqual(['dept-a', 'dept-b', 'dept-c']);
  });

  it('HELP returns the same unscoped list as QUERY', async () => {
    service = makeService(allDepartments);
    const result = await service.getRoutingDepartments('HELP');
    expect(result.map((d: any) => d.id).sort()).toEqual(['dept-a', 'dept-b', 'dept-c']);
  });

  it('is sorted by name', async () => {
    service = makeService(allDepartments);
    const result = await service.getRoutingDepartments('QUERY');
    expect(result.map((d: any) => d.name)).toEqual(['Accounting', 'Backend Engineering', 'Customer Success']);
  });

  it('returns only minimal fields — id and name, never description/color/other metadata', async () => {
    service = makeService(allDepartments);
    const result = await service.getRoutingDepartments('QUERY');
    const target = result.find((d: any) => d.id === 'dept-a');
    expect(target).toEqual({ id: 'dept-a', name: 'Accounting' });
    expect((target as any).description).toBeUndefined();
    expect((target as any).color).toBeUndefined();
    expect((target as any).createdAt).toBeUndefined();
  });

  it('never queries or exposes users — departments only', async () => {
    service = makeService(allDepartments);
    await service.getRoutingDepartments('QUERY');
    expect(prisma.department.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  });
});
