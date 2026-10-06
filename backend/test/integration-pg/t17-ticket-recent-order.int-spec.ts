/**
 * Phase 6C ticket "Recent" ordering against real PostgreSQL.
 *
 * Every ticket list view (All, each status, search + status, department,
 * assignee, overdue, role scope) is one GET /tickets query: filters and the
 * viewer's scope first, then TICKET_LIST_ORDER (updatedAt desc, createdAt
 * desc, id desc), then the page. These tests build the expected list
 * independently in JS from the same rows and compare it with what
 * TicketsService.findAll returns, page by page.
 *
 * Real: Prisma, PostgreSQL, TicketsService.findAll, TicketAccessService scope
 * rules over real users, roles, departments and manager access rows. Doubled:
 * websocket gateway, notifications, event bus, operational event log, and the
 * SLA decorator (it marks a ticket overdue from its own dueDate).
 *
 * Refuses to run unless DATABASE_URL is the dedicated loopback integration
 * database (see db-guard.ts).
 */
import { PrismaService } from '../../src/prisma/prisma.service';
import { TVAService } from '../../src/common/services/tva.service';
import { ActiveWorkdayPolicyService } from '../../src/common/services/active-workday-policy.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { HierarchyApprovalService } from '../../src/common/services/hierarchy-approval.service';
import { TicketAccessService } from '../../src/common/services/ticket-access.service';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { TicketsService } from '../../src/modules/operations/tickets/tickets.service';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';

const D1 = 'd-t17-ops';
const D2 = 'd-t17-other';
const D3 = 'd-t17-managed';
const ADM = 'u-t17-admin';
const MGR = 'u-t17-manager';
const TL = 'u-t17-lead';
const TLX = 'u-t17-lead-other';
const E = 'u-t17-employee';
const E2 = 'u-t17-employee-2';
const EX = 'u-t17-employee-other';
const ROLE_OF: Record<string, string> = {
  [ADM]: 'ADMIN', [MGR]: 'MANAGER', [TL]: 'TEAM_LEAD', [TLX]: 'TEAM_LEAD',
  [E]: 'EMPLOYEE', [E2]: 'EMPLOYEE', [EX]: 'EMPLOYEE',
};
const DEPT_OF: Record<string, string> = { [ADM]: D1, [MGR]: D1, [TL]: D1, [TLX]: D2, [E]: D1, [E2]: D1, [EX]: D2 };
const actor = (id: string) => ({ id, role: { name: ROLE_OF[id] }, departmentId: DEPT_OF[id] });

const STATUSES = ['OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CLOSED'] as const;
const OPEN_STATUSES = new Set(['OPEN', 'IN_PROGRESS', 'REVIEW', 'PENDING_APPROVAL']);

interface Row {
  id: string; ticketId: string; title: string; status: string; departmentId: string;
  assignedToId: string | null; createdById: string; createdAt: Date; updatedAt: Date; dueDate: Date | null;
}

