import * as fs from 'fs';
import * as path from 'path';

describe('Default Tickets Create Ticket surface', () => {
  const root = path.resolve(__dirname, '../../..');
  const page = fs.readFileSync(
    path.join(root, 'frontend/app/(dashboard)/(operations)/tickets/new/page.tsx'),
    'utf8',
  );
  const component = fs.readFileSync(
    path.join(root, 'platforms/operations/tickets/lifecycle/frontend/components/quick-ticket-tags.tsx'),
    'utf8',
  );
  const controller = fs.readFileSync(
    path.join(root, 'backend/src/modules/operations/tickets/ticket-templates.controller.ts'),
    'utf8',
  );

  it('puts created Default Tickets above the ticket form without a large container', () => {
    expect(page).not.toContain('Global Defaults');
    expect(page.indexOf('<QuickTicketTags')).toBeGreaterThan(page.indexOf('preselectedProjectName'));
    expect(page.indexOf('<QuickTicketTags')).toBeLessThan(page.indexOf('<form onSubmit={handleSubmit}'));
    expect(component).not.toContain('apex-card p-5 mb-4');
    expect(component).toContain('flex flex-nowrap items-center');
  });

  it('places Create Default Tickets before the Excel actions and removes helper copy', () => {
    expect(page.indexOf('Create Default Tickets')).toBeLessThan(page.indexOf('Download Excel Template'));
    expect(page.indexOf('Download Excel Template')).toBeLessThan(page.indexOf('Import from Excel'));
    expect(page).not.toContain('Add one or many tickets');
    expect(component).not.toContain('Your private reusable ticket templates');
    expect(component).not.toContain('Create a Quick Tag to reuse ticket details in one click.');
    expect(page).not.toContain('Applied Quick Tag');
  });

  it('keeps the requested responsive page margins', () => {
    expect(page).toContain('w-full px-[10px] md:px-[50px] pb-10');
  });

  it('keeps duplicate-ticket inheritance and does not reintroduce global defaults', () => {
    expect(page).toContain('const duplicateRow');
    expect(page).toContain('const copy: TicketRow = { ...rs[idx], key: newKey()');
    expect(page).not.toContain('globalDefaults');
    expect(page).not.toContain('setGlobal(');
  });

  it('requires confirmation before replacing meaningful form data', () => {
    expect(component).toContain('Apply this Default Ticket?');
    expect(component).toContain('Some information already entered in the ticket form will be replaced.');
    expect(component).toContain('Apply Default');
    expect(component).toContain('Cancel');
  });

  it('applies values locally and never creates a ticket automatically', () => {
    const applyBody = page.slice(page.indexOf('const applyQuickTag'), page.indexOf('const suggestPriority'));
    expect(applyBody).toContain('setRows');
    expect(applyBody).toContain("startDate: ''");
    expect(applyBody).toContain("dueDate: ''");
    expect(applyBody).not.toContain('ticketsApi.create');
    expect(applyBody).not.toContain('handleSubmit');
  });

  it('keeps Work Classification, dates, status and attachments out of template storage', () => {
    expect(component).not.toContain('Work Classification');
    expect(component).not.toContain('Start Date');
    expect(component).not.toContain('Due Date');
    expect(component).not.toContain('Attachment');
    expect(component).not.toContain('Ticket Status');
  });

  it('requires only Default Ticket Name and Ticket Title', () => {
    expect(component).toContain("departmentId: form.departmentId || null");
    expect(component).toContain("taskTypeId: form.taskTypeId || null");
    expect(component).toContain('assigneeIds: assigneeLocked && currentUser?.id ? [currentUser.id] : form.assigneeIds');
    expect(component).toContain("priority: form.priority || null");
    expect(component).toContain('estimatedMinutes,');
    expect(component).not.toContain('Assigned To is required');
  });

  it('uses the existing ticket MultiSelect for multiple default assignees', () => {
    expect(component).toContain("import { MultiSelect } from '@apex/shared-ui/components/multi-select'");
    expect(component).toContain('value={form.assigneeIds}');
    expect(component).toContain('onChange={(assigneeIds)');
    expect(page).toContain('assigneeIds: template.assigneeIds ?? []');
  });

  it('is available to every authenticated role that can open Create Tickets', () => {
    expect(page).toContain('<QuickTicketTags');
    expect(page).toContain('Create Default Tickets');
    expect(page).not.toMatch(/(?:isAdmin|isTL|isEmployee).*Create Default Tickets/);
    expect(controller).toContain('@UseGuards(JwtAuthGuard)');
    expect(controller).not.toContain('RolesGuard');
    expect(controller).not.toContain('@Roles(');
  });

  it('reuses the normal TASK assignee hierarchy including approved cross-department roles', () => {
    expect(page).toContain('assigneesFor={usersFor}');
    expect(page).toContain('departmentLocked={lockDept}');
    expect(page).toContain('assigneeLocked={lockAssignee}');
    expect(page).toContain("['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName)");
    expect(page).toContain('if (canAssignAcrossDepartments) return creationAssignees');
    expect(page).toContain('ticketsApi.getCreationAssignees()');
    expect(component).toContain('const assignees = assigneesFor(form.departmentId)');
    expect(component).toContain('assigneeLocked ? (');
    expect(component).toContain('Assigned to you');
    expect(component).not.toContain("const departmentLocked = ['EMPLOYEE', 'INTERN', 'TEAM_LEAD']");
  });

  it('shows Default Ticket actions only after more than three templates exist', () => {
    expect(component).toContain('NEEDS_UPDATE');
    expect(component).toContain('View All');
    expect(component).toContain('Customize');
    expect(component).toContain('templates.length > 3');
    expect(component).toContain('showManagementActions &&');
    expect(component).toContain('Duplicate');
    expect(component).toContain('Move up');
    expect(component).toContain('Move down');
  });

  it('loads task types when a department is selected only inside the template editor', () => {
    expect(page).toContain('ensureTaskTypes={ensureTaskTypes}');
    expect(component).toContain('ensureTaskTypes(form.departmentId)');
    expect(component).toContain('[form.departmentId, ensureTaskTypes]');
  });
});
