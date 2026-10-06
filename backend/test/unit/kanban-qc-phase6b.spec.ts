import * as fs from 'fs';
import * as path from 'path';
import { TicketStatus } from '@prisma/client';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';

const root = path.resolve(__dirname, '../../..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('Phase 6B Kanban QC guardrails', () => {
  const screenPath = 'platforms/operations/tickets/lifecycle/frontend/screens/KanbanScreen.tsx';

  it('keeps the four approved lanes in their fixed left-to-right order', () => {
    const src = read(screenPath);
    const open = src.indexOf("key: 'OPEN'");
    const progress = src.indexOf("key: 'IN_PROGRESS'");
    const review = src.indexOf("key: 'REVIEW'");
    const done = src.indexOf("key: 'DONE'");

    expect(open).toBeGreaterThan(-1);
    expect(open).toBeLessThan(progress);
    expect(progress).toBeLessThan(review);
    expect(review).toBeLessThan(done);
    expect(src).toContain("label: 'Under Review'");
  });

  it('renders side-by-side lanes with horizontal small-screen scrolling and vertical card stacks', () => {
    const src = read(screenPath);
    expect(src).toContain('overflow-x-auto pb-3 snap-x snap-mandatory');
    expect(src).toContain('grid grid-cols-4 gap-4 min-w-[70rem]');
    expect(src).toContain('space-y-2.5 overflow-y-auto');
    expect(src).toContain('group-focus-within:opacity-100');
  });

  it('wires a debounced search into the scoped Kanban API request', () => {
    const src = read(screenPath);
    expect(src).toContain("const debouncedSearch = useDebounce(search, 300)");
    expect(src).toContain("...(debouncedSearch ? { search: debouncedSearch } : {})");
    expect(src).toContain('Search Kanban tickets');
    expect(src).toContain('Clear Kanban search');
  });

  it('has explicit loading, failure, retry and manual refresh states', () => {
    const src = read(screenPath);
    expect(src).toContain('isLoading, isFetching, isError, refetch');
    expect(src).toContain('Kanban board could not be loaded');
    expect(src).toContain('No ticket was changed.');
    expect(src).toContain('Refresh Kanban board');
  });

  it('refreshes ticket, dashboard, active-clock, workday and approval views after a move', () => {
    const src = read(screenPath);
    for (const key of [
      "['kanban']",
      "['tickets']",
      "['dashboard-overview']",
      "['ticket-stats']",
      "['activity-feed']",
      "['active-timer']",
      "['workday-today']",
      "['ticket-pending-approvals']",
    ]) {
      expect(src).toContain(`queryKey: ${key}`);
    }
    expect(src).toContain("onSettled: () => qc.invalidateQueries({ queryKey: ['kanban'] })");
  });

  it('keeps backend transition authority and does not invent a second status API', () => {
    const src = read(screenPath);
    expect(src).toContain('ticketsApi.updateStatus(id, status)');
    expect(src).toContain('Exact transitions and role/scope');
    expect(src).not.toContain('const canMoveTo');
    expect(src).toContain('You do not have permission to make that status change');
    expect(src).not.toContain('fetch(`/api/tickets/');
  });

  it('excludes approval-queue and closed tickets before the Kanban query', () => {
    const service = read('backend/src/modules/operations/tickets/tickets.service.ts');
    const method = service.slice(service.indexOf('async getKanban('), service.indexOf('/** SLA risk category counts'));
    expect(method).toContain('TicketStatus.PENDING_APPROVAL');
    expect(method).toContain('TicketStatus.CLOSED');
    expect(method).toContain('buildTicketWhereForUser(filters, user)');
    expect(method).toContain('OPEN: withSla.filter');
    expect(method).toContain('IN_PROGRESS: withSla.filter');
    expect(method).toContain('REVIEW: withSla.filter');
    expect(method).toContain('DONE: withSla.filter');
  });

  it('passes search and department through the existing scoped query and returns only approved lanes', async () => {
    const filters = { search: 'invoice', departmentId: 'dept-1' };
    const scopedWhere = { AND: [{ departmentId: 'dept-1' }, { title: { contains: 'invoice' } }] };
    const rows = [
      { id: 'o', status: TicketStatus.OPEN },
      { id: 'p', status: TicketStatus.IN_PROGRESS },
      { id: 'r', status: TicketStatus.REVIEW },
      { id: 'd', status: TicketStatus.DONE },
    ];
    const findMany = jest.fn().mockResolvedValue(rows);
    const buildTicketWhereForUser = jest.fn().mockResolvedValue(scopedWhere);
    const service: any = Object.create(TicketsService.prototype);
    service.ticketAccess = { buildTicketWhereForUser };
    service.prisma = { ticket: { findMany } };
    service.addSlaMany = jest.fn().mockResolvedValue(rows);

    const result = await service.getKanban(filters, { id: 'lead-1' });

    expect(buildTicketWhereForUser).toHaveBeenCalledWith(filters, { id: 'lead-1' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        AND: [
          scopedWhere,
          { status: { notIn: [TicketStatus.PENDING_APPROVAL, TicketStatus.CLOSED] } },
        ],
      },
    }));
    expect(Object.keys(result)).toEqual(['OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE']);
    expect(result).toEqual({
      OPEN: [rows[0]],
      IN_PROGRESS: [rows[1]],
      REVIEW: [rows[2]],
      DONE: [rows[3]],
    });
  });

  it('does not duplicate review status or inaccessible colour-only priority dots on cards', () => {
    const src = read(screenPath);
    expect(src).not.toContain('WAITING FOR REVIEW');
    expect(src).not.toContain('PRIORITY_DOT');
    expect(src).toContain('PRIORITY_LABELS[ticket.priority]');
  });
});
