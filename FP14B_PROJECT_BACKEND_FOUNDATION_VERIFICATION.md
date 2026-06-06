# FP-14B — PROJECT BACKEND FOUNDATION — VERIFICATION
**Date:** 2026-06-02 | Commit: `4ad7a8e`

---

## AUTOMATED VERIFICATION

| Check | Command | Result |
|---|---|---|
| Prisma validate | `npx prisma validate` | ✅ **PASS** — schema valid |
| Prisma generate | `npx prisma generate` | ✅ **PASS** — client regenerated |
| FP-14B unit tests | `npm test -- --runInBand fp14b.project-stages` | ✅ **PASS** 26/26 |
| Full unit suite (21 suites) | `npm test -- --runInBand test/unit` | ✅ **PASS** 186/186 |
| Backend TypeScript | `tsc -p backend/tsconfig.json --noEmit` | ✅ **PASS** (exit 0) |
| Backend build | `npm run build` | ✅ **PASS** (exit 0) |
| Pushed to origin | `git push origin main` | ✅ `a1ee8ab..4ad7a8e` |

---

## TEST DETAIL — fp14b.project-stages.spec.ts (26 tests)

```
FP-14B — ProjectsService
  Stage list
    ✓ member can list stages
  Stage create
    ✓ employee cannot create stage
    ✓ manager can create stage if scoped
    ✓ admin can create stage
    ✓ invalid stage status is rejected
    ✓ endDate before startDate is rejected on create
  Stage update
    ✓ update stage works for manager
    ✓ endDate before startDate rejected on update
  Stage delete
    ✓ delete stage with linked tickets is rejected
    ✓ delete stage with no linked tickets succeeds
  Stage reorder
    ✓ reorder stages works
    ✓ foreign stage id in reorder is rejected
  Activity
    ✓ activity endpoint returns project events and linked ticket events
    ✓ activity endpoint respects project scope
  Member role
    ✓ update member role works for manager
    ✓ invalid role is rejected on member role update
    ✓ non-member role update is rejected
    ✓ employee cannot update member role
  Archive/Restore
    ✓ manager can archive scoped project
    ✓ admin can archive
    ✓ employee cannot archive
    ✓ restore works for admin
    ✓ hard delete still restricted to admin
  Regression
    ✓ blocks a manager from editing a project outside scoped departments/membership
    ✓ allows admin project edit
    ✓ fetches project successfully by CUID/DB id
```

---

## MIGRATION STATUS

| Environment | Status | How to apply |
|---|---|---|
| **Production (Render)** | ⏳ NOT YET APPLIED | `npx prisma migrate deploy` on next Render deploy |
| **Local dev** | ⏳ NOT YET APPLIED | `npx prisma migrate deploy` (requires DB connection) |

**Why not applied:** The cloud PostgreSQL host (`dpg-d8259omk1jcs73e37fbg-a.oregon-postgres.render.com`) is unreachable from the local dev machine. The migration SQL was created manually and is identical to what `prisma migrate dev` would generate.

**Safe to apply:** The migration is entirely additive (no DROP, no data changes). `IF NOT EXISTS` guards on indexes and `IF NOT EXISTS` on column ensure idempotency.

**Next deploy trigger:** Push to `main` → Render detects push → runs `npx prisma migrate deploy && node dist/main.js` per `render.yaml` → migration `20260602000001_add_project_stages_foundation` will be applied automatically.

---

## REMAINING GAPS

| Gap | Priority | Resolution |
|---|---|---|
| Frontend tab shell (FP-14C) | P1 | Next pack — tabbed project detail + multi-step create |
| Stage Kanban UI with drag-drop (FP-14D) | P2 | After FP-14C |
| Lifecycle/roadmap view (FP-14E) | P1 | After FP-14C |
| `ProjectMemberRole` enum formalization | P2 | Deferred — needs production data audit |
| Documents tab (FP-14H) | P2 | Separate migration + storage work |
| Project analytics dashboard (FP-14G) | P2 | Extend analytics service |
| AI workflow generation (FP-14J) | FUTURE | After stages + lifecycle complete |
| Production smoke test of new endpoints | P0 | After Render deploys `4ad7a8e` |