describe('T17 Phase 6C recent ordering in every ticket list view (PostgreSQL)', () => {
  let prisma: PrismaService;
  let tickets: TicketsService;
  const NOW = new Date('2026-10-06T06:00:00.000Z');
  let rows: Row[] = [];

  async function seed() {
    await assertServerIdentity(prisma as any);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE users, roles, departments RESTART IDENTITY CASCADE`);
    await prisma.department.createMany({
      data: [{ id: D1, name: 'T17 Operations' }, { id: D2, name: 'T17 Other' }, { id: D3, name: 'T17 Managed' }] as any,
    });
    await prisma.role.createMany({
      data: [
        { id: 'r-t17-admin', name: 'ADMIN', level: 1 },
        { id: 'r-t17-manager', name: 'MANAGER', level: 2 },
        { id: 'r-t17-lead', name: 'TEAM_LEAD', level: 3 },
        { id: 'r-t17-employee', name: 'EMPLOYEE', level: 4 },
      ] as any,
    });
    const roleId: Record<string, string> = {
      ADMIN: 'r-t17-admin', MANAGER: 'r-t17-manager', TEAM_LEAD: 'r-t17-lead', EMPLOYEE: 'r-t17-employee',
    };
    for (const id of Object.keys(ROLE_OF)) {
      await prisma.user.create({
        data: {
          id, roleId: roleId[ROLE_OF[id]], name: id, departmentId: DEPT_OF[id],
          email: `${id}@integration.invalid`, password: 'not-a-real-hash', currentStatus: 'OFFLINE',
        } as any,
      });
    }
    // The manager also manages D3 (not their own department).
    await prisma.managerDeptAccess.create({ data: { managerId: MGR, departmentId: D3 } as any });

    // 60 tickets. createdAt rises with n; updatedAt is a scrambled order
    // unrelated to it, with deliberate ties (equal updatedAt, then equal
    // updatedAt AND createdAt) so the tie-breakers are exercised.
    const depts = [D1, D1, D2, D3];
    const assignees = [E, E2, EX, null, TL, E];
    rows = [];
    for (let n = 0; n < 60; n++) {
      const status = STATUSES[n % STATUSES.length];
      const departmentId = depts[n % depts.length];
      const assignedToId = assignees[n % assignees.length];
      const createdAt = new Date(NOW.getTime() - (200 - n) * 3_600_000 - (n % 7 === 0 ? 0 : 0));
      // Scramble: (n * 37) mod 60 is a permutation of 0..59. Pairs share a slot
      // every 10th ticket to create equal updatedAt values.
      const slot = (n * 37) % 60;
      const tieSlot = n % 10 === 0 ? slot - (slot % 2) : slot;
      const updatedAt = new Date(NOW.getTime() - (60 - tieSlot) * 60_000);
      const dueDate = n % 3 === 0 ? new Date(NOW.getTime() - 3_600_000) : new Date(NOW.getTime() + 86_400_000);
      rows.push({
        id: `t17-${String(n).padStart(3, '0')}`,
        ticketId: `TKT-T17-${String(n).padStart(3, '0')}`,
        title: n % 4 === 0 ? `Printer alpha ${n}` : `Network beta ${n}`,
        status, departmentId, assignedToId, createdById: n % 5 === 0 ? E : MGR,
        createdAt, updatedAt, dueDate,
      });
    }
    // Two tickets with identical updatedAt and createdAt: only id decides.
    rows[58].createdAt = rows[59].createdAt;
    rows[58].updatedAt = rows[59].updatedAt;

    for (const r of rows) {
      await prisma.ticket.create({
        data: {
          id: r.id, ticketId: r.ticketId, title: r.title, category: 'IT', type: 'TASK', priority: 'MEDIUM',
          status: r.status, departmentId: r.departmentId, assignedToId: r.assignedToId, createdById: r.createdById,
          dueDate: r.dueDate, estimatedMinutes: 60,
        } as any,
      });
    }
    // Set the timestamps last, in SQL, so @updatedAt cannot overwrite them.
    for (const r of rows) {
      await prisma.$executeRawUnsafe(
        `UPDATE tickets SET "createdAt" = $1, "updatedAt" = $2 WHERE id = $3`, r.createdAt, r.updatedAt, r.id,
      );
    }
  }

  // ── The independent expectation ──────────────────────────────────────────

  const recentFirst = (a: Row, b: Row) =>
    b.updatedAt.getTime() - a.updatedAt.getTime()
    || b.createdAt.getTime() - a.createdAt.getTime()
    || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

  function inScope(viewer: string, r: Row): boolean {
    const role = ROLE_OF[viewer];
    if (role === 'ADMIN') return true;
    const own = r.assignedToId === viewer || r.createdById === viewer;
    if (role === 'MANAGER' || role === 'TEAM_LEAD') {
      const managed = role === 'MANAGER' ? [DEPT_OF[viewer], D3] : [DEPT_OF[viewer]];
      const deptOf = (u: string | null) => (u ? DEPT_OF[u] : undefined);
      return own || managed.includes(r.departmentId)
        || managed.includes(deptOf(r.assignedToId) as string)
        || managed.includes(deptOf(r.createdById) as string);
    }
    return own || (r.assignedToId === null && r.departmentId === DEPT_OF[viewer]);
  }

  function expected(viewer: string, filter: { status?: string; search?: string; departmentId?: string; assignedToId?: string; overdue?: boolean }) {
    return rows
      .filter((r) => inScope(viewer, r))
      .filter((r) => !filter.status || r.status === filter.status)
      .filter((r) => !filter.search || r.title.toLowerCase().includes(filter.search.toLowerCase()) || r.ticketId.toLowerCase().includes(filter.search.toLowerCase()))
      .filter((r) => !filter.departmentId || r.departmentId === filter.departmentId)
      .filter((r) => !filter.assignedToId || r.assignedToId === filter.assignedToId)
      .filter((r) => !filter.overdue || (OPEN_STATUSES.has(r.status) && !!r.dueDate && r.dueDate < NOW))
      .sort(recentFirst)
      .map((r) => r.ticketId);
  }

  /** Every page of the list, in order, plus the reported totals. */
  async function allPages(viewer: string, filter: Record<string, any>, limit: number) {
    const ids: string[] = [];
    const totals = new Set<number>();
    for (let page = 1; page <= 100; page++) {
      const res = await tickets.findAll({ ...filter, page, limit }, actor(viewer));
      totals.add(res.total);
      ids.push(...res.tickets.map((t: any) => t.ticketId));
      if (page >= res.totalPages) break;
    }
    return { ids, totals: [...totals] };
  }

  beforeAll(async () => {
    assertIsolatedDatabase();
    prisma = new PrismaService();
    await prisma.$connect();
    await assertServerIdentity(prisma as any);
    const tva = new TVAService({ get: () => undefined } as any);
    jest.spyOn(tva, 'now').mockImplementation(() => new Date(NOW));
    const ledger = new TicketLedgerService(prisma, tva);
    const hierarchy = new HierarchyApprovalService(prisma);
    const access = new TicketAccessService(prisma, new AccessPolicyService(prisma), hierarchy);
    const markOverdue = (t: any) => ({
      ...t,
      timing: { isOverdue: OPEN_STATUSES.has(t.status) && !!t.dueDate && new Date(t.dueDate) < NOW },
    });
    tickets = new TicketsService(
      prisma, { emitTicketStatusChanged: jest.fn(), emitTicketCreated: jest.fn() } as any,
      { sendNotification: jest.fn(async () => null) } as any, { get: () => undefined } as any,
      { emit: jest.fn(() => true) } as any, { log: jest.fn(async () => undefined) } as any, access, hierarchy,
      {
        getSlaConfig: async () => ({ review: { LOW: 48, MEDIUM: 24, HIGH: 8, URGENT: 4 } }),
        decorateTicket: async (t: any) => markOverdue(t),
        decorateTickets: async (ts: any[]) => ts.map(markOverdue),
      } as any,
      ledger, {} as any, new ActiveWorkdayPolicyService(tva), tva,
    );
    await seed();
  });

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`TRUNCATE TABLE users, roles, departments RESTART IDENTITY CASCADE`);
    await prisma?.$disconnect();
  });

  it('the fixture really is scrambled: recent order differs from newest-created order', () => {
    const byCreated = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((r) => r.ticketId);
    expect(expected(ADM, {})).not.toEqual(byCreated);
  });

  const views: Array<[string, Record<string, any>]> = [
    ['All', {}],
    ['All (explicit ALL)', { status: 'ALL' }],
    ['Open', { status: 'OPEN' }],
    ['In Progress', { status: 'IN_PROGRESS' }],
    ['Review', { status: 'REVIEW' }],
    ['Done', { status: 'DONE' }],
    ['Closed', { status: 'CLOSED' }],
    ['search + status', { search: 'printer', status: 'OPEN' }],
    ['search + In Progress', { search: 'NETWORK', status: 'IN_PROGRESS' }],
    ['department filter', { departmentId: D2 }],
    ['department + status', { departmentId: D1, status: 'REVIEW' }],
    ['assignee filter', { assignedToId: E }],
    ['overdue', { overdue: 'true' }],
  ];

  describe.each([
    ['ADMIN', ADM], ['MANAGER (own + managed department)', MGR], ['TEAM_LEAD', TL],
    ['TEAM_LEAD, other department', TLX], ['EMPLOYEE', E], ['EMPLOYEE, other department', EX],
  ])('%s', (_label, viewer) => {
    it.each(views)('%s: filtered and scoped first, then most recently updated first, across every page', async (_view, filter) => {
      const want = expected(viewer, { ...filter, status: filter.status === 'ALL' ? undefined : filter.status, overdue: filter.overdue === 'true' });
      for (const limit of [1, 4, 7, 25]) {
        const { ids, totals } = await allPages(viewer, filter, limit);
        expect(ids).toEqual(want);                      // order, and no gaps
        expect(new Set(ids).size).toBe(ids.length);     // no duplicates across page boundaries
        expect(totals).toEqual([want.length]);          // total is the filtered, scoped count
      }
    });
  });

  it('never shows a ticket outside the viewer\'s scope, whatever the filter', async () => {
    for (const viewer of [TL, TLX, E, EX, MGR]) {
      for (const [, filter] of views) {
        const { ids } = await allPages(viewer, filter, 25);
        for (const ticketId of ids) {
          const row = rows.find((r) => r.ticketId === ticketId)!;
          expect(inScope(viewer, row)).toBe(true);
        }
      }
    }
  });

  it('ties are deterministic: equal updatedAt falls to createdAt, then id', async () => {
    const want = expected(ADM, {});
    const a = want.indexOf('TKT-T17-059');
    const b = want.indexOf('TKT-T17-058');
    expect(Math.abs(a - b)).toBe(1);
    expect(a).toBeLessThan(b); // same updatedAt and createdAt: id desc puts 059 first
    const first = await allPages(ADM, {}, 7);
    const second = await allPages(ADM, {}, 7);
    expect(second.ids).toEqual(first.ids);
    expect(first.ids).toEqual(want);
  });

  it('a page past the end is empty, not a repeat of the last page', async () => {
    const want = expected(ADM, { status: 'OPEN' });
    const res = await tickets.findAll({ status: 'OPEN', page: Math.ceil(want.length / 5) + 1, limit: 5 }, actor(ADM));
    expect(res.tickets).toEqual([]);
    expect(res.total).toBe(want.length);
  });

  it('a real write moves the ticket to the top of its own status view, and only there', async () => {
    const target = rows.filter((r) => r.status === 'DONE').sort(recentFirst).at(-1)!;
    await prisma.ticket.update({ where: { id: target.id }, data: { priority: 'HIGH' } });
    const fresh = await prisma.ticket.findUnique({ where: { id: target.id } });
    target.updatedAt = fresh!.updatedAt;
    const done = await tickets.findAll({ status: 'DONE', page: 1, limit: 3 }, actor(ADM));
    expect(done.tickets[0].ticketId).toBe(target.ticketId);
    const open = await tickets.findAll({ status: 'OPEN', page: 1, limit: 50 }, actor(ADM));
    expect(open.tickets.map((t: any) => t.ticketId)).not.toContain(target.ticketId);
  });
});
