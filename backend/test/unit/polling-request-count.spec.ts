import {
  environmentManager,
  focusManager,
  MutationObserver,
  onlineManager,
  QueryClient,
  QueryObserver,
} from '@tanstack/react-query';
import {
  MUTATION_DEFAULTS,
  POLL_BACKOFF_START_MS,
  pollWhileHealthy,
  READ_QUERY_DEFAULTS,
  refetchFailedQueries,
  createReconnectCoordinator,
  RECONNECT_COOLDOWN_MS,
} from '../../../shared/auth/frontend/query-polling';

// Counts the requests a polling screen really makes, with the app's own query
// defaults and react-query's real timers, focus and online handling. Each
// call of a query function below is one HTTP request in the browser.
//
// The exact production failure: GET /api/tickets?status=IN_PROGRESS...
// answered 500, the Tickets list polls every 30 s and pending approvals every
// 60 s. Before the repair each poll started a fresh 1 + 3-retry cycle.

const TICKETS_KEY = ['tickets', {
  status: 'IN_PROGRESS', priority: '', departmentId: '', assignedToId: '', projectId: '',
  dateFrom: '', dateTo: '', dueAfter: '', dueBefore: '', search: '',
}, 1];
const APPROVALS_KEY = ['ticket-pending-approvals'];

type Mode = 'ok' | 500 | 'down';

function endpoint(initial: Mode) {
  const ep = { mode: initial, calls: [] as number[], inFlight: 0, maxInFlight: 0 };
  const fn = async () => {
    ep.calls.push(Date.now());
    ep.inFlight++;
    ep.maxInFlight = Math.max(ep.maxInFlight, ep.inFlight);
    try {
      await new Promise((r) => setTimeout(r, 200)); // network time
      if (ep.mode === 500) throw { status: 500, message: 'Internal server error' };
      if (ep.mode === 'down') throw new Error('Network Error');
      return { data: [{ id: 't1' }], total: 1 };
    } finally {
      ep.inFlight--;
    }
  };
  return Object.assign(ep, { fn });
}

const T0 = Date.parse('2026-10-19T09:00:00Z');
let client: QueryClient;
const unsubs: Array<() => void> = [];

function watch(queryKey: unknown[], ep: ReturnType<typeof endpoint>, interval: number, legacy = false) {
  const observer = new QueryObserver(client, {
    queryKey,
    queryFn: ep.fn,
    refetchInterval: legacy ? interval : pollWhileHealthy(interval),
    refetchOnWindowFocus: true,
  });
  unsubs.push(observer.subscribe(() => undefined));
  return observer;
}

const at = (ep: { calls: number[] }, ms: number) => ep.calls.filter((t) => t - T0 <= ms).length;
const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
  jest.spyOn(Math, 'random').mockReturnValue(0); // no retry jitter: exact times
  environmentManager.setIsServer(() => false); // polling is browser-only in react-query
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
  client = new QueryClient({ defaultOptions: { queries: { ...READ_QUERY_DEFAULTS }, mutations: MUTATION_DEFAULTS } });
  client.mount(); // what QueryClientProvider does: focus and reconnect reach the queries
});

