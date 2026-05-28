# Project Workflow Report

**Date:** 2026-05-27  
**Sprint:** P1-B  
**Status:** COMPLETE

---

## 1. Audit Events Wired

**Gap:** `projects.service.ts` had no operational event logging; it used `activityLog` for creation only.  
**Fix:** Injected `EventLoggerService` (provided by global `CommonModule`) into `ProjectsService`.

| Method | Action logged |
|--------|--------------|
| `create()` | `PROJECT_CREATED` — replaces activityLog.create |
| `update()` | `PROJECT_UPDATED` — fields list in metadata |
| `addMember()` | `PROJECT_MEMBER_ADDED` — memberId + role |
| `removeMember()` | `PROJECT_MEMBER_REMOVED` — memberId |
| `remove()` | `PROJECT_DELETED` — projectId |

All log calls are fire-and-forget (`.catch(() => {})`) so they never crash the primary operation.

---

## 2. Progress Calculation: Backend-Authoritative

**Gap:** `projects/[id]/page.tsx` recalculated progress client-side from `project.tickets` array, ignoring the backend-computed `ticketStats` and `progress` fields returned by `ProjectsService.findOne()`.

**Backend returns (already implemented in P0):**
```json
{
  "progress": 45,
  "ticketStats": { "total": 20, "done": 9, "open": 11 }
}
```

**Fix:** `frontend/app/(dashboard)/(operations)/projects/[id]/page.tsx`
- Progress now reads `project.progress` (backend-computed integer 0–100).
- Falls back to `ticketStats.done / ticketStats.total` if `progress` field absent.
- Final fallback to client-side calculation for old API compatibility.
- This ensures progress bars reflect exactly what the backend computed (terminals = DONE | CLOSED).

---

## 3. Archive / Delete Guard

**Pre-existing (P0):** `remove()` already enforces `this.accessPolicy.isAdmin(user)` — only ADMIN/SUPER_ADMIN can delete projects. Non-admins get `ForbiddenException('Only admins can delete projects')`.

No change required — gap was pre-existing P0 implementation.

---

## Verification

- `npx tsc --noEmit`: ✅ 0 errors
- `npx jest test/unit --forceExit`: ✅ 56/56 tests passed
