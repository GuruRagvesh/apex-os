# P0 Baseline Results

Date: 2026-05-27

## Branch Safety

- Requested branch: `fix/p0-stabilization-core`
- Current branch before changes: `stabilize/apex-os-core`
- Branch creation result: failed due local Git ref permissions.
- Command attempted: `git checkout -b fix/p0-stabilization-core`
- Error: `fatal: cannot lock ref 'refs/heads/fix/p0-stabilization-core': unable to create directory for .git/refs/heads/fix/p0-stabilization-core`
- Fallback branch attempted: `fix-p0-stabilization-core`
- Error: `Permission denied` creating `.git/refs/heads/fix-p0-stabilization-core.lock`

Work continued on the existing working tree because the sandbox cannot write Git refs in `.git`.

## Confirmed P0 Code Paths

- Backend auth/RBAC: `backend/src/modules/core/auth`, `backend/src/shared/guards`, `backend/src/shared/decorators`, `backend/src/shared/constants/roles.ts`
- Backend users/profile/documents/payroll: `backend/src/modules/core/users/users.controller.ts`, `backend/src/modules/core/users/users.service.ts`
- Backend tickets: `backend/src/modules/operations/tickets/tickets.controller.ts`, `backend/src/modules/operations/tickets/tickets.service.ts`
- Backend comments: `backend/src/modules/operations/comments/comments.controller.ts`, `backend/src/modules/operations/comments/comments.service.ts`
- Backend uploads: `backend/src/modules/platform/uploads/uploads.service.ts`
- Backend leave: `backend/src/modules/operations/leave/leave.controller.ts`, `backend/src/modules/operations/leave/leave.service.ts`
- Backend projects: `backend/src/modules/operations/projects/projects.controller.ts`, `backend/src/modules/operations/projects/projects.service.ts`
- Backend dashboard/analytics: `backend/src/modules/platform/dashboard/dashboard.controller.ts`, `backend/src/modules/platform/dashboard/dashboard.service.ts`
- Backend settings/SLA: `backend/src/modules/platform/settings/settings.controller.ts`, `backend/src/modules/platform/settings/settings.service.ts`
- Prisma schema: `backend/prisma/schema.prisma`
- Frontend API wrapper: `frontend/lib/api.ts`
- Frontend tickets: `frontend/app/(dashboard)/(operations)/tickets`, `frontend/app/(dashboard)/(operations)/kanban/page.tsx`
- Frontend projects: `frontend/app/(dashboard)/(operations)/projects`
- Frontend leave: `frontend/app/(dashboard)/(operations)/leave/page.tsx`
- Frontend users/profile: `frontend/app/(dashboard)/(platform)/users`
- Frontend analytics/dashboard/settings: `frontend/app/(dashboard)/analytics/page.tsx`, `frontend/app/(dashboard)/(core)/dashboard/page.tsx`, `frontend/app/(dashboard)/settings/page.tsx`

## Baseline Commands

| Command | Status | Notes |
|---|---:|---|
| `cmd /c npx prisma validate` in `backend` | PASS | Prisma schema is valid. |
| `cmd /c npx prisma migrate status` in `backend` | FAIL | Database reachable, but migrations `20260525000001_add_custom_subtype_text` and `20260525000002_add_operational_event` are not applied. |
| `cmd /c npm run build` in `backend` | FAIL | `prisma generate` fails with `EPERM: operation not permitted, unlink ... node_modules\\.prisma\\client\\index.js`. |
| `cmd /c npx tsc -p tsconfig.json` in `backend` | PASS | TypeScript compilation succeeds when skipping Prisma generate. |
| `cmd /c npm run lint` in `backend` | FAIL | ESLint config file is missing. |
| `cmd /c npm test -- --runInBand` in `backend` | FAIL | 5 suites total, 4 passed, 1 failed. 53 tests passed, 8 failed. Failures are in `test/unit/auth.otp.spec.ts` because the Prisma mock lacks `user.findFirst`. |
| `cmd /c npm run build` in `frontend` | FAIL | Next build cannot fetch Google Font `Inter` because network access is blocked: `connect EACCES ... fonts.googleapis.com`. |
| `cmd /c npm run lint` in `frontend` | FAIL | `next lint` prompts for initial ESLint setup and exits non-zero. |

## Baseline Notes

- `node_modules` already exists in root, backend, and frontend, so install was not run.
- Baseline build/test failures are pre-existing and are not caused by P0 stabilization changes.
- Backend TypeScript compile passes when Prisma generate is bypassed.
- Prisma migration status is not clean because two migrations are pending.