afterEach(() => {
  unsubs.splice(0).forEach((u) => u());
  client.clear();
  client.unmount();
  focusManager.setFocused(undefined);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('request count, Tickets endpoint answering 500', () => {
  it('before the repair: every 30 s poll started another four-request cycle', async () => {
    const tickets = endpoint(500);
    watch(TICKETS_KEY, tickets, 30_000, true);
    await advance(75_000);
    expect(at(tickets, 25_000)).toBe(4);
    // The 30 s timer restarts when each cycle ends (14.8 s), so a new cycle every ~44.8 s.
    expect(tickets.calls.map((t) => t - T0)).toEqual([0, 2_200, 6_400, 14_600, 44_800, 47_000, 51_200, 59_400]);
  });

  it('after: one request and three retries, then nothing more for another 60 s and beyond', async () => {
    const tickets = endpoint(500);
    watch(TICKETS_KEY, tickets, 30_000);
    await advance(75_000);
    // t=0 initial, retries 2 s / 4 s / 8 s after each 200 ms failure; exhausted at 14.8 s.
    expect(tickets.calls.map((t) => t - T0)).toEqual([0, 2_200, 6_400, 14_600]);
    expect(at(tickets, 25_000)).toBe(4);
    // 60 s after exhaustion, and the 30 s poll's slots at 30/60/90/120 s: nothing.
    await advance(134_000 - 75_000);
    expect(tickets.calls.length).toBe(4);
  });

  it('then probes on a widening schedule: one bounded cycle at 2 min, the next 4 min after that', async () => {
    const tickets = endpoint(500);
    watch(TICKETS_KEY, tickets, 30_000);
    await advance(15_000);
    const exhausted = 14_800; // last retry failed
    await advance(exhausted + POLL_BACKOFF_START_MS - 15_000 + 100);
    expect(tickets.calls.length).toBe(5);
    expect(tickets.calls[4] - T0).toBe(exhausted + POLL_BACKOFF_START_MS);
    await advance(20_000);
    expect(tickets.calls.length).toBe(8); // probe + its three retries
    await advance(3 * 60_000);
    expect(tickets.calls.length).toBe(8); // next probe is 4 min out
  });

  it('backend unreachable behaves the same', async () => {
    const tickets = endpoint('down');
    watch(TICKETS_KEY, tickets, 30_000);
    await advance(75_000);
    expect(tickets.calls.length).toBe(4);
  });

  it('a manual Retry starts exactly one new bounded cycle', async () => {
    const tickets = endpoint(500);
    const observer = watch(TICKETS_KEY, tickets, 30_000);
    await advance(20_000);
    void observer.refetch().catch(() => undefined);
    await advance(20_000);
    expect(tickets.calls.length).toBe(8);
    await advance(60_000);
    expect(tickets.calls.length).toBe(8);
  });

  it('a successful answer restores the normal 30 s polling, and the data stays visible through a failure', async () => {
    const tickets = endpoint('ok');
    const observer = watch(TICKETS_KEY, tickets, 30_000);
    await advance(1_000);
    expect(observer.getCurrentResult().data).toEqual({ data: [{ id: 't1' }], total: 1 });

    tickets.mode = 500;
    await advance(29_000 + 20_000); // the 30 s poll fails, retries exhausted
    const r = observer.getCurrentResult();
    expect(r.status).toBe('error');
    expect(r.data).toEqual({ data: [{ id: 't1' }], total: 1 }); // cached rows still shown
    const failedAt = tickets.calls.length; // 1 + 4

    tickets.mode = 'ok';
    void observer.refetch(); // Retry
    await advance(1_000);
    expect(observer.getCurrentResult().status).toBe('success');
    const after = tickets.calls.length;
    await advance(60_000);
    expect(tickets.calls.length - after).toBe(2); // back to every 30 s
    expect(failedAt).toBe(5);
  });

  it('browser reconnect resumes with one bounded cycle; offline makes no requests', async () => {
    const tickets = endpoint(500);
    watch(TICKETS_KEY, tickets, 30_000);
    await advance(20_000);
    onlineManager.setOnline(false);
    await advance(60_000);
    expect(tickets.calls.length).toBe(4);
    tickets.mode = 'ok';
    onlineManager.setOnline(true);
    await advance(1_000);
    expect(tickets.calls.length).toBe(5);
    await advance(30_000);
    expect(tickets.calls.length).toBe(6); // polling again
  });

  it('socket reconnect retries only the failed reads, once', async () => {
    const onReconnect = createReconnectCoordinator();
    const tickets = endpoint(500);
    const approvals = endpoint('ok');
    watch(TICKETS_KEY, tickets, 30_000);
    watch(APPROVALS_KEY, approvals, 60_000);
    await advance(20_000);
    tickets.mode = 'ok';
    void onReconnect(client);
    void onReconnect(client); // two sockets reconnecting in the same tick
    await advance(1_000);
    expect(tickets.calls.length).toBe(5);
    expect(approvals.calls.length).toBe(1);
  });

  it('staggered reconnects of the page\'s three sockets start one bounded cycle, not three', async () => {
    const onReconnect = createReconnectCoordinator(); // as useSocket() shares it
    const tickets = endpoint(500);
    watch(TICKETS_KEY, tickets, 30_000);
    await advance(20_000); // exhausted: 4 requests
    // Tickets list, ticket detail and topbar sockets reconnect 0 s, 1.5 s and 9 s
    // apart: during the first refetch's retries, and after a fetch has settled.
    expect(onReconnect(client)).not.toBeNull();
    await advance(1_500);
    expect(onReconnect(client)).toBeNull();
    await advance(7_500);
    expect(onReconnect(client)).toBeNull();
    await advance(15_000);
    expect(onReconnect(client)).toBeNull(); // 24 s: cycle finished, still in cooldown
    expect(tickets.calls.length).toBe(8); // one cycle: 1 request + 3 retries
    expect(tickets.maxInFlight).toBe(1);

    // A real later reconnect (after the 30 s cooldown) is honoured.
    await advance(RECONNECT_COOLDOWN_MS);
    expect(onReconnect(client)).not.toBeNull();
    await advance(20_000);
    expect(tickets.calls.length).toBe(12);
  });

  it('every useSocket() reports reconnects to the one page-wide coordinator', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../../frontend/hooks/useSocket.ts'), 'utf8');
    expect(src).toMatch(/socket\.io\.on\('reconnect', \(\) => \{ void onSocketReconnect\(queryClient\); \}\)/);
    expect(src).not.toMatch(/refetchFailedQueries|refetchQueries|invalidateQueries/);
  });

  it('without the shared coordinator, the same staggered reconnects would start three cycles', async () => {
    const tickets = endpoint(500);
    watch(TICKETS_KEY, tickets, 30_000);
    await advance(20_000);
    for (const gap of [0, 16_000, 16_000]) { // each after the previous cycle settled
      await advance(gap);
      void refetchFailedQueries(client);
    }
    await advance(20_000);
    expect(tickets.calls.length).toBe(16);
  });

  it('window focus never runs two requests for the same key at once', async () => {
    const tickets = endpoint(500);
    watch(TICKETS_KEY, tickets, 30_000);
    watch(TICKETS_KEY, tickets, 30_000); // the same query mounted twice
    await advance(1_000); // mid-retry
    for (let i = 0; i < 5; i++) {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    }
    await advance(74_000);
    expect(tickets.maxInFlight).toBe(1);
    expect(tickets.calls.length).toBe(4);

    // A focus after exhaustion (data stale) is one new bounded cycle.
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await advance(20_000);
    expect(tickets.calls.length).toBe(8);
    expect(tickets.maxInFlight).toBe(1);
  });

  it('separate queries are counted separately: approvals polling continues while Tickets fails', async () => {
    const tickets = endpoint(500);
    const approvals = endpoint('ok');
    const other = endpoint(500);
    watch(TICKETS_KEY, tickets, 30_000);
    watch(APPROVALS_KEY, approvals, 60_000);
    watch(['tickets', { status: 'OPEN' }, 1], other, 30_000);
    await advance(75_000);
    expect(tickets.calls.length).toBe(4);
    expect(other.calls.length).toBe(4);
    expect(approvals.calls.map((t) => t - T0)).toEqual([0, 60_200]);
  });

  it('a 400 (invalid filter) is not retried and not polled', async () => {
    const bad = { calls: [] as number[] };
    unsubs.push(new QueryObserver(client, {
      queryKey: ['tickets', { status: 'BOGUS' }, 1],
      queryFn: async () => { bad.calls.push(Date.now()); throw { status: 400 }; },
      refetchInterval: pollWhileHealthy(30_000),
    }).subscribe(() => undefined));
    await advance(75_000);
    expect(bad.calls.length).toBe(1);
  });
});

describe('mutations', () => {
  it('a failed save is sent once and never retried, whatever the error', async () => {
    for (const error of [{ status: 500 }, new Error('Network Error'), { status: 503 }]) {
      let sent = 0;
      const m = new MutationObserver(client, { mutationFn: async (_vars: { title: string }) => { sent++; throw error; } });
      await expect(m.mutate({ title: 'x' })).rejects.toBe(error);
      await advance(60_000);
      expect(sent).toBe(1);
    }
  });
});
