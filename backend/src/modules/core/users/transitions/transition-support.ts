import { NotificationType } from '@prisma/client';

/**
 * Recipients and post-commit notifications for Phase 4 workflows.
 *
 * Notifications go through NotificationEventService, which ALWAYS writes the
 * durable Notification Center row; preferences only mute popup, push and
 * email. They are sent after the transaction commits, so a rolled-back
 * mutation never notifies. Messages carry no legal notes, references or
 * amounts; links are fixed in-app routes.
 */

export interface Notifier {
  sendNotification(
    userId: string,
    eventKey: string,
    data: { title: string; message: string; type: NotificationType; link?: string; entityId?: string; entityType?: string; dedupeKey?: string },
  ): Promise<unknown>;
}

const human = { isActive: true, isSystemAccount: false };

export async function adminIds(db: any): Promise<string[]> {
  const rows = await db.user.findMany({ where: { ...human, role: { name: { in: ['ADMIN', 'SUPER_ADMIN'] } } }, select: { id: true } });
  return rows.map((r: { id: string }) => r.id);
}

export async function hrIds(db: any): Promise<string[]> {
  const rows = await db.user.findMany({ where: { ...human, isHR: true }, select: { id: true } });
  return rows.map((r: { id: string }) => r.id);
}

export async function hrAndAdminIds(db: any): Promise<string[]> {
  return [...new Set([...(await hrIds(db)), ...(await adminIds(db))])];
}

const activeAt = (now: Date) => ({ isPrimary: true, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] });
const usable = (u: any, subjectId: string) => !!u && u.isActive && !u.isSystemAccount && u.id !== subjectId;
const userSel = { id: true, isActive: true, isSystemAccount: true };

/** The person's Team Lead: employee TL, else department TL, else department Manager. */
export async function resolveTeamLead(db: any, userId: string, departmentId: string | null, now: Date): Promise<string | null> {
  const emp = await db.hierarchyAssignment.findFirst({
    where: { scope: 'EMPLOYEE', role: 'TEAM_LEAD', subjectUserId: userId, ...activeAt(now) },
    orderBy: { effectiveFrom: 'desc' },
    include: { assigneeUser: { select: userSel } },
  });
  if (usable(emp?.assigneeUser, userId)) return emp.assigneeUser.id;
  if (!departmentId) return null;
  for (const role of ['TEAM_LEAD', 'MANAGER']) {
    const dept = await db.hierarchyAssignment.findFirst({
      where: { scope: 'DEPARTMENT', role, departmentId, ...activeAt(now) },
      orderBy: { effectiveFrom: 'desc' },
      include: { assigneeUser: { select: userSel } },
    });
    if (usable(dept?.assigneeUser, userId)) return dept.assigneeUser.id;
  }
  return null;
}

/** The department Manager, else the configured company Manager. */
export async function resolveDepartmentManager(db: any, userId: string, departmentId: string | null, now: Date): Promise<string | null> {
  if (departmentId) {
    const dept = await db.hierarchyAssignment.findFirst({
      where: { scope: 'DEPARTMENT', role: 'MANAGER', departmentId, ...activeAt(now) },
      orderBy: { effectiveFrom: 'desc' },
      include: { assigneeUser: { select: userSel } },
    });
    if (usable(dept?.assigneeUser, userId)) return dept.assigneeUser.id;
  }
  const company = await db.hierarchyAssignment.findFirst({
    where: { scope: 'COMPANY', role: 'MANAGER', ...activeAt(now) },
    orderBy: { effectiveFrom: 'desc' },
    include: { assigneeUser: { select: userSel } },
  });
  return usable(company?.assigneeUser, userId) ? company.assigneeUser.id : null;
}

/** People who may read a subordinate's exit timeline: their TL and Manager chain. */
export async function supervisorIds(db: any, userId: string, departmentId: string | null, now: Date): Promise<string[]> {
  const ids = [await resolveTeamLead(db, userId, departmentId, now), await resolveDepartmentManager(db, userId, departmentId, now)];
  return [...new Set(ids.filter((x): x is string => !!x))];
}

/** Sends one message to each recipient; failures never surface to the caller. */
export async function notifyMany(
  notifier: Notifier | undefined,
  recipients: Iterable<string>,
  eventKey: string,
  build: (userId: string) => { title: string; message: string; link: string; entityId: string; entityType: string; dedupeKey: string; type?: NotificationType },
): Promise<void> {
  if (!notifier) return;
  for (const userId of new Set(recipients)) {
    const d = build(userId);
    await notifier
      .sendNotification(userId, eventKey, { type: d.type ?? NotificationType.INFO, ...d })
      .catch(() => undefined);
  }
}
