import { isDroppedConnection, retryReadOnDroppedConnection } from '../../src/prisma/prisma.service';

// Production 2026-10-19: after Postgres restarted, requests kept landing on
// pooled connections the server had closed ("Server has closed the
// connection", P1017) and every page answered 500. A model read that fails
// that way is sent once more; nothing else is. Verified against a real local
// Postgres by terminating the client's own backend: without the middleware the
// next read throws P1017, with it the read succeeds.

const dropped = () => Object.assign(new Error('\nInvalid `prisma.user.findUnique()` invocation:\n\nServer has closed the connection.'), { code: 'P1017' });

function params(action: string, extra: Record<string, unknown> = {}) {
  return { model: 'User', action, args: {}, dataPath: [], runInTransaction: false, ...extra } as any;
}

describe('retry a read once on a dropped database connection', () => {
  it('recognizes closed, reset and TLS-dropped connections, and nothing else', () => {
    for (const e of [
      dropped(),
      new Error('Server has closed the connection.'),
      new Error('Error opening a TLS connection: Connection reset by peer (os error 104)'),
      new Error('Error opening a TLS connection: unexpected EOF'),
      new Error('Connection terminated unexpectedly'),
    ]) expect(isDroppedConnection(e)).toBe(true);
    for (const e of [
      new Error('FATAL: the database system is in recovery mode'), // 503 + Retry-After instead
      Object.assign(new Error('Timed out fetching a new connection from the connection pool'), { code: 'P2024' }),
      Object.assign(new Error('The column `users.x` does not exist'), { code: 'P2022' }),
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    ]) expect(isDroppedConnection(e)).toBe(false);
  });

  it.each(['findUnique', 'findFirst', 'findMany', 'count', 'aggregate', 'groupBy', 'findUniqueOrThrow', 'findFirstOrThrow'])(
    'sends a %s once more and returns its answer',
    async (action) => {
      const next = jest.fn().mockRejectedValueOnce(dropped()).mockResolvedValueOnce({ id: 'u1' });
      await expect(retryReadOnDroppedConnection(params(action), next)).resolves.toEqual({ id: 'u1' });
      expect(next).toHaveBeenCalledTimes(2);
    },
  );

  it('tries only once more: a second failure is returned as it is', async () => {
    const second = dropped();
    const next = jest.fn().mockRejectedValueOnce(dropped()).mockRejectedValueOnce(second);
    await expect(retryReadOnDroppedConnection(params('findMany'), next)).rejects.toBe(second);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it.each(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'])(
    'never resends a write (%s): the first attempt may have been applied',
    async (action) => {
      const next = jest.fn().mockRejectedValue(dropped());
      await expect(retryReadOnDroppedConnection(params(action), next)).rejects.toThrow(/closed the connection/);
      expect(next).toHaveBeenCalledTimes(1);
    },
  );

  it('never resends inside a transaction, a raw query, or on any other error', async () => {
    const cases: Array<[any, unknown]> = [
      [params('findMany', { runInTransaction: true }), dropped()],
      [params('queryRaw', { model: undefined }), dropped()],
      [params('executeRaw', { model: undefined }), dropped()],
      [params('findMany'), Object.assign(new Error('column missing'), { code: 'P2022' })],
      [params('findMany'), new Error('FATAL: the database system is in recovery mode')],
    ];
    for (const [p, error] of cases) {
      const next = jest.fn().mockRejectedValue(error);
      await expect(retryReadOnDroppedConnection(p, next)).rejects.toBe(error);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it('passes a healthy query straight through', async () => {
    const next = jest.fn().mockResolvedValue([1, 2]);
    await expect(retryReadOnDroppedConnection(params('findMany'), next)).resolves.toEqual([1, 2]);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
