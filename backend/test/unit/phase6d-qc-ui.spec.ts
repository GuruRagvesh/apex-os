import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

// Phase 6D QC (ApexOS QC.xlsx: Sonali 3, 5, 6, 7, 10; Shama 2). The frontend
// has no test runner of its own, so the wiring is checked from source; the
// dialog positioning cause was reproduced in a browser (see the report).

const REPO = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8').replace(/\r\n/g, '\n');

const sidebar = read('frontend/components/layout/sidebar.tsx');
const css = read('frontend/app/globals.css');
const users = read('platforms/core/users/administration/frontend/screens/UsersScreen.tsx');
// Archive, Rehire and Permanently delete live in their own module; they are Users & Roles dialogs too.
const lifecycleModals = read('platforms/core/users/administration/frontend/screens/UserLifecycleModals.tsx');
const deptList = read('platforms/core/organization/departments/frontend/screens/DepartmentsScreen.tsx');
const deptDetail = read('platforms/core/organization/departments/frontend/screens/DepartmentDetailScreen.tsx');
const deptTeams = read('platforms/workforce/teams/team-management/frontend/components/DepartmentTeams.tsx');
const teamsScreen = read('platforms/workforce/teams/team-management/frontend/screens/TeamsScreen.tsx');
const teamDetail = read('platforms/workforce/teams/team-management/frontend/screens/TeamDetailScreen.tsx');

