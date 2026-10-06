import * as fs from 'fs';
import * as path from 'path';
import { TicketStatus } from '@prisma/client';
import { KANBAN_TICKET_INCLUDE, TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import {
  KANBAN_DROP_CLICK_GUARD_MS,
  KANBAN_LOCKED_LANES,
  canMoveFromKanbanLane,
  isKanbanCardOpenKey,
  isKanbanLaneLocked,
  kanbanCardHref,
  shouldOpenKanbanCardOnClick,
} from '../../../platforms/operations/tickets/lifecycle/shared/kanban-card-interaction';

const root = path.resolve(__dirname, '../../..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const screenPath = 'platforms/operations/tickets/lifecycle/frontend/screens/KanbanScreen.tsx';

/** Every key anywhere inside a Prisma include/select tree. */
function keysDeep(value: unknown, out: string[] = []): string[] {
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      out.push(key);
      keysDeep(child, out);
    }
  }
  return out;
}

/** The source between two markers (a component or method body). */
function between(src: string, start: string, end: string): string {
  const from = src.indexOf(start);
  const to = src.indexOf(end, from + start.length);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return src.slice(from, to);
}

function kanbanService(rows: any[]) {
  const scopedWhere = { AND: [{ departmentId: 'dept-1' }, { title: { contains: 'invoice' } }] };
  const findMany = jest.fn().mockResolvedValue(rows);
  const buildTicketWhereForUser = jest.fn().mockResolvedValue(scopedWhere);
  const service: any = Object.create(TicketsService.prototype);
  service.ticketAccess = { buildTicketWhereForUser };
  service.prisma = { ticket: { findMany } };
  service.addSlaMany = jest.fn(async (tickets: any[]) => tickets);
  return { service, findMany, buildTicketWhereForUser, scopedWhere };
}

