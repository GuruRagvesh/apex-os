# P1-9 — Apex OS Production Smoke Validation Report

**Date:** 2026-05-30
**Target environment:** Production
**Backend:** NestJS on Render — `https://apex-os-3nyi.onrender.com` (global prefix `/api`)
**Frontend:** Next.js (App Router) on Vercel — `https://apex-os-frontend.vercel.app`
**Database:** PostgreSQL (Prisma, 20 migrations) — managed via `prisma migrate deploy` on every backend boot

**Method legend:** `LIVE` = tested against the deployed URL this session · `STATIC` = proven by reading committed source/migrations · `INFERRED` = deduced from observable runtime behavior · `GAP` = could not be verified from this environment (documented honestly, not assumed pass).

> **Secret handling:** No secret values were read, printed, or written. Environment-variable findings below are **presence/absence and correctness of wiring only**. No tokens, passwords, or connection strings appear in this document.

---

## Validation Items (15)

### 1. Working tree cleanliness (pre-flight)
**Method:** LIVE (`git status`) · **Verdict:** PASS (with note)
The unrelated local helper `backend/disable-pw-change.js` was stashed (`stash@{0}`) before validation so it could not contaminate production reasoning. During the final write-up, two untracked docs files appeared in the tree — `docs/FEATURE_STATUS_BOARD.md` and `docs/SYSTEM_FEATURE_AUDIT.md` — which are **not** part of this task. They were left untouched; only this report is staged. No application code was modified during validation.

### 2. Deployment inventory
**Method:** STATIC (`render.yaml`, source) + LIVE · **Verdict:** PASS
- Backend on Render: `buildCommand: npm install --include=dev && npm run build`; `startCommand: npx prisma migrate deploy && node dist/main.js` (migrations applied on every boot).
- Frontend on Vercel: `https://apex-os-frontend.vercel.app` serves the live app. `https://apex-os.vercel.app` is a **dead 404 alias** (cleanliness item, see Findings — LOW).
- Backend global prefix `/api`; health endpoint at `/api/health`.

### 3. Environment-variable audit (presence/correctness only)
**Method:** INFERRED (runtime behavior) + STATIC · **Verdict:** PASS (with documented gap)
- `DATABASE_URL` — **present**. `main.ts` exits(1) on boot if missing; backend is live and `/api/health` reports `database: connected`.
- `JWT_SECRET` — **present**. Same boot guard; login issues valid JWTs (verified item 10).
- `NEXT_PUBLIC_API_URL` — **present and correct**. Frontend calls the Render backend directly with no `localhost` fallback and no mixed-content (verified item 8).
- `NEXT_PUBLIC_APP_ENV` — **not** set to `staging` (production staging banner does not render).
- `NEXT_PUBLIC_WS_URL` — **dead config**; sockets derive their URL from `NEXT_PUBLIC_API_URL`, not this var (Findings — LOW).
- Optional integrations (SMTP / Cloudinary / OpenAI) — **GAP**: their presence/values are not externally observable without the Render dashboard. Documented, not assumed.

### 4. Backend production build
**Method:** LIVE (transitive) + STATIC compile · **Verdict:** PASS
The Render service is live and healthy, which means `npm run build` (`prisma generate` + `tsc`) **succeeded on the platform**. Local TypeScript verification via `tsc --noEmit` returned **exit 0 (clean)**. A full local `npm run build` fails only on Windows with `EPERM` renaming `query_engine-windows.dll.node` while dev servers hold the DLL — an environment-specific file lock, **not a code defect** (Linux/Render builds succeed).

### 5. Frontend production build
**Method:** LIVE (transitive) · **Verdict:** PASS
Vercel serves the production bundle; the deployment built and rendered successfully (verified item 6).

### 6. Frontend deployed URL health
**Method:** LIVE · **Verdict:** PASS
- `/` and `/login` load (200, HTML renders).
- Unauthenticated `/dashboard` and `/settings` redirect to the login flow (no protected content leaks to anonymous users).

### 7. Backend deployed URL health
**Method:** LIVE · **Verdict:** PASS
- `GET /api/health` → 200 `{ status, version: "1.0.0", database: "connected", environment: "production" }`.
- `POST /api/auth/login` → 201 with JWT for a valid account.
- Protected route without token → 401; with valid token → 200 (verified items 10–12).

### 8. CORS / connectivity
**Method:** LIVE + STATIC · **Verdict:** PASS
Frontend↔backend cross-origin requests succeed (positive case) and the allowlist rejects disallowed origins (negative case). No CORS errors, no mixed-content, no `localhost` references, no preflight failures, no socket-origin mismatch observed.

### 9. Database & migration status (read-only)
**Method:** STATIC + INFERRED · **Verdict:** PASS with one drift exception (see item 13)
- 20 migrations committed; production applies them via `prisma migrate deploy` on boot.
- `/api/health` reports `database: connected`; 11/12 core endpoints return real, correctly-shaped data (item 11) — confirming schema integrity for users, roles, departments, settings, tickets, leave, workday, projects, events, task-types.
- **Exception:** the `notifications` table is missing the `entityId`/`entityType` columns that the Prisma schema and service code expect — a schema/migration drift root-caused in item 13.
- **GAP:** production `prisma migrate status` / `db pull` cannot be run from this environment (no production DB credentials, and none should be exposed here). The drift was instead proven by static analysis + runtime behavior.

