# LIVE AUTH VERIFICATION — ISSUES
**Date:** 2026-06-02 | Branch `main` @ `cac56d3`

Only real, evidence-backed findings. No speculation.

---

## ISSUE #1 — PRODUCTION GIT SHA NOT VISIBLE IN HEALTH ENDPOINT
**Classification:** UNVERIFIED (operational gap)
**Priority:** P3

| Field | Detail |
|---|---|
| Observed | `/api/health` returns `version: "1.0.0"` — a static hardcoded string, not a git SHA or deploy timestamp |
| Expected | Health endpoint includes deployed commit SHA or build timestamp so operators can confirm deployment without dashboard access |
| Evidence | `health JSON: {"status":"ok","version":"1.0.0",...}` — no `gitSha`, no `buildTime`, no `deployedAt` |
| Impact | Cannot confirm exact deployed commit from the API. **Workaround used:** behavioral fingerprinting — FP-13.4A (CUID routes) and FP-11B (forgot-password messages) both verified live, strongly confirming `cac56d3` is deployed. |
| User impact | Operator confidence gap; no blocking to users |
| Safe fix | Add `gitSha: process.env.GIT_SHA \|\| 'unknown'` to health response and set `GIT_SHA` env var in Render build command (`GIT_SHA=$(git rev-parse HEAD)`). Code change, no migration. |
| Fix type | Code + Render env config |

---

## [FIXED] ISSUE #2 — `GET /api/task-types` PUBLICLY ACCESSIBLE WITHOUT AUTH
**Classification:** PARTIAL (intentional design, security concern)
**Priority:** P2

| Field | Detail |
|---|---|
| Observed | `GET /api/task-types` returns **200** with 4 task type records **without any auth token** |
| Expected | All API endpoints (except `/health` and `/auth/*`) should require authentication |
| Evidence | `task-types.controller.ts:16-18` — `@Get()` handler has NO `@UseGuards(JwtAuthGuard)`. Contrast: `@Get('all')` at line 21 IS guarded. |
| Data exposed | Task type names (`"General"`, `"IT Support"`, `"ertryut"`), IDs (CUIDs), `createdAt` timestamps, subtypes |
| PII exposed | **None** — no user data, no secrets, no financial data |
| Severity | Low-Medium. Exposes organizational work classification structure without login. An attacker learns task type names used internally. |
| Intent | Likely intentional — ticket creation form needs to populate the task type dropdown; if this was populated from a protected endpoint, the form might break for some flows. However, the endpoint could be protected and the ticket creation page (which requires login anyway) would still work. |
| User impact | No functional user impact currently. Security posture concern. |
| Safe fix | Add `@UseGuards(JwtAuthGuard)` to the `@Get()` handler on line 16. Verify the ticket creation form still fetches task types correctly after this change (it should, since users must be logged in to reach `/tickets/new`). |
| Fix type | Code (1 line) — no migration |

---

## ISSUE #3 — TASK TYPE "ertryut" IN PRODUCTION DATA (DATA QUALITY)
**Classification:** PARTIAL (data quality)
**Priority:** P3

| Field | Detail |
|---|---|
| Observed | `GET /api/task-types` returns a task type named `"ertryut"` in production |
| Expected | All production task types have meaningful names |
| Evidence | API response: `{"id":"cmpqmmxdz00tz8q83oh1a1anw","name":"ertryut",...,"createdAt":"2026-05-29T07:55:10.343Z"}` |
| Root cause | Likely a test entry created on 2026-05-29 during development/testing via the Settings UI and never deleted |
| User impact | Shows in task type dropdown when creating tickets — employees would see "ertryut" as an option |
| Safe fix | Delete via Settings → Task Types UI (logged-in as SUPER_ADMIN/ADMIN) or `DELETE /api/task-types/cmpqmmxdz00tz8q83oh1a1anw` with auth. No code change needed. |
| Fix type | **Manual admin action** — no code, no migration |

---

## ISSUE #4 — AUTHENTICATED FLOWS UNVERIFIED
**Classification:** UNVERIFIED
**Priority:** P1 (for completeness of pilot readiness)

| Field | Detail |
|---|---|
| Observed | No production credentials were available for this verification pass |
| Expected | Full end-to-end verification: login → dashboard → projects → tickets → workday → leave → notifications |
| Impact | The FP-13 ticket guardrails (CLOSED immutable, DONE no-reassign, ON_BREAK cannot submit) are code-verified and unit-tested but **not exercised in browser** |
| Safe fix | Manual verification pass with known SUPER_ADMIN + EMPLOYEE accounts on `https://apex-os-frontend.vercel.app` |
| Fix type | Manual verification — no code |

---

## ISSUE #5 — HARDCODED PRODUCTION URL IN `main.ts` (COSMETIC)
**Classification:** PARTIAL
**Priority:** P3

| Field | Detail |
|---|---|
| Observed | `backend/src/main.ts` logs `https://apex-os-api.onrender.com` as the base URL |
| Actual live host | `https://apex-os-3nyi.onrender.com` |
| Evidence | `apex-os-api.onrender.com/api/health` → 404; `apex-os-3nyi.onrender.com/api/health` → 200 |
| Impact | Startup log shows wrong URL — operator confusion during debugging. No functional impact. |
| Safe fix | Change to `process.env.RENDER_EXTERNAL_URL \|\| \`https://apex-os-3nyi.onrender.com\`` or just correct the hardcoded string |
| Fix type | Code (1 line), no migration |

---

## NON-ISSUES (clarification)

| Item | Classification | Reason |
|---|---|---|
| `GET /ai/suggest-priority` → 404 | ✅ Not a bug | POST-only endpoint; GET has no handler. Correct behavior. |
| CORS `allow-credentials: true` | ✅ Not a bug | Required for JWT Bearer auth on cross-origin requests |
| RSC prefetch `ERR_ABORTED` in browser | ✅ Not a bug | Normal Next.js App Router prefetch cancellation when navigating away |
| Integration tests fail with 401 | ✅ Not a prod bug | Test env missing seeded `admin@apex.local` user — environmental only |
| FP-13.1C timer-ledger not wired | ✅ Future Scope | Intentionally deferred; service exists and is unit-tested |