describe('Kanban payload: lean include without inline profile photos', () => {
  it('getKanban queries with the lean Kanban include', async () => {
    const { service, findMany } = kanbanService([]);
    await service.getKanban({}, { id: 'admin-1' });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].include).toBe(KANBAN_TICKET_INCLUDE);
  });

  it('never selects photoUrl for assignedTo, createdBy, assignees.user or anywhere else', () => {
    expect(keysDeep(KANBAN_TICKET_INCLUDE)).not.toContain('photoUrl');
    expect(KANBAN_TICKET_INCLUDE.assignedTo.select).not.toHaveProperty('photoUrl');
    expect(KANBAN_TICKET_INCLUDE.createdBy.select).not.toHaveProperty('photoUrl');
    expect(KANBAN_TICKET_INCLUDE.assignees.include.user.select).not.toHaveProperty('photoUrl');
  });

  it('other ticket endpoints keep their photo-bearing include', () => {
    const service = read('backend/src/modules/operations/tickets/tickets.service.ts');
    const includeOptions = between(service, 'private includeOptions = {', '  };');
    expect(includeOptions).toContain('photoUrl: true');
    const method = between(service, 'async getKanban(', '/** SLA risk category counts');
    expect(method).toContain('include: KANBAN_TICKET_INCLUDE');
    expect(method).not.toContain('this.includeOptions');
  });

  it('still includes every relation and field the Kanban card and move rules read', () => {
    const src = read(screenPath);
    const card = between(src, 'function CardContent(', '// ─── Draggable card wrapper');
    const fields = new Set(Array.from(card.matchAll(/ticket\.(\w+)/g), (m) => m[1]));
    // Relations the card renders must be included; scalars come back because the
    // include has no top-level select.
    const relations = ['department', 'taskType', 'assignedTo', 'assignees', 'createdBy', 'project', 'taskSubtype'];
    for (const field of fields) {
      if (relations.includes(field)) expect(KANBAN_TICKET_INCLUDE).toHaveProperty(field);
    }
    expect(KANBAN_TICKET_INCLUDE).not.toHaveProperty('select');
    expect(KANBAN_TICKET_INCLUDE.department).toBe(true);
    expect(KANBAN_TICKET_INCLUDE.taskType).toBe(true);
    expect(KANBAN_TICKET_INCLUDE.assignedTo.select).toMatchObject({ id: true, name: true });
    // canMoveCard matches assignees by userId or user.id.
    expect(KANBAN_TICKET_INCLUDE.assignees.include.user.select).toMatchObject({ id: true, name: true });
    expect(fields.has('title')).toBe(true);
    expect(fields.has('assignedTo')).toBe(true);
  });

  it('passes card fields through unchanged', async () => {
    const card = {
      id: 't1', ticketId: 'TKT-1', title: 'Fix invoice', status: TicketStatus.OPEN, priority: 'HIGH', type: 'TASK',
      dueDate: new Date('2026-10-05T13:00:00Z'), estimatedMinutes: 90, isBlocked: false,
      createdById: 'u1', assignedToId: 'u2',
      department: { id: 'd1', name: 'QC', color: '#123456' },
      taskType: { id: 'tt', name: 'Review' },
      assignedTo: { id: 'u2', name: 'Employee B', email: 'b@integration.invalid', avatar: null },
      assignees: [{ userId: 'u2', user: { id: 'u2', name: 'Employee B', avatar: null } }],
    };
    const { service } = kanbanService([card]);
    const result = await service.getKanban({}, { id: 'admin-1' });
    expect(result.OPEN).toEqual([card]);
  });

  it('keeps role, department and search scoping and excludes PENDING_APPROVAL and CLOSED in the query', async () => {
    const filters = { search: 'invoice', departmentId: 'dept-1' };
    const { service, findMany, buildTicketWhereForUser, scopedWhere } = kanbanService([]);
    await service.getKanban(filters, { id: 'lead-1' });
    expect(buildTicketWhereForUser).toHaveBeenCalledWith(filters, { id: 'lead-1' });
    expect(findMany.mock.calls[0][0].where).toEqual({
      AND: [scopedWhere, { status: { notIn: [TicketStatus.PENDING_APPROVAL, TicketStatus.CLOSED] } }],
    });
  });

  it('returns only the OPEN, IN_PROGRESS, REVIEW and DONE lanes', async () => {
    const rows = [
      { id: 'o', status: TicketStatus.OPEN },
      { id: 'p', status: TicketStatus.IN_PROGRESS },
      { id: 'r', status: TicketStatus.REVIEW },
      { id: 'd', status: TicketStatus.DONE },
      // Even if a row slipped past the query, it never becomes a lane.
      { id: 'a', status: TicketStatus.PENDING_APPROVAL },
      { id: 'c', status: TicketStatus.CLOSED },
    ];
    const { service } = kanbanService(rows);
    const result = await service.getKanban({}, { id: 'admin-1' });
    expect(Object.keys(result)).toEqual(['OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE']);
    expect(result.OPEN.map((t: any) => t.id)).toEqual(['o']);
    expect(result.IN_PROGRESS.map((t: any) => t.id)).toEqual(['p']);
    expect(result.REVIEW.map((t: any) => t.id)).toEqual(['r']);
    expect(result.DONE.map((t: any) => t.id)).toEqual(['d']);
  });
});

describe('Kanban card interaction rules', () => {
  it('a normal card opens /tickets/<id>', () => {
    expect(kanbanCardHref('cmttm92w800rgy4dtlh8rq9p3')).toBe('/tickets/cmttm92w800rgy4dtlh8rq9p3');
  });

  it('Enter opens the card; other keys do not', () => {
    expect(isKanbanCardOpenKey('Enter')).toBe(true);
    expect(isKanbanCardOpenKey(' ')).toBe(false);
    expect(isKanbanCardOpenKey('Tab')).toBe(false);
  });

  it('a click right after a drag ends does not open the ticket; a later or first click does', () => {
    const dragEnded = 1_000_000;
    expect(shouldOpenKanbanCardOnClick(dragEnded + 1, dragEnded)).toBe(false);
    expect(shouldOpenKanbanCardOnClick(dragEnded + KANBAN_DROP_CLICK_GUARD_MS - 1, dragEnded)).toBe(false);
    expect(shouldOpenKanbanCardOnClick(dragEnded + KANBAN_DROP_CLICK_GUARD_MS, dragEnded)).toBe(true);
    expect(shouldOpenKanbanCardOnClick(Date.now(), 0)).toBe(true);
  });

  it('REVIEW is the only locked lane; other lanes keep moves when the user may move the card', () => {
    expect(KANBAN_LOCKED_LANES).toEqual(['REVIEW']);
    expect(isKanbanLaneLocked('REVIEW')).toBe(true);
    for (const lane of ['OPEN', 'IN_PROGRESS', 'DONE']) {
      expect(isKanbanLaneLocked(lane)).toBe(false);
      expect(canMoveFromKanbanLane(lane, true)).toBe(true);
      expect(canMoveFromKanbanLane(lane, false)).toBe(false);
    }
    expect(canMoveFromKanbanLane('REVIEW', true)).toBe(false);
  });
});

