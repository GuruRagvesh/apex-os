import { BadRequestException, HttpStatus, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { QueryClient } from '@tanstack/react-query';
import { Priority, TicketCategory, TicketStatus } from '@prisma/client';
import {
  POLL_BACKOFF_MAX_MS,
  POLL_BACKOFF_START_MS,
  pollWhileHealthy,
  type PollableQuery,
} from '../../../shared/auth/frontend/query-polling';
import {
  createdFilterBound,
  parseFilterDate,
  TicketAccessService,
  ticketDueBound,
  ticketEnumFilter,
} from '../../src/common/services/ticket-access.service';
import {
  describeError,
  logUrl,
  REQUEST_ID_HEADER,
  RequestIdExceptionFilter,
  requestIdMiddleware,
  resolveRequestId,
  safeStack,
  statusOf,
} from '../../src/common/observability/request-id';

// Production answered 500 on GET /api/tickets?status=IN_PROGRESS..., and every
// open tab kept polling it (plus three retries per poll), which also slowed
// the healthy endpoints. These pin the three guards added for it: polling that
// backs off, filters that answer 400 instead of reaching Prisma, and a
// request id on every logged 500.

function query(status: PollableQuery['state']['status'], error: unknown = null, errorUpdatedAt = 0): PollableQuery {
  return { state: { status, error, errorUpdatedAt } };
}

describe('pollWhileHealthy', () => {
  it('polls at the normal interval while the last fetch succeeded or is still pending', () => {
    const interval = pollWhileHealthy(30_000);
    expect(interval(query('success'))).toBe(30_000);
    expect(interval(query('pending'))).toBe(30_000);
  });

  it('backs off after each failed poll that answered 5xx or nothing: 2, 4, 8, then 15 min at most', () => {
    const interval = pollWhileHealthy(30_000);
    const q = query('error', { status: 500 }, 1);
    expect(interval(q)).toBe(POLL_BACKOFF_START_MS);
    // The same failure seen again (another observer update) does not count twice.
    expect(interval(q)).toBe(POLL_BACKOFF_START_MS);

    const seen: number[] = [];
    for (let at = 2; at <= 6; at++) {
      q.state.errorUpdatedAt = at;
      seen.push(interval(q) as number);
    }
    expect(seen).toEqual([4 * 60_000, 8 * 60_000, POLL_BACKOFF_MAX_MS, POLL_BACKOFF_MAX_MS, POLL_BACKOFF_MAX_MS]);
    expect(interval(query('error', new Error('Network Error'), 1))).toBe(POLL_BACKOFF_START_MS);
  });

  it('returns to the normal interval as soon as a fetch succeeds, and starts the backoff over next time', () => {
    const interval = pollWhileHealthy(60_000);
    const q = query('error', { status: 503 }, 1);
    interval(q);
    q.state.errorUpdatedAt = 2;
    expect(interval(q)).toBe(4 * 60_000);

    q.state.status = 'success';
    expect(interval(q)).toBe(60_000);

    q.state.status = 'error';
    q.state.errorUpdatedAt = 3;
    expect(interval(q)).toBe(POLL_BACKOFF_START_MS);
  });

  it('stops polling on an answer that will not change by asking again (400, 403, 404)', () => {
    const interval = pollWhileHealthy(15_000);
    for (const status of [400, 403, 404]) expect(interval(query('error', { status }, 1))).toBe(false);
  });

  it('never polls faster than the screen asked for', () => {
    expect(pollWhileHealthy(20 * 60_000)(query('error', { status: 500 }, 1))).toBe(20 * 60_000);
  });

  it('keeps a screen\'s own conditional interval, and its "off"', () => {
    const busy = { status: 'RUNNING' };
    const interval = pollWhileHealthy((q) => ((q.state.data as any)?.status === 'RUNNING' ? 2000 : false));
    expect(interval({ state: { status: 'success', error: null, errorUpdatedAt: 0, data: busy } })).toBe(2000);
    expect(interval({ state: { status: 'success', error: null, errorUpdatedAt: 0, data: { status: 'DONE' } } })).toBe(false);
    expect(interval({ state: { status: 'error', error: { status: 500 }, errorUpdatedAt: 1, data: busy } })).toBe(POLL_BACKOFF_START_MS);
    expect(pollWhileHealthy(false)(query('success'))).toBe(false);
  });

  it('reads the state react-query actually keeps on a failed query', async () => {
    const client = new QueryClient();
    await client.prefetchQuery({ queryKey: ['tickets'], queryFn: async () => { throw { status: 500 }; }, retry: false });
    const failed = client.getQueryCache().find({ queryKey: ['tickets'] })!;
    expect(pollWhileHealthy(30_000)(failed as unknown as PollableQuery)).toBe(POLL_BACKOFF_START_MS);
    client.clear();
  });
});

describe('ticket list filters', () => {
  it('accepts every real status, category and priority, in any case, and treats empty or ALL as no filter', () => {
    for (const s of Object.values(TicketStatus)) expect(ticketEnumFilter('status', s, TicketStatus)).toBe(s);
    expect(ticketEnumFilter('status', 'in_progress', TicketStatus)).toBe('IN_PROGRESS');
    expect(ticketEnumFilter('category', ' it ', TicketCategory)).toBe('IT');
    expect(ticketEnumFilter('priority', 'HIGH', Priority)).toBe('HIGH');
    for (const none of [undefined, null, '', 'ALL', 'all']) expect(ticketEnumFilter('status', none, TicketStatus)).toBeUndefined();
  });

  it('answers 400 for an unknown value or a repeated parameter', () => {
    expect(() => ticketEnumFilter('status', 'BOGUS', TicketStatus)).toThrow(BadRequestException);
    expect(() => ticketEnumFilter('status', ['OPEN', 'DONE'], TicketStatus)).toThrow(BadRequestException);
    expect(() => ticketEnumFilter('priority', 'CRITICAL', Priority)).toThrow(/Use one of: LOW, MEDIUM, HIGH, URGENT/);
  });

  it('answers 400 for a due date that is not a date', () => {
    expect(ticketDueBound('dueBefore', '2026-10-19')?.toISOString()).toBe('2026-10-19T00:00:00.000Z');
    // What the Tickets page sends for "Due today".
    expect(ticketDueBound('dueBefore', '2026-10-19T18:29:59.999Z')?.toISOString()).toBe('2026-10-19T18:29:59.999Z');
    expect(ticketDueBound('dueAfter', '2026-10-19T00:00+05:30')?.toISOString()).toBe('2026-10-18T18:30:00.000Z');
    expect(ticketDueBound('dueBefore', '')).toBeUndefined();
    expect(() => ticketDueBound('dueBefore', 'tomorrow')).toThrow(BadRequestException);
    expect(() => ticketDueBound('dueAfter', ['2026-10-19'])).toThrow(BadRequestException);
  });

  it('answers 400 for an impossible calendar date instead of rolling it over', () => {
    expect(new Date('2026-02-31').toISOString()).toBe('2026-03-03T00:00:00.000Z'); // the trap
    for (const bad of [
      '2026-02-31', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-10-00',
      '2026-10-19T24:00', '2026-10-19T10:60', '2026-10-19T10:00:61Z', '2026-10-19T10:00+15:00',
      '10/19/2026', 'Oct 19 2026', '2026-10-19 10:00', '20261019', ' ',
    ]) {
      expect(() => ticketDueBound('dueBefore', bad)).toThrow(BadRequestException);
    }
    expect(parseFilterDate('2028-02-29')?.toISOString()).toBe('2028-02-29T00:00:00.000Z'); // leap year
  });

  it('ignores (as before) an impossible Created from / to date rather than rolling it over', () => {
    expect(createdFilterBound('2026-02-31', 'start')).toBeUndefined();
    expect(createdFilterBound('2026-02-30T10:00:00Z', 'end')).toBeUndefined();
    expect(createdFilterBound('2026-10-05', 'start')!.toISOString()).toBe('2026-10-04T18:30:00.000Z');
  });

  it('rejects a bad filter before any database query', async () => {
    const prisma = new Proxy({}, { get: () => { throw new Error('database touched'); } });
    const service = new TicketAccessService(prisma as any, {} as any, {} as any);
    const build = (filters: any) => (service as any).buildFilterWhere(filters);

    await expect(build({ status: 'IN_PROGRESS', priority: 'high', dueBefore: '2026-10-31' })).resolves.toEqual({
      status: 'IN_PROGRESS', priority: 'HIGH', dueDate: { lte: new Date('2026-10-31') },
    });
    await expect(build({ status: 'IN-PROGRESS' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(build({ category: 'SALES' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(build({ dueAfter: 'Invalid Date' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('request id', () => {
  it('reuses a plain incoming id and replaces anything else with a fresh one', () => {
    expect(resolveRequestId('render-abc123')).toBe('render-abc123');
    expect(resolveRequestId(['render-abc123', 'x'])).toBe('render-abc123');
    for (const bad of [undefined, '', 'short', 'has space in it', 'x'.repeat(65), 'line\nbreak-injected']) {
      expect(resolveRequestId(bad)).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('puts the id on the request and the response header', () => {
    const req: any = { headers: {} };
    const headers: Record<string, string> = {};
    const next = jest.fn();
    requestIdMiddleware(req, { setHeader: (k: string, v: string) => { headers[k] = v; } }, next);
    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers[REQUEST_ID_HEADER]).toBe(req.requestId);
    expect(next).toHaveBeenCalled();
  });

  it('logs the path and query-parameter names, never a query value', () => {
    expect(logUrl('/api/tickets?status=IN_PROGRESS&priority=&search=alice%40example.com&page=1'))
      .toBe('/api/tickets?{status,priority,search,page}');
    expect(logUrl('/api/files?token=abc&id=7')).toBe('/api/files?{token,id}');
    expect(logUrl('/api/health')).toBe('/api/health');
    expect(logUrl('/api/users?search=Priya%20Sharma&department=HR')).not.toMatch(/Priya|Sharma|HR/);
  });

  it('cannot be made to break or forge a log line', () => {
    // Encoded newlines stay encoded; raw control characters never survive.
    const forged = logUrl('/api/tickets%0A[req fake] GET /admin?search=x%0Ay&a%0Ab=1');
    expect(forged).not.toMatch(/[\r\n]/);
    expect(forged).toBe('/api/tickets%0A[reqfake]GET/admin?{search,a0Ab}');
    expect(logUrl('/api/x\r\ny?k\n=1')).not.toMatch(/[\r\n]/);
    expect(logUrl(`/api/${'a'.repeat(500)}`).length).toBeLessThanOrEqual(203);
    expect(logUrl(`/api/x?${Array.from({ length: 50 }, (_, i) => `k${i}=1`).join('&')}`).split(',')).toHaveLength(20);
  });

  it('describes a Prisma error by class, code, schema-only meta and its last line, without the values it quotes', () => {
    // The real shape of a Prisma validation message (it repeats the call and its arguments).
    const validation = Object.assign(new Error([
      'Invalid `prisma.ticket.findMany()` invocation in',
      'C:\\app\\dist\\tickets.service.js:42:9',
      '  where: {',
      '    status: "BOGUS",',
      '    title: { contains: "alice@example.com" }',
      '  }',
      'Invalid value for argument `status`. Expected TicketStatus.',
    ].join('\n')), { name: 'PrismaClientValidationError' });
    const line = describeError(validation);
    expect(line).toBe('Error: Invalid value for argument `status`. Expected TicketStatus.');
    expect(line).not.toMatch(/alice|BOGUS|example/);

    const drift = Object.assign(new Error('Invalid `prisma.ticket.findMany()` invocation:\n\nThe column `tickets.outputTargetMinutes` does not exist in the current database.'), {
      code: 'P2022', meta: { column: 'tickets.outputTargetMinutes', modelName: 'Ticket', message: 'row data "secret@x.com"' },
    });
    expect(describeError(drift)).toBe(
      'Error P2022: The column `tickets.outputTargetMinutes` does not exist in the current database. [column=tickets.outputTargetMinutes modelName=Ticket]',
    );

    const leaky = new Error("Unique constraint failed for 'ravi.kumar@corp.in' with id 9876543210 and \"Priya\"");
    expect(describeError(leaky)).toBe("Error: Unique constraint failed for '[value]' with id [number] and \"[value]\"");
    expect(describeError(new Error(`x${'y'.repeat(1000)}\n`)).length).toBeLessThanOrEqual(303);
    expect(describeError('plain alice@example.com')).toBe('plain [email]');
  });

  it('logs stack frames only, at most ten, never the message line', () => {
    const e = new Error('secret alice@example.com');
    e.stack = ['Error: secret alice@example.com', ...Array.from({ length: 15 }, (_, i) => `    at f${i} (C:\\app\\x.js:${i}:1)`)].join('\n');
    const stack = safeStack(e)!;
    expect(stack).not.toMatch(/alice|secret/);
    expect(stack.split('\n')).toHaveLength(10);
    expect(stack.split('\n')[0]).toBe('at f0 (C:\\app\\x.js:0:1)');
  });

  it('knows the status Nest answers for each kind of error', () => {
    expect(statusOf(new BadRequestException())).toBe(400);
    expect(statusOf(Object.assign(new Error('request entity too large'), { statusCode: 413 }))).toBe(413);
    expect(statusOf(new Error('boom'))).toBe(500);
  });

  describe('exception filter', () => {
    let logged: jest.SpyInstance;
    beforeEach(() => { logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined); });
    afterEach(() => logged.mockRestore());

    function run(exception: unknown) {
      const adapter = { reply: jest.fn(), isHeadersSent: () => false, end: jest.fn() };
      const headers: Record<string, string> = {};
      const res: any = {
        headersSent: false,
        getHeader: (k: string) => headers[k],
        setHeader: (k: string, v: string) => { headers[k] = v; },
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const req = { requestId: 'req-12345678', method: 'GET', originalUrl: '/api/tickets?status=IN_PROGRESS&search=alice', user: { id: 'u1' } };
      const host: any = {
        getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
        getArgByIndex: (i: number) => [req, res][i],
      };
      new RequestIdExceptionFilter(adapter as any).catch(exception, host);
      return { adapter, res };
    }

    it('logs an unexpected error once with the request id, and returns the id to the browser', () => {
      const prismaError = Object.assign(
        new Error('Invalid `prisma.ticket.findMany()` invocation:\n\nThe column `users.foo` does not exist in the current database.'),
        { code: 'P2022', meta: { column: 'users.foo' } },
      );
      const { res, adapter } = run(prismaError);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(res.json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error', requestId: 'req-12345678' });
      expect(adapter.reply).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalledTimes(1);
      const line = logged.mock.calls[0][0] as string;
      expect(line).toBe(
        '[req req-12345678] GET /api/tickets?{status,search} -> 500 user=u1 '
          + 'Error P2022: The column `users.foo` does not exist in the current database. [column=users.foo]',
      );
      expect(line).not.toMatch(/alice|IN_PROGRESS/);
      expect(logged.mock.calls[0][1]).not.toMatch(/The column/); // stack frames only
    });

    it('answers a body-parser error (bad JSON, too large) with its own status, without logging the body it quotes', () => {
      const tooLarge = Object.assign(new Error('Unexpected token in JSON at position 3: {"password":"x"}'), { statusCode: 400 });
      const { res } = run(tooLarge);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(logged).not.toHaveBeenCalled();
    });

    it('answers client errors exactly as before, without logging them', () => {
      const { adapter, res } = run(new BadRequestException('Invalid status filter'));
      expect(adapter.reply).toHaveBeenCalledWith(res, expect.objectContaining({ statusCode: 400, message: 'Invalid status filter' }), 400);
      run(new NotFoundException());
      expect(logged).not.toHaveBeenCalled();
    });

    it('logs a deliberate 5xx but leaves its body alone', () => {
      const { adapter } = run(new ServiceUnavailableException('Storage not configured'));
      expect(adapter.reply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ statusCode: 503 }), 503);
      expect(logged).toHaveBeenCalledTimes(1);
    });
  });
});
