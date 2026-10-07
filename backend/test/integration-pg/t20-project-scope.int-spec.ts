/**
 * Phase 6E: Projects permissions and list behaviour against real PostgreSQL.
 *
 * Before the fix:
 *  - search was silently ignored for Team Leads and Managers (the scope OR
 *    overwrote the search OR), so a TL searching got every project in scope;
 *  - PUT wrote the raw request body: a Team Lead could archive a project
 *    (archive is Manager+), move it to a department outside their scope, or
 *    rewrite its projectId; POST let a Manager create in any department;
 *  - an admin could add an inactive user as a member, and any role string
 *    was accepted on add; removing a non-member was a 500.
 *
 * Real: Prisma, PostgreSQL, ProjectsService, AccessPolicyService.
 */
import { PrismaService } from '../../src/prisma/prisma.service';
import { AccessPolicyService } from '../../src/common/services/access-policy.service';
import { EventLoggerService } from '../../src/common/services/event-logger.service';
import { ProjectsService } from '../../src/modules/operations/projects/projects.service';
import { ProjectsController } from '../../src/modules/operations/projects/projects.controller';
import { ROLES_KEY } from '../../src/shared/decorators/roles.decorator';
import { assertIsolatedDatabase, assertServerIdentity } from './db-guard';

const D1 = 'd-t20-ops';
const D2 = 'd-t20-other';
const D3 = 'd-t20-managed';
const SA = 'u-t20-super';
const ADM = 'u-t20-admin';
const MGR = 'u-t20-manager';
const TL = 'u-t20-lead';
const E = 'u-t20-employee';
const E2 = 'u-t20-employee2';
const I = 'u-t20-intern';
const OUT = 'u-t20-outsider';
const GONE = 'u-t20-inactive';

const ROLE_OF: Record<string, string> = {
  [SA]: 'SUPER_ADMIN', [ADM]: 'ADMIN', [MGR]: 'MANAGER', [TL]: 'TEAM_LEAD', [E]: 'EMPLOYEE', [E2]: 'EMPLOYEE', [I]: 'INTERN', [OUT]: 'EMPLOYEE', [GONE]: 'EMPLOYEE',
};
const DEPT_OF: Record<string, string> = { [SA]: D1, [ADM]: D1, [MGR]: D1, [TL]: D1, [E]: D1, [E2]: D1, [I]: D1, [OUT]: D2, [GONE]: D1 };
const actor = (id: string) => ({ id, role: { name: ROLE_OF[id] }, departmentId: DEPT_OF[id], isHR: false });

async function status(p: Promise<unknown>): Promise<number> {
  try { await p; return 200; } catch (e: any) { return typeof e?.getStatus === 'function' ? e.getStatus() : 500; }
}

