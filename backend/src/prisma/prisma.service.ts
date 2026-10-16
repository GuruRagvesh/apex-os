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

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    this.$use(excludeSystemAccounts);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
