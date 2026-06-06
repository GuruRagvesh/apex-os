# LIVE STABILIZATION — RUNTIME ERRORS
**Date:** 2026-06-02 | Branch `main` @ `cac56d3`

Only **observed** errors/anomalies with evidence. No speculation. Items that could not be observed are listed under "Not Observable" so they are not mistaken for "clean".

---

## OBSERVED — ENVIRONMENTAL (this sandbox, not product defects)

### E1 · `P1001` — DB unreachable from sandbox
- **Where:** `npx prisma migrate status` (backend)
- **Exact:** `Error: P1001: Can't reach database server at dpg-d8259omk1jcs73e37fbg-a.oregon-postgres.render.com:5432`
- **Root cause:** Sandbox network egress to Render Postgres external host is blocked. **Production itself reaches its DB** (`/api/health` → `database: connected`).
- **Impact on audit:** `prisma migrate status` and integration tests cannot run here.
- **Classification:** UNVERIFIED (environmental) — **not** a product bug.

### E2 · Integration tests fail — login `401`
- **Where:** `test/integration/smoke.spec.ts`, `test/integration/p2.dashboard-recovery.spec.ts`
- **Exact:** `POST /api/auth/login {admin@apex.local / Apex@local1}` → `expected 201, got 401 Unauthorized`
- **Root cause:** No seeded test database / `admin@apex.local` user in this environment. The app boots and the login query runs (returns 401), so this is missing test data, not a code fault.
- **Classification:** UNVERIFIED (environmental).

### E3 · Local servers not running
- `http://localhost:3001/api/health` and `http://localhost:3000` → "Unable to connect".
- **Cause:** Neither backend nor frontend started in this environment. Expected.

---

## OBSERVED — PRODUCTION (live, with evidence)

### P-OK1 · Health endpoint healthy
- `GET https://apex-os-3nyi.onrender.com/api/health` → **200**
  `{"status":"ok","timestamp":"2026-06-02T06:29:28.476Z","version":"1.0.0","database":"connected","environment":"production"}`
- **No error.** Confirms prod server up + DB connected.

### P-OK2 · Protected routes correctly guarded
- `/api/projects`, `/api/tickets`, `/api/notifications`, `/api/dashboard/overview` → **401** (exist, auth-guarded). No 404/500.

### P-OK3 · Login DTO validation active
- `POST /api/auth/login` with 5-char password → **400** (`@MinLength(6)` enforced). Endpoint healthy.

### P-ANOMALY1 · Misleading hardcoded prod URL in code (cosmetic)
- `backend/src/main.ts` logs base URL `https://apex-os-api.onrender.com`, but the actual reachable host is `https://apex-os-3nyi.onrender.com`.
- Probing `apex-os-api.onrender.com/api/health` → **404** (different/non-existent service).
- **Impact:** Log/diagnostic confusion only. No functional impact. **P3.**

---

## NOT OBSERVABLE (no access — marked UNVERIFIED, not clean)

| Area | Why not observable |
|---|---|
| Authenticated API responses (projects/tickets/leave/etc. with a valid token) | No production or local credentials |
| Browser console / network / hydration errors | No running frontend |
| Render server logs (4xx/5xx/Prisma/CORS/socket/scheduler/Resend) | No Render dashboard access |
| `prisma migrate status` against prod DB | Sandbox egress blocked (E1) |
| Socket.IO connection behavior | No running client |
| CORS behavior for the real frontend origin | No running frontend / unknown exact Vercel origin |

---

## TIMER LEDGER — NO RUNTIME ERROR (by design)
- `TicketLedgerService` is present, unit-tested, and **not wired** into live ticket/workday flows.
- Therefore it produces **no runtime path** and cannot crash. Build + unit tests green.
- This is **FUTURE (FP-13.1C)**, explicitly not an error.

---

## SUMMARY
- **Product runtime errors observed:** 0 (production core routes healthy; no 5xx/404 on probed endpoints).
- **Environmental blockers (sandbox):** 3 (E1–E3).
- **Cosmetic anomalies:** 1 (P-ANOMALY1, P3).
- **Large UNVERIFIED surface** due to no credentials / no running frontend / no DB reach / no logs — must be closed by manual verification, not assumed clean.