describe('T20 projects: scope, search and safe edits (PostgreSQL)', () => {
  let prisma: PrismaService;
  let projects: ProjectsService;
  const P: Record<string, string> = {};

  beforeAll(async () => {
    assertIsolatedDatabase();
    prisma = new PrismaService();
    await prisma.$connect();
    await assertServerIdentity(prisma as any);
    projects = new ProjectsService(prisma, new AccessPolicyService(prisma), new EventLoggerService(prisma));

    await prisma.$executeRawUnsafe(`TRUNCATE TABLE projects, users, roles, departments RESTART IDENTITY CASCADE`);
    await prisma.department.createMany({ data: [{ id: D1, name: 'T20 Ops' }, { id: D2, name: 'T20 Other' }, { id: D3, name: 'T20 Managed' }] as any });
    const roleIds: Record<string, string> = {};
    for (const [name, level] of [['SUPER_ADMIN', 0], ['ADMIN', 1], ['MANAGER', 2], ['TEAM_LEAD', 3], ['EMPLOYEE', 4], ['INTERN', 5]] as const) {
      roleIds[name] = (await prisma.role.create({ data: { id: `r-t20-${name.toLowerCase()}`, name, level } as any })).id;
    }
    for (const id of Object.keys(ROLE_OF)) {
      await prisma.user.create({
        data: { id, roleId: roleIds[ROLE_OF[id]], name: id, departmentId: DEPT_OF[id], email: `${id}@integration.invalid`, password: 'x', isActive: id !== GONE, currentStatus: 'OFFLINE' } as any,
      });
    }
    await prisma.managerDeptAccess.create({ data: { managerId: MGR, departmentId: D3, accessLevel: 'FULL' } as any });

    const make = async (key: string, name: string, departmentId: string | null, members: string[]) => {
      const p = await prisma.project.create({ data: { projectId: `PRJ-T20-${key}`, name, departmentId, members: { create: members.map((userId) => ({ userId, role: 'MEMBER' })) } } as any });
      P[key] = p.id;
    };
    await make('alpha', 'Alpha Website', D1, [E]);
    await make('beta', 'Beta Mobile App', D1, []);
    await make('gamma', 'Gamma Website', D2, [OUT]);
    await make('delta', 'Delta Website', D3, []);
    await make('eps', 'Epsilon Research', D2, [TL]);
  });

  afterAll(async () => {
    await prisma?.$executeRawUnsafe(`TRUNCATE TABLE projects, users, roles, departments RESTART IDENTITY CASCADE`);
    await prisma?.$disconnect();
  });

  const names = (r: any) => r.projects.map((p: any) => p.name).sort();

  describe('list scope and search', () => {
    it.each([
      ['ADMIN sees every project', ADM, undefined, ['Alpha Website', 'Beta Mobile App', 'Delta Website', 'Epsilon Research', 'Gamma Website']],
      ['MANAGER sees own and managed departments plus memberships', MGR, undefined, ['Alpha Website', 'Beta Mobile App', 'Delta Website']],
      ['TEAM_LEAD sees own department plus memberships', TL, undefined, ['Alpha Website', 'Beta Mobile App', 'Epsilon Research']],
      ['EMPLOYEE sees only projects they belong to', E, undefined, ['Alpha Website']],
      ['INTERN with no membership sees nothing', I, undefined, []],
      ['ADMIN search', ADM, 'website', ['Alpha Website', 'Delta Website', 'Gamma Website']],
      ['MANAGER search stays inside scope', MGR, 'website', ['Alpha Website', 'Delta Website']],
      ['TEAM_LEAD search stays inside scope (was ignored)', TL, 'website', ['Alpha Website']],
      ['TEAM_LEAD search by project id', TL, 'PRJ-T20-EPS', ['Epsilon Research']],
      ['EMPLOYEE search cannot reach other projects', E, 'website', ['Alpha Website']],
    ])('%s', async (_l, who, search, want) => {
      expect(names(await projects.findAll({ search } as any, actor(who)))).toEqual(want);
    });

    it('status and department filters combine with scope, and totals count the filtered set', async () => {
      await prisma.project.update({ where: { id: P.beta }, data: { status: 'ON_HOLD' } });
      const onHold = await projects.findAll({ status: 'ON_HOLD' } as any, actor(TL));
      expect(names(onHold)).toEqual(['Beta Mobile App']);
      expect(onHold.total).toBe(1);
      const d2 = await projects.findAll({ departmentId: D2 } as any, actor(TL));
      expect(names(d2)).toEqual(['Epsilon Research']); // only the D2 project TL belongs to
      const page = await projects.findAll({ limit: 2, page: 2 } as any, actor(ADM));
      expect(page.total).toBe(5);
      expect(page.projects).toHaveLength(2);
      expect(page.totalPages).toBe(3);
      await prisma.project.update({ where: { id: P.beta }, data: { status: 'ACTIVE' } });
    });

    it('direct URL access follows the same scope', async () => {
      expect(await status(projects.findOne(P.gamma, actor(TL)))).toBe(403);
      expect(await status(projects.findOne(P.beta, actor(E)))).toBe(403);
      expect(await status(projects.findOne(P.alpha, actor(E)))).toBe(200);
      expect(await status(projects.findOne(P.delta, actor(MGR)))).toBe(200);
      expect(await status(projects.findOne('nope', actor(ADM)))).toBe(404);
    });
  });

  describe('create', () => {
    it('a Team Lead may create projects, as the brief requires', () => {
      const roles = Reflect.getMetadata(ROLES_KEY, ProjectsController.prototype.create);
      expect(roles).toEqual(expect.arrayContaining(['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN']));
      expect(roles).not.toContain('EMPLOYEE');
      expect(roles).not.toContain('INTERN');
    });

    it('a Manager creates only in a department they manage; a Team Lead only in their own', async () => {
      expect(await status(projects.create({ name: 'M ok', departmentId: D3 }, actor(MGR)))).toBe(200);
      expect(await status(projects.create({ name: 'M bad', departmentId: D2 }, actor(MGR)))).toBe(403);
      expect(await status(projects.create({ name: 'TL ok', departmentId: D1 }, actor(TL)))).toBe(200);
      expect(await status(projects.create({ name: 'TL bad', departmentId: D3 }, actor(TL)))).toBe(403);
      expect(await status(projects.create({ name: 'Admin any', departmentId: D2 }, actor(ADM)))).toBe(200);
    });

    it('only the editable fields are written; the creator becomes OWNER', async () => {
      const p: any = await projects.create({ name: 'Mass assign', departmentId: D1, status: 'ARCHIVED', projectId: 'PRJ-HACK', createdAt: '2000-01-01T00:00:00Z', id: 'forced-id' } as any, actor(TL));
      expect(p.status).toBe('ACTIVE');
      expect(p.projectId).not.toBe('PRJ-HACK');
      expect(p.id).not.toBe('forced-id');
      expect(new Date(p.createdAt).getFullYear()).toBeGreaterThan(2000);
      const owner = await prisma.projectMember.findFirst({ where: { projectId: p.id, userId: TL } });
      expect(owner?.role).toBe('OWNER');
    });

    it('a project with no name is refused', async () => {
      expect(await status(projects.create({ name: '   ' } as any, actor(ADM)))).toBe(400);
    });
  });

  describe('update', () => {
    it('a Team Lead cannot archive through edit, move the project out of scope, or rewrite its id', async () => {
      expect(await status(projects.update(P.alpha, { status: 'ARCHIVED' }, actor(TL)))).toBe(400);
      expect(await status(projects.update(P.alpha, { departmentId: D2 }, actor(TL)))).toBe(403);
      await projects.update(P.alpha, { projectId: 'PRJ-HACK', name: 'Alpha Website' } as any, actor(TL));
      const row = await prisma.project.findUnique({ where: { id: P.alpha } });
      expect(row?.status).toBe('ACTIVE');
      expect(row?.departmentId).toBe(D1);
      expect(row?.projectId).toBe('PRJ-T20-alpha');
    });

    it('editable fields still save, including clearing the department', async () => {
      const u: any = await projects.update(P.beta, { name: 'Beta Mobile App', description: 'New', priority: 'HIGH', status: 'ON_HOLD', endDate: '2026-12-31T00:00:00.000Z' }, actor(TL));
      expect(u.description).toBe('New');
      expect(u.priority).toBe('HIGH');
      expect(u.status).toBe('ON_HOLD');
      const m: any = await projects.update(P.delta, { departmentId: D1 }, actor(MGR));
      expect(m.departmentId).toBe(D1);
      const a: any = await projects.update(P.delta, { departmentId: null }, actor(ADM));
      expect(a.departmentId).toBeNull();
      await projects.update(P.delta, { departmentId: D3 }, actor(ADM));
      await projects.update(P.beta, { status: 'ACTIVE' }, actor(TL));
    });

    it('employees and out-of-scope leads cannot edit', async () => {
      expect(await status(projects.update(P.alpha, { name: 'x' }, actor(E)))).toBe(403);
      expect(await status(projects.update(P.gamma, { name: 'x' }, actor(TL)))).toBe(403);
    });

    it('archive and restore stay Manager+, within scope', async () => {
      expect(await status(projects.archive(P.alpha, actor(TL)))).toBe(403);
      expect(await status(projects.archive(P.gamma, actor(MGR)))).toBe(403);
      expect(await status(projects.archive(P.alpha, actor(MGR)))).toBe(200);
      expect(await status(projects.restore(P.alpha, actor(MGR)))).toBe(200);
    });
  });

  describe('members', () => {
    it('nobody can add an inactive user, admins included', async () => {
      expect(await status(projects.addMember(P.alpha, GONE, 'MEMBER', actor(ADM)))).toBe(400);
      expect(await status(projects.addMember(P.alpha, GONE, 'MEMBER', actor(TL)))).toBe(400);
    });

    it('a Team Lead cannot add someone from outside their scope', async () => {
      expect(await status(projects.addMember(P.alpha, OUT, 'MEMBER', actor(TL)))).toBe(403);
    });

    it('an unknown role is refused; a valid add, role change and remove work', async () => {
      expect(await status(projects.addMember(P.alpha, E2, 'GOD', actor(TL)))).toBe(400);
      expect(await status(projects.addMember(P.alpha, E2, 'MEMBER', actor(TL)))).toBe(200);
      expect(await status(projects.updateMemberRole(P.alpha, E2, 'OBSERVER', actor(TL)))).toBe(200);
      expect((await prisma.projectMember.findFirst({ where: { projectId: P.alpha, userId: E2 } }))?.role).toBe('OBSERVER');
      expect(await status(projects.removeMember(P.alpha, E2, actor(TL)))).toBe(200);
    });

    it('removing someone who is not a member is a 404, not a server error', async () => {
      expect(await status(projects.removeMember(P.alpha, E2, actor(TL)))).toBe(404);
    });
  });
});