describe('Kanban screen wiring for card navigation and REVIEW controls', () => {
  const src = read(screenPath);
  const draggable = between(src, 'function DraggableCard(', '// ─── Droppable column');
  const column = between(src, 'function DroppableColumn(', 'type KanbanData');

  it('the whole card opens the ticket on click and on Enter, guarded after a drag', () => {
    expect(draggable).toContain('const openTicket = () => router.push(kanbanCardHref(ticket.id))');
    expect(draggable).toContain('if (shouldOpenKanbanCardOnClick(Date.now(), dragEndedAt.current)) openTicket();');
    expect(draggable).toContain('if (isKanbanCardOpenKey(e.key)) openTicket();');
    expect(draggable).toContain('dragEndedAt.current = Date.now()');
    expect(draggable).toContain('tabIndex={0}');
  });

  it('REVIEW cards cannot be dragged and still open normally', () => {
    expect(draggable).toContain('const canDrag = canMoveFromKanbanLane(columnKey, canMove)');
    expect(draggable).toContain('disabled: isPending || !canDrag');
    // Navigation is not gated on canDrag.
    const onClick = between(draggable, 'onClick={() => {', '}}');
    expect(onClick).not.toContain('canDrag');
  });

  it('REVIEW cards have no Back/Move buttons; other lanes keep them', () => {
    expect(column).toContain('canMoveFromKanbanLane(col.key, canMoveCard(ticket))');
    expect(column).toContain('← Back');
    expect(column).toContain('Move →');
  });

  it('move buttons never trigger card navigation', () => {
    // The buttons render after the self-closing card, outside its click handler,
    // and stop propagation anyway.
    const cardEnd = column.indexOf('<DraggableCard');
    const cardClose = column.indexOf('/>', cardEnd);
    expect(column.indexOf('← Back')).toBeGreaterThan(cardClose);
    expect(column).toContain('onClick={(e) => { e.stopPropagation(); onMovePrev(ticket.id); }}');
    expect(column).toContain('onClick={(e) => { e.stopPropagation(); onMoveNext(ticket.id); }}');
    expect(column.match(/type="button"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('a board move out of REVIEW is refused before any optimistic update or API call', () => {
    const move = between(src, 'const moveTicket = (', 'moveMutation.mutate(');
    const guard = move.indexOf('isKanbanLaneLocked(fromColumn)');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(move.indexOf('setLocalKanban('));
  });

  it('failed moves show the backend reason safely', () => {
    expect(src).toContain("toast.error(err?.message || 'Failed to move ticket — reverting')");
  });
});

describe('Kanban fixes stay in place', () => {
  it('Tailwind scans the platform and shared packages', () => {
    const tailwind = read('frontend/tailwind.config.ts');
    expect(tailwind).toContain('"../platforms/**/*.{ts,tsx}"');
    expect(tailwind).toContain('"../shared/**/*.{ts,tsx}"');
  });

  it('the sidebar workday query has a queryFn', () => {
    const sidebar = read('frontend/components/layout/sidebar.tsx');
    const query = between(sidebar, "queryKey: ['workday-today']", '});');
    expect(query).toContain('queryFn: () => workdayApi.getToday()');
  });

  it('the four lanes are labelled Open, In Progress, Under Review and Done', () => {
    const src = read(screenPath);
    for (const label of ["label: 'Open'", "label: 'In Progress'", "label: 'Under Review'", "label: 'Done'"]) {
      expect(src).toContain(label);
    }
  });
});