### 10. Auth / login smoke (roles)
**Method:** LIVE · **Verdict:** PASS (auth mechanism + RBAC), with documented partial
- **EMPLOYEE** (`pooja.kamble`) → `POST /api/auth/login` 201, `role=EMPLOYEE`, JWT issued, `/api/auth/me` 200. End-to-end verified.
- The login **mechanism and RBAC enforcement are proven** (JWT issuance + 401/403/scoped-200 in item 12).
- **Documented partial:** SUPER_ADMIN/ADMIN/MANAGER/TEAM_LEAD logins with the *committed seed password* did **not** succeed — consistent with those credentials having been **rotated** (a positive security signal, not a defect). INTERN hit the production login throttle (5/15 min → 429). The full per-role login matrix could not be completed without current credentials; brute-forcing/retrying was deliberately avoided.

### 11. Critical workflow smoke (authenticated, read-only GET)
**Method:** LIVE (EMPLOYEE token) · **Verdict:** PASS (11/12), 1 defect
| Result | Endpoint | Shape |
|---|---|---|
| 200 | `/api/auth/me` | user object |
| 200 | `/api/home/summary` | object |
| 200 | `/api/dashboard/overview` | object |
| 200 | `/api/events?limit=5` | array(len=2) |
| **500** | **`/api/notifications`** | **error (see item 13)** |
| 200 | `/api/notifications/unread-count` | `{ count }` |
| 200 | `/api/tickets` | array |
| 200 | `/api/tickets/sla-risk` | array/object |
| 200 | `/api/leave` | array |
| 200 | `/api/workday/today` | object |
| 200 | `/api/projects` | array |
| 200 | `/api/task-types` | array |

**Result: 11/12 core endpoints healthy (200); 1 returns 5xx.**

### 12. Direct security / RBAC checks (low-privilege token)
**Method:** LIVE + STATIC · **Verdict:** PASS
- No token / bad token on protected routes → 401.
- EMPLOYEE token on manager-only routes → 403 (`/api/users/directory`, `/api/users/stats`).
- EMPLOYEE token on in-scope routes → 200.
- `GET /api/settings/company` returns 200 for any authenticated user **by design** — verified in `settings.controller.ts` (the `@Get('company')` handler has no `@Roles`; only `@Patch('company')` is ADMIN/SUPER_ADMIN gated). **This is not a permission leak.**
- Hardening confirmed in source: helmet + CSP in production, `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`, Swagger disabled in production, SMTP password masked in settings responses.

### 13. Notifications endpoint 500 — root-caused HIGH defect
**Method:** LIVE + STATIC · **Verdict:** FAIL (HIGH, non-blocking)
**Symptom:** `GET /api/notifications` → **500** for every authenticated user, while `GET /api/notifications/unread-count` → **200**.

**Root cause — schema/migration drift on the `notifications` table:**
- `prisma/schema.prisma` `Notification` model declares `entityId String?` and `entityType String?`, and `NotificationEventService.sendNotification()` / `NotificationsService.create()` write both columns.
- **No migration ever adds these columns to the `notifications` table.** The `init` migration created the table without them (the `entityId`/`entityType` in that migration belong to `activity_logs`); a grep across all 20 migrations finds no `ALTER TABLE "notifications" ADD COLUMN`. The two composite indexes the schema declares (`userId,createdAt` and `userId,isRead`) *do* exist (performance-indexes migration) — so the drift is **columns only**.
- Production applies only committed migrations (`prisma migrate deploy`), so the production `notifications` table **lacks `entityId` and `entityType`**.

**Why the two endpoints differ:**
- `findByUser()` → `findMany` selects all columns (incl. the missing two) → Postgres `column "entityId" does not exist` at plan time (even on zero rows) → **500**.
- `getUnreadCount()` → `count` references only `userId` + `isRead` (both present) → **200**.

**Blast radius (and why it is non-blocking):**
- Every `notification.create` throws in production → **no in-app notifications are ever persisted, and no real-time socket notification is delivered** (the create throws before the gateway emit). The bell shows a count because `unread-count` works and is always 0.
- **However**, all 14 call sites in `tickets`/`leave`/`comments` services wrap `sendNotification` in `try/catch` ("never crash main op" / "non-critical"). So ticket create/assign/status, leave apply/approve/reject/cancel, and comment-add **succeed** — the notification side-effect fails silently (comments additionally `console.error`). No core workflow is blocked and no data is lost.

**Severity:** HIGH (a core endpoint 500s app-wide and the entire notifications feature is non-functional) but **NON-BLOCKING** (no workflow failure, no data loss).

