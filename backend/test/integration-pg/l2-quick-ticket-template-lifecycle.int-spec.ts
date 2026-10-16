/**
 * Quick ticket templates through the real Permanent Delete (spec §8.2).
 *
 * The deleted owner's templates and preference row go; every other owner's
 * templates lose only the deleted person from assigneeIds, in order, and
 * templates that never named them are untouched (updatedAt included).
 *
 * Substituted, as in l1: Google Drive (in-memory fake) and the provider file
 * store (in-memory map).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { randomBytes, randomUUID } from 'crypto';
import { CommonModule } from '../../src/common/common.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { UserLifecycleModule } from '../../src/modules/core/users/lifecycle/user-lifecycle.module';
import { UsersModule } from '../../src/modules/core/users/users.module';
import { LifecyclePorts, USER_LIFECYCLE_PORTS, UserLifecycleService } from '../../src/modules/core/users/lifecycle/user-lifecycle.service';
import { FileObject, FileProvider, FileStore } from '../../src/modules/core/users/lifecycle/archive-files';
import { assertServerIdentity } from './db-guard';
import { seedCompany, Seed } from './harness';
import { FakeDriveVault } from '../helpers/fake-drive-vault';

const ARCHIVE_ACCOUNT = 'archive-owner@example.test';
const NOW = new Date('2026-10-16T06:00:00.000Z');

class MemFileStore implements FileStore {
  async read(file: FileObject) {
    if (file.bytes) return { bytes: file.bytes, mimeType: file.mimeType };
    throw new Error('missing');
  }
  async remove(_p: FileProvider, _ref: string) {
    return 'NOT_FOUND' as const;
  }
}

describe('quick ticket templates on Permanent Delete (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: UserLifecycleService;
  let seed: Seed;
  let admin: any;

  beforeEach(async () => {
    const drive = new FakeDriveVault({ account: ARCHIVE_ACCOUNT, environment: 'staging' });
    await drive.ensureFolder('staging', []);
    const env: NodeJS.ProcessEnv = {
      APP_ENV: 'staging',
      GOOGLE_DRIVE_CLIENT_ID: 'cid',
      GOOGLE_DRIVE_CLIENT_SECRET: 'csecret',
      GOOGLE_DRIVE_REFRESH_TOKEN: 'rtoken',
      GOOGLE_DRIVE_ARCHIVE_ROOT_FOLDER_ID: 'root-folder-0001',
      GOOGLE_DRIVE_ARCHIVE_ACCOUNT: ARCHIVE_ACCOUNT,
      GOOGLE_DRIVE_ARCHIVE_ENVIRONMENT: 'staging',
      LIFECYCLE_HANDLE_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      LIFECYCLE_HANDLE_HMAC_KEY: randomBytes(32).toString('base64'),
    };
    const ports: LifecyclePorts = { env: () => env, now: () => NOW, makeArchiveVault: () => drive, makeFileStore: () => new MemFileStore(), transactionTimeoutMs: 120_000 };
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), EventEmitterModule.forRoot(), CommonModule, UserLifecycleModule, UsersModule],
    })
      .overrideProvider(USER_LIFECYCLE_PORTS)
      .useValue(ports)
      .compile();
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
    await assertServerIdentity(prisma as any);
    const tables: { tablename: string }[] = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`);
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    seed = await seedCompany(prisma);
    admin = await prisma.user.findUniqueOrThrow({ where: { id: seed.actors.admin.id }, include: { role: true } });
    svc = moduleRef.get(UserLifecycleService);
  });

  afterEach(async () => {
    await prisma?.$disconnect();
    await moduleRef?.close();
  });

  it('removes only the deleted person from other owners\' templates and deletes their own templates and preference', async () => {
    const del = seed.employees.F.id;
    const owner = seed.employees.B.id;
    const a = seed.employees.C.id;
    const b = seed.employees.D.id;
    const old = new Date('2026-01-01T00:00:00.000Z');
    const tpl = (id: string, ownerUserId: string, seq: number, assigneeIds: string[]) => ({
      id, ownerUserId, code: `QT-${seq}`, codeSequence: seq, name: `Template ${id}`, title: `Title ${id}`, description: `Description ${id}`, assigneeIds, priority: 'HIGH' as any, estimatedMinutes: 30, updatedAt: old,
    });
    await prisma.quickTicketTemplate.createMany({ data: [
      tpl('qt-empty', owner, 1, []),
      tpl('qt-only', owner, 2, [del]),
      tpl('qt-mid', owner, 3, [a, del, b]),
      tpl('qt-twice', owner, 4, [del, del]),
      tpl('qt-none', owner, 5, [a, b]),
      tpl('qt-own', del, 1, [a]),
    ] });
    await prisma.quickTicketTemplatePreference.createMany({ data: [
      { ownerUserId: del, visibleCount: 7, updatedAt: old },
      { ownerUserId: owner, visibleCount: 5, updatedAt: old },
    ] });
    const before = await prisma.quickTicketTemplate.findMany({ where: { ownerUserId: owner }, orderBy: { id: 'asc' } });

    // Templates are not history: the owner archives as NO_HISTORY_VERIFIED.
    await svc.archive(del, admin, { idempotencyKey: randomUUID() });
    expect((await prisma.userArchiveSnapshot.findFirstOrThrow({ where: { userId: del } })).status).toBe('NO_HISTORY_VERIFIED');
    const op = await svc.permanentDelete(del, admin, { idempotencyKey: randomUUID(), confirmation: `${del}@integration.invalid` });
    expect(op.state).toBe('PERMANENTLY_DELETED');

    const after = await prisma.quickTicketTemplate.findMany({ where: { ownerUserId: owner }, orderBy: { id: 'asc' } });
    const byId = Object.fromEntries(after.map((t) => [t.id, t]));
    expect(byId['qt-empty'].assigneeIds).toEqual([]);
    expect(byId['qt-only'].assigneeIds).toEqual([]);
    expect(byId['qt-mid'].assigneeIds).toEqual([a, b]);
    expect(byId['qt-twice'].assigneeIds).toEqual([]);
    expect(byId['qt-none'].assigneeIds).toEqual([a, b]);
    // Untouched rows keep every field, updatedAt included.
    for (const id of ['qt-empty', 'qt-none']) expect(byId[id]).toEqual(before.find((t) => t.id === id));
    // Every other owner's template keeps name, code and all other fields byte-for-byte.
    for (const t of before) {
      const { assigneeIds: _x, ...rest } = t;
      const { assigneeIds: _y, ...restAfter } = byId[t.id];
      expect(restAfter).toEqual(rest);
    }
    // The deleted owner's own templates and preference row are gone; the other owner's preference stays.
    expect(await prisma.quickTicketTemplate.count({ where: { ownerUserId: del } })).toBe(0);
    expect(await prisma.quickTicketTemplatePreference.findUnique({ where: { ownerUserId: del } })).toBeNull();
    expect(await prisma.quickTicketTemplatePreference.findUnique({ where: { ownerUserId: owner } })).not.toBeNull();
    // The receipt records the array cleanup count and no identifier.
    const receipt = await prisma.userDeletionReceipt.findFirstOrThrow({ where: { operationId: op.operationId } });
    expect((receipt.counts as any).TEMPLATE_ASSIGNEES_REMOVED).toBe(3);
    expect((receipt.counts as any)['QuickTicketTemplate.ownerUserId']).toBe(1);
    expect(JSON.stringify(receipt)).not.toContain(del);
  });
});
