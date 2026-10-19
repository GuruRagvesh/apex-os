import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** User list operations that must never return a system principal unless asked. */
const USER_LIST_ACTIONS = new Set(['findMany', 'count', 'groupBy', 'aggregate']);

function mentionsSystemFlag(where: unknown): boolean {
  return JSON.stringify(where ?? {}).includes('"isSystemAccount"');
}

/**
 * Keeps system principals (the non-login "Deleted account") out of every user
 * list, count, directory, selector and report. A query that names
 * `isSystemAccount` itself is left exactly as written; point lookups
 * (findUnique/findFirst) are unchanged.
 */
export const excludeSystemAccounts: Prisma.Middleware = async (params, next) => {
  if (params.model === 'User' && USER_LIST_ACTIONS.has(params.action)) {
    const args = (params.args ??= {});
    if (!mentionsSystemFlag(args.where)) {
      args.where = args.where ? { AND: [args.where, { isSystemAccount: false }] } : { isSystemAccount: false };
    }
  }
  return next(params);
};

/** Model reads: running one again cannot change data. Raw queries are excluded (they may write). */
const READ_ACTIONS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
]);

/**
 * The connection the query was sent on was closed or reset under it, which is
 * what every pooled connection looks like right after Postgres restarts. A
 * fresh connection usually works at once. Not included: "recovery mode" and
 * pool timeouts, where an immediate second attempt only adds load (those
 * answer 503 with Retry-After instead, see RequestIdExceptionFilter).
 */
const DROPPED_CONNECTION_MESSAGES = [
  'server has closed the connection',
  'connection reset by peer',
  'error opening a tls connection',
  'connection terminated unexpectedly',
  'terminating connection due to administrator command',
];

export function isDroppedConnection(error: unknown): boolean {
  const code = typeof (error as any)?.code === 'string' ? (error as any).code : '';
  if (code === 'P1017') return true; // Server has closed the connection
  const message = String((error as any)?.message ?? '').toLowerCase();
  return DROPPED_CONNECTION_MESSAGES.some((part) => message.includes(part));
}

export const DROPPED_CONNECTION_RETRY_DELAY_MS = 250;

/**
 * Production answered 500 on every page for a while after each Postgres
 * restart: requests kept landing on pooled connections the server had already
 * closed. A model READ that fails that way is sent once more, on a fresh
 * connection. Writes are never retried (the first attempt may have been
 * applied), and nothing inside a transaction is (its connection is gone).
 */
export const retryReadOnDroppedConnection: Prisma.Middleware = async (params, next) => {
  try {
    return await next(params);
  } catch (error) {
    if (params.runInTransaction || !params.model || !READ_ACTIONS.has(params.action) || !isDroppedConnection(error)) {
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, DROPPED_CONNECTION_RETRY_DELAY_MS));
    return next(params);
  }
};

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    this.$use(retryReadOnDroppedConnection);
    this.$use(excludeSystemAccounts);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
