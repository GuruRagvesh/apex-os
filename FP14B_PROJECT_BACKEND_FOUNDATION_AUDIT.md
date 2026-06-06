# FP-14B — PROJECT BACKEND FOUNDATION — AUDIT
**Date:** 2026-06-02 | Commit: `4ad7a8e`

---

## PHASE 1 AUDIT ANSWERS

| # | Question | Answer |
|---|---|---|
| 1 | Current project statuses | `ACTIVE, ON_HOLD, COMPLETED, CANCELLED` — added `ARCHIVED` as additive enum value |
| 2 | Current ProjectMember.role values in seed/tests | Only `"OWNER"` and `"MEMBER"` found in source. `init` migration confirms `DEFAULT 'MEMBER'`. |
| 3 | Is ProjectMember.role safe to convert to enum? | **NO** — would require production data audit + risky migration. Deferred. |
| 4 | Safest way for role update without enum migration | Service-layer validation against `VALID_MEMBER_ROLES` constant array. No migration needed. |
| 5 | Project scope helper | `buildProjectScope(user)` + `assertCanEditProject(user, project)` in `ProjectsService` |
| 6 | How stage endpoints reuse scope checks | All stage methods call `findOne(projectId, user)` first — inherits all existing scope validation |
| 7 | How activity uses OperationalEvent | Query `OperationalEvent` WHERE `entityType='Project' AND entityId=project.id` OR `entityType='Ticket' AND entityId IN (ticket ids for project)`. No new model. |
| 8 | How tickets link to stages | Nullable `Ticket.projectStageId` FK with `onDelete: SetNull`. Cross-project validation in ticket update service. |
| 9 | What migration is strictly needed | `ProjectStage` table + `Ticket.projectStageId` column + `ProjectStatus.ARCHIVED` value |
| 10 | What should be deferred | `ProjectMemberRole` enum migration, `ProjectDocument`, `ProjectMilestone`, AI endpoints |

---

## PHASE 0 — REPO SAFETY

| Check | Result |
|---|---|
| Branch | `main` |
| Latest commit before FP-14B | `a1ee8ab` (FP-13.4A analytics UI) |
| Dirty tracked files | 3 doc files only (not code) |
| Analytics UI commit present | ✅ Yes |
| No prototype/localStorage code | ✅ Confirmed — all code written from scratch |
| No mock data added | ✅ Confirmed |