describe('Sonali 3 / Shama 2: the Manage Teams tab is gone', () => {
  it('no sidebar entry points at /teams, in any mode', () => {
    expect(sidebar).not.toMatch(/href:\s*'\/teams'/);
    expect(sidebar).not.toContain("label: 'Manage Teams'");
  });

  it('Managers and HR reach their departments from the main nav; admins keep it in Admin only', () => {
    expect(sidebar).toContain("{ href: '/departments', label: 'Departments', icon: Building2       },");
    expect(sidebar).toContain('const showScopedDepartments = (isManager || isHR) && !isAdmin;');
    expect(sidebar).toContain(".filter((item) => item.href !== '/departments' || showScopedDepartments);");
  });

  it('the old /teams and /teams/:id screens only redirect; they render no team UI and change nothing', () => {
    expect(teamsScreen).toContain("router.replace('/departments')");
    expect(teamDetail).toContain('router.replace(`/departments/${team.departmentId}`)');
    for (const src of [teamsScreen, teamDetail]) {
      expect(src).not.toMatch(/teamsApi\.(create|update|remove|addMember|updateMember|removeMember)\(/);
      expect(src).not.toMatch(/<input|<select|<button/);
    }
  });
});

describe('Sonali 3 / 7: New Team inside Departments, teams shown per department', () => {
  it('New Team sits right after New Department, in the same button group', () => {
    const group = deptList.slice(deptList.indexOf('{/* New Department, then New Team'), deptList.indexOf('{/* Cards */}'));
    expect(group.indexOf('New Department')).toBeGreaterThan(-1);
    expect(group.indexOf('New Team')).toBeGreaterThan(group.indexOf('New Department'));
    expect(group).toContain('className="flex items-center gap-3 flex-wrap justify-end"');
    expect(deptList).toContain('<NewTeamDialog');
  });

  it('the New Team pop-up is the Manage Teams one: same fields, same call, same messages', () => {
    // The exact strings the retired Manage Teams screen used (pinned here, not
    // read from git, so this keeps holding after the change is merged).
    for (const s of [
      'teamsApi.create({',
      'name: form.name.trim(),',
      'departmentId: form.departmentId,',
      'teamLeadId: form.teamLeadId || undefined,',
      "toast.success('Team created');",
      "toast.error(err?.message || 'Failed to create team')",
      'placeholder="e.g., Frontend Squad"',
      'Select a department first',
    ]) {
      expect(deptTeams).toContain(s);
    }
  });

  it('each department page has a Teams container right after Members, before Active Tickets', () => {
    const members = deptDetail.indexOf('{/* Members List */}');
    const teams = deptDetail.indexOf('<DepartmentTeamsPanel');
    const tickets = deptDetail.indexOf('{/* Active Tickets */}');
    expect(members).toBeGreaterThan(-1);
    expect(teams).toBeGreaterThan(members);
    expect(tickets).toBeGreaterThan(teams);
    expect(deptDetail).not.toContain('router.push(`/teams/');
  });

  it('the Teams container lists, creates, edits, deletes and manages members with the existing endpoints', () => {
    for (const call of ['teamsApi.getAll(department.id)', 'teamsApi.update(team.id,', 'teamsApi.remove(team.id)', 'teamsApi.getOne(team.id)', 'teamsApi.addMember(team.id,', 'teamsApi.removeMember(team.id,']) {
      expect(deptTeams).toContain(call);
    }
    expect(deptTeams).toContain("queryKey: ['teams', department.id]");
    expect(deptTeams).toContain("{canManage ? 'No teams in this department yet.' : 'You are not in any team in this department.'}");
    expect(deptTeams).toContain('Could not load teams.');
  });

  it('team actions are offered only to the roles the teams API accepts', () => {
    expect(deptTeams).toContain("export const TEAM_MANAGE_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MANAGER'];");
    expect(deptList).toContain('const canManageTeams = TEAM_MANAGE_ROLES.includes(roleName);');
    expect(deptDetail).toContain('canManage={canManageTeams}');
  });

  it('department settings stay admin-only for Managers and HR', () => {
    expect(deptList).toContain('{isAdmin && (\n            <button onClick={() => setShowNew(true)}');
    expect(deptDetail).toContain('enabled: hasHydrated && isAdmin && (showAddMember || showAddManager)');
  });
});

describe('Sonali 5: Users & Roles dialogs are centred on the screen', () => {
  it('the dashboard <main> keeps no transform after its entry animation', () => {
    expect(css).toContain('animation: apex-page-in 0.18s ease-out backwards;');
    expect(css).not.toContain('animation: apex-page-in 0.18s ease-out both;');
  });

  it('overlays never take a margin (the space-y stack pushed them 20px down)', () => {
    expect(css).toMatch(/\.apex-backdrop \{[^}]*margin: 0 !important;/);
  });

  it('every Users & Roles dialog is a fixed full-screen overlay with blur, no margin, and fits short screens', () => {
    const overlays = users.match(/fixed inset-0 !m-0 z-\[?\d+\]? flex items-center justify-center p-4 bg-black\/\d+ backdrop-blur-sm/g) ?? [];
    // UsersScreen: Edit, Deactivate, New User. The lifecycle module has one shared
    // shell used by Archive, Rehire and Permanently delete.
    expect(overlays.length).toBe(3);
    expect(users.split('modal-enter max-h-[calc(100vh-2rem)] overflow-y-auto').length - 1).toBe(3);
    expect((lifecycleModals.match(/fixed inset-0 !m-0 z-\[?\d+\]? flex items-center justify-center p-4 bg-black\/\d+ backdrop-blur-sm/g) ?? []).length).toBe(1);
    expect(lifecycleModals.split('modal-enter max-h-[calc(100vh-2rem)] overflow-y-auto').length - 1).toBe(1);
  });

  it('no dialog logic changed: the same mutations the screen always used', () => {
    expect(users).toContain('usersApi.deactivate(id)');
    // Phase 2: reactivation is its own audited operation, not a field toggle.
    expect(users).not.toContain('usersApi.update(id, { isActive })');
    expect(lifecycleModals).toContain('usersApi.reactivate(user.id, {');
    // Archive and permanent deletion moved to the lifecycle endpoints.
    for (const s of ['usersApi.archive(user.id, key)', 'usersApi.permanentDelete(user.id, { idempotencyKey: key, confirmation })', 'usersApi.rehire(user.id,']) {
      expect(lifecycleModals).toContain(s);
    }
    expect(users).not.toContain('archiveAfterBackup');
  });
});

describe('Sonali 6: user cards keep the approved responsive directory layout', () => {
  const card = users.slice(users.indexOf('{filteredUsers.map((u: any) => {'), users.indexOf('{filteredUsers.length === 0'));

  it('uses equal fixed-height cards in a responsive 1 / 2 / 3-column grid', () => {
    expect(users).toContain('grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3');
    expect(card).toContain('flex h-[288px] min-w-0 flex-col');
    expect(card).toContain('grid h-14 flex-shrink-0 grid-cols-3 gap-2');
  });

  it('uses one fixed profile circle containing either the photo or name initials', () => {
    expect(card).toContain('{u.photoUrl ? (');
    expect(card).toContain('className="h-20 w-20 rounded-full object-cover"');
    expect(card).toContain('{getInitials(u.name)}');
    expect(card).toContain('className="apex-user-initials text-2xl font-bold tracking-wide"');
    expect(css).toMatch(/\.apex-user-initials \{ color: #2563eb; \}/);
    expect(css).toMatch(/html\[data-theme="john-wick-dark"\] \.apex-user-initials \{ color: #ffffff !important; \}/);
  });

  it('renders only the actions allowed by the server-backed activation status', () => {
    expect(card).toContain('const isActive = u.isActive !== false;');
    expect(card).toContain('{isActive ? (');
    expect(card).toContain('title="Edit user"');
    expect(card).toContain('title="Download user backup (.xlsx)"');
    expect(card).toContain('title="Deactivate user"');
    expect(card).toContain('title="Reactivate user"');
    // Active: Edit/Download/Deactivate; inactive: Reactivate/Archive; archived:
    // Rehire/Verified archive/Permanent delete. Every action stays compact.
    expect(card.match(/flex h-9 w-9 items-center justify-center/g)).toHaveLength(8);
    expect(card).not.toContain('flex h-11 w-11 items-center justify-center');
    // Archive is offered only after deactivation; active users cannot enter the
    // archive flow directly. Archived cards instead offer Rehire and Permanently delete.
    expect(card).toContain('const canArchiveUser = canManageUser && !isActive;');
    expect(card.match(/title="Archive user"/g)).toHaveLength(1);
    expect(card).toContain('{canArchiveUser && (');
    expect(card).toContain('title="Archive user"');
    expect(card).toContain("title={lifecycleBusy ? 'Another archive, rehire or deletion is running' : 'Rehire user'}");
    expect(card).toContain("title={deleteDisabledReason ?? 'Permanently delete user'}");
    expect(users).toContain('updateCachedUserActiveStatus(u.id, !!u.isActive);');
    // Someone scheduled to join is never offered Reactivate.
    expect(card).toContain('{!scheduled && <button');
    expect(users).toContain('updateCachedUserActiveStatus(id, false);');
  });
});

describe('boundaries', () => {
  it('Sonali 10: My Team changes only through an explicit, reviewed baseline update', () => {
    // SHA-256 of the page (line endings normalised) at main 139134f. Phase 6D
    // must not touch it; a later, deliberate My Team change updates this hash.
    // Updated since: the team-status poll now backs off while it fails
    // (pollWhileHealthy, Tickets 500 / polling repair), and the reviewed
    // availability/profile-photo enhancements made the collaboration state
    // visible without conflating it with ticket workload. The shared search
    // input class now also keeps text clear of its leading icon.
    const page = read('frontend/app/(dashboard)/(operations)/team/page.tsx');
    expect(createHash('sha256').update(page).digest('hex')).toBe('f15ca47b33bd499a0b652d3a90fdf1a786a2de082480a8c2a1a043be311380d3');
  });

  it('department responses read users through the safe select, never a full-row include', () => {
    const service = read('backend/src/modules/core/departments/departments.service.ts');
    expect(service).toContain('const MEMBER_SELECT = {');
    // Before the fix the list and the detail did `include: { role: true }` on
    // users, which returns every User column. No user relation is read that way now.
    expect(service).not.toMatch(/role:\s*true/);
    for (const secret of ['password', 'ctcAnnual', 'basicSalary', 'accountNumber', 'panNumber', 'aadhaarNumber']) {
      expect(service.slice(service.indexOf('const MEMBER_SELECT'), service.indexOf('} as const;'))).not.toContain(secret);
    }
  });
});
