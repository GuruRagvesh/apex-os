# FP-14B — PROJECT BACKEND FOUNDATION — IMPLEMENTATION REPORT
**Date:** 2026-06-02 | Commit: `4ad7a8e`

---

## FILES CHANGED (6)

| File | Change |
|---|---|
| `backend/prisma/schema.prisma` | Added `ProjectStage` model, `Ticket.projectStageId`, `ProjectStatus.ARCHIVED` |
| `backend/prisma/migrations/20260602000001_add_project_stages_foundation/migration.sql` | NEW — additive SQL |
| `backend/src/modules/operations/projects/projects.service.ts` | 11 new methods added |
| `backend/src/modules/operations/projects/projects.controller.ts` | 11 new endpoints |
| `backend/src/modules/operations/tickets/tickets.service.ts` | `projectStageId` query type + filter + update validation |
| `backend/test/unit/fp14b.project-stages.spec.ts` | NEW — 26 unit tests |

---

## MIGRATION SUMMARY

**Folder:** `20260602000001_add_project_stages_foundation`

**SQL operations (all additive, no DROP, no data mutation):**

| Operation | Type | Risk |
|---|---|---|
| `ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED'` | Enum value addition | LOW |
| `CREATE TABLE "project_stages" (...)` | New table | NONE |
| `ADD CONSTRAINT project_stages_projectId_fkey` | FK with CASCADE DELETE | NONE |
| `CREATE INDEX project_stages_projectId_idx` | Index | NONE |
| `CREATE INDEX project_stages_projectId_order_idx` | Composite index | NONE |
| `ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "projectStageId" TEXT` | Nullable column | NONE |
| `ADD CONSTRAINT tickets_projectStageId_fkey ... ON DELETE SET NULL` | FK with SET NULL | NONE |
| `CREATE INDEX tickets_projectStageId_idx` | Index | NONE |

**Migration application status:** NOT YET APPLIED TO PRODUCTION
- Migration SQL created and reviewed manually (cloud DB unreachable from dev machine)
- `prisma generate` run successfully — Prisma Client regenerated with new types
- Must be applied via `npx prisma migrate deploy` on Render deploy

---

## SCHEMA ADDITIONS

### ProjectStage
```prisma
model ProjectStage {
  id, projectId, name, description, order Int @default(0),
  status String @default("PLANNED"),  // validated at service layer
  color, startDate, endDate, createdAt, updatedAt
  // Relations: project (Cascade delete), tickets[] @relation("TicketStage")
}
```

### Ticket.projectStageId
```prisma
projectStageId String?
projectStage   ProjectStage? @relation("TicketStage", onDelete: SetNull)
```

### ProjectStatus.ARCHIVED
New enum value added.

---

## NEW ENDPOINTS (11)

| Method | Endpoint | Role | Description |
|---|---|---|---|
| GET | /projects/:id/stages | Any (scoped) | List all stages ordered by `order` |
| POST | /projects/:id/stages | TL+ | Create a stage (with validation) |
| PATCH | /projects/:id/stages/reorder | TL+ | Bulk reorder by array of IDs |
| PATCH | /projects/:id/stages/:stageId | TL+ | Update stage fields |
| DELETE | /projects/:id/stages/:stageId | TL+ | Delete (rejected if tickets linked) |
| GET | /projects/:id/activity | Any (scoped) | Project + linked ticket events |
| PATCH | /projects/:id/members/:userId | TL+ | Update member role |
| PATCH | /projects/:id/archive | MANAGER+ | Set status → ARCHIVED |
| PATCH | /projects/:id/restore | MANAGER+ | Set status → ACTIVE |

Ticket endpoints (updated):
| Method | Endpoint | Change |
|---|---|---|
| GET | /tickets | Now accepts `?projectStageId=` query param |
| PUT/PATCH | /tickets/:id | Validates `projectStageId` cross-project constraint |

---

## RBAC RULES IMPLEMENTED

| Action | EMPLOYEE | TEAM_LEAD | MANAGER | ADMIN | SUPER_ADMIN |
|---|---|---|---|---|---|
| List stages | Own-project only | Dept/member | Managed depts | All | All |
| Create/update/delete stage | ❌ | ✅ (scoped) | ✅ (scoped) | ✅ | ✅ |
| Reorder stages | ❌ | ✅ (scoped) | ✅ (scoped) | ✅ | ✅ |
| Get project activity | Own-project only | Dept/member | Managed depts | All | All |
| Update member role | ❌ | ✅ (scoped) | ✅ (scoped) | ✅ | ✅ |
| Archive project | ❌ | ❌ | ✅ (scoped) | ✅ | ✅ |
| Restore project | ❌ | ❌ | ✅ (scoped) | ✅ | ✅ |
| Assign ticket to stage | Via ticket edit rules | Via ticket edit rules | Via ticket edit rules | ✅ | ✅ |

All RBAC flows through the existing `assertCanEditProject()` and `findOne()` scope checks — backend is source of truth.

---

## VALIDATION RULES

**Stage creation/update:**
- `name` required, trimmed
- `status` must be one of: `PLANNED, ACTIVE, COMPLETED, SKIPPED`
- `endDate` must not be before `startDate`
- Stage `order` defaults to max existing order + 1

**Stage delete:**
- Rejects if any tickets have `projectStageId = this stage` (data integrity)

**Reorder:**
- All provided IDs must belong to the target project
- Uses `$transaction` for atomic bulk update

**Member role update:**
- Role must be one of: `OWNER, LEAD, DEVELOPER, REVIEWER, OBSERVER, MEMBER`
- Target user must be a current project member

**Ticket stage assignment:**
- Stage must exist
- Stage's `projectId` must match ticket's `projectId`
- Ticket must be linked to a project before stage assignment

---

## EXPLICITLY CONFIRMED UNCHANGED

| System | Status |
|---|---|
| Project V2 frontend | ✅ Not implemented |
| localStorage/prototype code | ✅ Zero prototype code used |
| Mock data | ✅ None added |
| Email/SMTP/Resend | ✅ Untouched |
| Cloudinary/OpenAI | ✅ Untouched |
| Analytics dashboard UI | ✅ Untouched |
| FP-13 timer/review/rework logic | ✅ Untouched |
| Ticket lifecycle transitions | ✅ Untouched (only added stage filter/validation) |