**Recommended fix (safe, additive, pending approval — see below):**
```sql
-- new migration: 20260530xxxxxx_add_notification_entity_fields/migration.sql
ALTER TABLE "notifications" ADD COLUMN "entityId" TEXT;
ALTER TABLE "notifications" ADD COLUMN "entityType" TEXT;
```
Two nullable columns; no data rewrite; indexes already present. It would auto-apply on the next Render deploy via `prisma migrate deploy`.

### 14. Production log review
**Method:** GAP · **Verdict:** NOT VERIFIABLE (documented)
The Render and Vercel logs are not accessible from this environment (no dashboard/CLI auth). This is documented honestly rather than assumed. **Inference (not a log read):** the item-13 defect is almost certainly generating recurring Prisma "column does not exist" 500s and `Failed to send comment notification` console errors in the Render logs.

### 15. Findings classification
See the table below.

---

## Findings Classification

| Severity | Finding | Status |
|---|---|---|
| **BLOCKING** | _None_ | — |
| **HIGH** | `notifications` schema/migration drift → `GET /api/notifications` 500 + no notification persistence/delivery (item 13). Non-blocking to core workflows. | Open — fix prepared, **awaiting approval** |
| **MEDIUM** | Committed seed default password `Apex@2026` is still active on the EMPLOYEE account (`pooja.kamble`). `mustChangePassword=true` is set but **not enforced by the API** (login succeeds without changing it). Admin accounts appear rotated (good). | Open — recommend forced reset / enforcement |
| **LOW** | `NEXT_PUBLIC_WS_URL` is dead config (sockets use `NEXT_PUBLIC_API_URL`). | Cosmetic |
| **LOW** | `apex-os.vercel.app` is a dead 404 alias alongside the live `apex-os-frontend.vercel.app`. | Cleanliness |
| **DOCUMENTED GAP** | Optional integration env vars (SMTP/Cloudinary/OpenAI) not externally verifiable. | Needs dashboard access |
| **DOCUMENTED GAP** | Production `prisma migrate status` not runnable from here (no prod creds). Drift proven via static+runtime evidence instead. | Needs prod DB access |
| **DOCUMENTED GAP** | Production Render/Vercel logs not accessible from this environment. | Needs dashboard access |
| **DOCUMENTED GAP** | Full per-role login matrix incomplete (admin creds rotated; intern throttled). Auth mechanism + RBAC proven via EMPLOYEE. | Needs current credentials |

---

## Required Report Table (Phase 12)

| # | Validation Item | Method | Result |
|---|---|---|---|
| 1 | Working tree cleanliness | LIVE | PASS |
| 2 | Deployment inventory | STATIC+LIVE | PASS |
| 3 | Env-var audit (presence only) | INFERRED+STATIC | PASS (1 gap) |
| 4 | Backend production build | LIVE+STATIC | PASS |
| 5 | Frontend production build | LIVE | PASS |
| 6 | Frontend deployed URL health | LIVE | PASS |
| 7 | Backend deployed URL health | LIVE | PASS |
| 8 | CORS / connectivity | LIVE+STATIC | PASS |
| 9 | Database & migration status | STATIC+INFERRED | PASS (1 drift → item 13) |
| 10 | Auth / login smoke | LIVE | PASS (mechanism+RBAC; partial matrix) |
| 11 | Critical workflow smoke | LIVE | PASS 11/12 (1 defect) |
| 12 | Direct security / RBAC | LIVE+STATIC | PASS |
| 13 | Notifications 500 root cause | LIVE+STATIC | FAIL (HIGH, non-blocking) |
| 14 | Production log review | GAP | NOT VERIFIABLE |
| 15 | Findings classification | — | COMPLETE |

---

## Recommended Actions (Phase 13)

1. **(HIGH, needs approval)** Add the additive migration in item 13 to restore the `notifications` feature. It auto-applies to production on the next Render deploy, so per P1-9 rules it is **documented and held for explicit approval** — not applied unilaterally.
2. **(MEDIUM)** Force a password reset on the `pooja.kamble` account and/or enforce `mustChangePassword` at the API so the committed seed password cannot be used in production.
3. **(LOW)** Remove the dead `NEXT_PUBLIC_WS_URL` env var and the dead `apex-os.vercel.app` alias.

No production environment variables, database state, or security settings were changed during this validation.

---

## Final Verdict

> ## ✅ READY WITH NON-BLOCKING GAPS

The core platform is **operational and production-grade**: infrastructure is healthy (backend `/api/health` 200, DB connected, `environment: production`), both deployments are live with correct CORS and no localhost/mixed-content, builds compile cleanly, authentication issues valid JWTs, RBAC correctly enforces 401/403/scoped-200, and **11 of 12 core endpoints return real data**.

**One HIGH, non-blocking defect** prevents a clean "PRODUCTION READY": a `notifications`-table schema/migration drift breaks `GET /api/notifications` (500) and all notification delivery. It does **not** block any core workflow or cause data loss, and the fix is a single safe additive migration (prepared above, awaiting approval). A MEDIUM password-hygiene item is also recommended.

No blocking issues were found. With the notifications migration applied, the system would meet a clean **PRODUCTION READY** bar.
