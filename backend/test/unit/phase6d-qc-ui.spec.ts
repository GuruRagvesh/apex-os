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
    expect(overlays.length).toBe(6);
    expect(users.split('modal-enter max-h-[calc(100vh-2rem)] overflow-y-auto').length - 1).toBe(6);
  });

  it('no dialog logic changed: the same mutations the screen always used', () => {
    for (const s of ['usersApi.deactivate(id)', 'usersApi.permanentDelete(vars.id)', 'usersApi.archiveAfterBackup(id, { confirmBackupDownloaded: true })', 'usersApi.update(id, { isActive })']) {
      expect(users).toContain(s);
    }
  });
});

describe('Sonali 6: user cards keep one fixed layout', () => {
  const card = users.slice(users.indexOf('{filteredUsers.map((u: any) => ('), users.indexOf('{filteredUsers.length === 0'));

  it('header: a fixed-size initials circle, the details, and the actions pinned right', () => {
    expect(card).toContain('style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, minWidth: AVATAR_SIZE, backgroundColor: initialsColor(u) }}');
    expect(card).toContain('{getInitials(u.name)}');
    const header = card.slice(0, card.indexOf('{/* Photo preview'));
    expect(header).not.toContain('<img');
  });

  it('a photo is a fixed round preview below the header and above View Profile', () => {
    const photo = card.indexOf('{/* Photo preview');
    const view = card.indexOf('View Profile');
    expect(photo).toBeGreaterThan(-1);
    expect(view).toBeGreaterThan(photo);
    expect(card).toContain("style={{ width: PHOTO_PREVIEW_SIZE, height: PHOTO_PREVIEW_SIZE, objectFit: 'cover'");
    expect(users).toContain('const PHOTO_PREVIEW_SIZE = 112;');
  });

  it('the initials colour is the user\'s own hex colour, otherwise stable per name', () => {
    expect(users).toContain("if (typeof u?.avatar === 'string' && /^#[0-9a-f]{3,8}$/i.test(u.avatar)) return u.avatar;");
  });
});

describe('boundaries', () => {
  it('Sonali 10: My Team is byte-for-byte what it was when Phase 6D started', () => {
    // SHA-256 of the page (line endings normalised) at main 139134f. Phase 6D
    // must not touch it; a later, deliberate My Team change updates this hash.
    const page = read('frontend/app/(dashboard)/(operations)/team/page.tsx');
    expect(createHash('sha256').update(page).digest('hex')).toBe('9a36dd508ef76b73e8b3a62af718eeafaa706ce5b11b339035bfbbc2cf0629ac');
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
