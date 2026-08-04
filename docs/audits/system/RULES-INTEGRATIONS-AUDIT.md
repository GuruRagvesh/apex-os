# Rules & Integrations Audit
**Stage 8.6 — Apex OS Stabilization**
*Completed: 2026-05-26*

This document audits every backend integration and business rule so that:
1. Missing or broken integrations fail **safely** (no crash, clear error, graceful degradation).
2. Business rules are **enforced by the backend** — not just hidden in the frontend.
3. Staging and production environments are clearly separated.

---

## Part 1 — Integration Audit

### 1.1 Environment Variables & Startup Validation

**File:** `backend/src/main.ts`

| Variable | Required? | Behaviour when missing |
|----------|-----------|------------------------|
| `DATABASE_URL` | ✅ REQUIRED | `process.exit(1)` — server refuses to start |
| `JWT_SECRET` | ✅ REQUIRED | `process.exit(1)` — server refuses to start |
| `OPENAI_API_KEY` | Optional | Warning logged; AI endpoints return `{ disabled: true, result: "coming soon" }` |
| `SMTP_USER` | Optional | Warning logged; all email sends are silently skipped |
| `CLOUDINARY_CLOUD_NAME` | Optional | Warning logged; file uploads return base64 fallback |
| `JWT_EXPIRES_IN` | Optional | Defaults to `24h` |
| `PORT` | Optional | Defaults to `3001` |
| `FRONTEND_URL` | Optional | Defaults to `http://localhost:3000`; used in CORS and email links |
| `APP_ENV` | Optional | Informational; used for environment-specific logging |

**Status: ✅ SAFE** — Hard failures exit cleanly. Optional integrations degrade gracefully with warnings.

---

### 1.2 SMTP / Email

**File:** `backend/src/modules/platform/email/email.service.ts`

- Transporter is initialized in constructor from `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.
- If any SMTP variable is missing, `this.transporter = null` and a warning is logged: `SMTP not configured — emails will be skipped`.
- Every `send*()` method checks `if (!this.transporter) return;` before sending — no crash, no throw.
- Email send errors are caught and logged without re-throwing — a failed email never blocks the API response.

**Triggers:**
- Ticket assigned → `sendTicketAssigned()`
- Ticket resolved/approved → `sendTicketResolved()`
- Leave approved/rejected → `sendLeaveDecision()`
- Password reset OTP → `sendOtp()` (OTP is stored in memory regardless of email success)
- Daily digest → `ai.cron.service.ts` (scheduled job)

**Status: ✅ SAFE** — Email is best-effort. Core workflows (ticket creation, leave approval) complete successfully even if SMTP is unconfigured.

---

### 1.3 Password Reset OTP

**File:** `backend/src/modules/core/auth/auth.service.ts`

- OTP is a 6-digit number stored in `Map<email, { otp, expires }>` (in-process memory).
- OTP expires in 10 minutes.
- `sendOtp()` throws `NotFoundException` for unknown users (not a generic "sent if exists" message — this is a minor user-enumeration risk but acceptable for internal tooling).
- `resetPasswordWithOtp()` validates: user exists → OTP exists → not expired → OTP matches → new password ≥ 8 chars → bcrypt hash → update DB → delete OTP from map.
- Email with the OTP is sent via `EmailService.send()` (best-effort; OTP is issued regardless).

**Status: ✅ SAFE** — OTP logic is backend-enforced. Password is rehashed server-side.
**Known limitation:** In-memory OTP store resets on server restart. Users mid-flow lose their OTP.

---

### 1.4 File Uploads / Cloudinary

**File:** `backend/src/modules/platform/uploads/uploads.service.ts`

- Initialized with `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
- If any are missing: `this.configured = false`; upload methods log a warning and return a base64 data URL as fallback.
- New uploads use the `apex/tickets/${ticketId}` folder prefix (changed from `nexus/` in Stage 7).
- Existing attachment URLs are **not modified** — CDN links remain valid regardless of prefix change.

**Status: ✅ SAFE** — Uploads degrade to base64 when Cloudinary is unconfigured.

---

### 1.5 WebSocket / Real-time Notifications

**File:** `backend/src/modules/platform/gateway/events.gateway.ts`  
**Frontend:** `frontend/hooks/useSocket.ts`

- Socket.IO adapter set in `main.ts` via `app.useWebSocketAdapter(new IoAdapter(app))`.
- JWT secret used for WebSocket auth is read from `ConfigService` (not hardcoded since Stage 7 fix).
- Frontend `useSocket` connects to `NEXT_PUBLIC_API_URL` (falls back to `http://localhost:3001`).
- If WebSocket connection fails, UI still works — notifications appear on next HTTP poll (every 15 s for count, every 60 s for list).

**Status: ✅ SAFE** — Real-time is a progressive enhancement; HTTP polling is the fallback.

---

### 1.6 Auth / JWT / Session

**File:** `backend/src/modules/core/auth/`

- JWT signed with `JWT_SECRET` (env var); missing → startup crash.
- Tokens expire per `JWT_EXPIRES_IN` (default `24h`).
- No movement-based logout exists — idle/away status does not invalidate the session.
- `JwtAuthGuard` returns `401` for missing/expired/invalid tokens.
- `RolesGuard` returns `403` for insufficient role.
- Frontend stores token as `apex_token` in `localStorage` (migrated from `nexus_token` in Stage 7).
- No HttpOnly cookie session; token is sent as `Authorization: Bearer <token>` header.

**Status: ✅ SAFE**

---

### 1.7 CORS

**File:** `backend/src/main.ts`

Allowed origins:
- `http://localhost:3000`
- `http://localhost:3001`
- `https://apex-os.vercel.app`
- `https://apex-os-frontend.vercel.app`
- `https://apex-os-frontend-git-main-guru-ragvesh-thanumoorthys-projects.vercel.app`
- `process.env.FRONTEND_URL` (dynamic, set per environment)

Credentials: `true`. Methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`.

**Status: ✅ SAFE** — No wildcard origin. `FRONTEND_URL` allows staging-specific origins.

---

### 1.8 Prisma / Database Connection

- `DATABASE_URL` required at startup.
- Prisma client auto-retries transient connection errors.
- Health check endpoint (`GET /api/health`) queries `prisma.$queryRaw('SELECT 1')` and returns `{ database: 'connected' }` or `{ database: 'error' }`.

**Status: ✅ SAFE**

---

### 1.9 OpenAI / AI Features

**File:** `backend/src/modules/ai/ai.service.ts`

- `OPENAI_API_KEY` checked at instantiation.
- If absent: `this.client = null`; every AI method returns a `{ disabled: true }` payload with a "coming soon" message.
- If API call fails: caught in `try/catch`; returns same fallback object — no 500 error propagated.
- AI features covered: priority suggestion, ticket summary, next-action recommendation.
- **Core workflows do NOT depend on AI** — ticket creation, assignment, and approval all work with AI disabled.

**Status: ✅ SAFE** — Full graceful degradation; no core workflow blocked by AI availability.

---

### 1.10 CSV Export

**File:** `backend/src/modules/operations/tickets/tickets.service.ts — exportCsv()`

- Calls `findAll()` with `limit: 10000, page: 1` — role-scoped by the same `applyRoleScope()` used everywhere.
- Each cell is quoted and has internal `"` doubled (`""`), and newlines replaced with spaces.
- Returns `Content-Type: text/csv` with a filename attachment header.

**Status: ✅ SAFE** — Role-scoped; injection-safe quoting; bounded at 10,000 rows.

---

### 1.11 Deployment Environment Separation

**File:** `backend/.env.example`

| Environment | Config guidance |
|-------------|----------------|
| Development | `NODE_ENV=development`, local DB, any JWT secret |
| Staging | Separate `DATABASE_URL` pointing to staging DB; `APP_ENV=staging`; dedicated `FRONTEND_URL` |
| Production | Long random `JWT_SECRET`; real SMTP; real Cloudinary; `NODE_ENV=production` (disables Swagger) |

Swagger docs (`/api/docs`) are only served when `NODE_ENV !== 'production'`, preventing API discovery in production.

**Status: ✅ SAFE** — Environments are separated via env vars; no shared secrets.

---

## Part 2 — Business Rules Audit

### 2.1 Ticket Creation Rules

**Enforced by:** `TicketsService.create()`, `ValidationPipe` (DTO)

| Rule | Enforcement |
|------|-------------|
| Title required | DTO `@IsNotEmpty()` → 400 |
| Status defaults to `OPEN` | Service sets `status: TicketStatus.OPEN` |
| `ticketId` auto-generated (`TKT-NNNN`) | Service generates sequential ID |
| `assignedToId` optional at creation | Nullable field |
| `estimatedMinutes` → `executionDueAt` computed | `calcExecutionDueAt()` called on create |
| Date-only strings normalized to 18:30 IST | `normalizeDateInput()` |

---

### 2.2 Ticket Assignment Rules

| Rule | Enforcement |
|------|-------------|
| Only assignee, creator, or Manager+ can update | `update()` permission check → 403 |
| Assignment triggers email notification | `emailService.sendTicketAssigned()` (best-effort) |
| Assignment triggers in-app notification | `notificationsService.create()` + `gateway.emitNotificationToUser()` |
| Assignment logged to `TicketHistory` | `ticketHistory.createMany()` for tracked fields |

---

### 2.3 Ticket Status Transition Rules

**Enforced by:** `TicketsService.update()` (called via `updateStatus()`)

| Transition | Who can do it |
|------------|---------------|
| Any → IN_PROGRESS | Assignee, creator, Manager+ |
| Any → REVIEW | Assignee, creator, Manager+; **INTERN blocked** unless self-assigned |
| REVIEW → DONE | **Manager+ only** OR self-assigned (createdById === assignedToId) |
| REVIEW → IN_PROGRESS (rework) | Manager+ can reject; reverts timestamps |
| Any → DONE directly (non-REVIEW) | Blocked for non-Manager unless self-assigned |
| Unrelated employee → any status | **403 Forbidden** |

**Timer side-effects on transition:**
- `OPEN → IN_PROGRESS`: stamps `actualStartAt`, computes `executionDueAt`
- `* → REVIEW`: stamps `submittedAt`, `reviewStartedAt`, computes `reviewDueAt` from SLA table
- `REVIEW → IN_PROGRESS (rework)`: clears review stamps, recalculates `executionDueAt`
- `* → DONE/CLOSED`: stamps `actualCompletedAt`, `closedAt`, `resolvedAt`

---

### 2.4 Ticket Approval / Rejection Rules

**Enforced by:** `TicketsService.approve()` and `TicketsService.reject()`

| Rule | Enforcement |
|------|-------------|
| Only REVIEW-status tickets can be approved | `if (ticket.status !== REVIEW) throw ForbiddenException` |
| Only REVIEW-status tickets can be rejected | Same guard |
| Approval moves ticket to DONE | `update({ status: DONE }, suppressCompletionNotification: true)` |
| Rejection moves ticket back to IN_PROGRESS | `update({ status: IN_PROGRESS })` |
| Rejection comment is required | Passed as argument; written as `[REJECTED] <comment>` in comments |
| Notification sent to creator on approve/reject | `notificationsService.create()` + `gateway.emitNotificationToUser()` |

---

### 2.5 SLA and Overdue Rules

**Hardcoded SLA defaults** (overridable via `AppSetting.key='review_sla'`):

| Priority | Execution SLA | Review SLA |
|----------|---------------|------------|
| URGENT | 4 hours | 2 hours |
| HIGH | 8 hours | 4 hours |
| MEDIUM | 24 hours | 24 hours |
| LOW | 72 hours | 48 hours |

**Overdue calculation** (`computeOverdue()`):
- `DONE` / `CLOSED` tickets: never overdue.
- `REVIEW` tickets: compare `now` vs `reviewDueAt`.
- All other statuses: compare `now` vs `executionDueAt` (only if `submittedAt` is null — execution timer stops when submitted for review).
- Overdue display: `"Nm overdue"` / `"Nh Nm overdue"` / `"Nd Nh overdue"` with severity colors (orange / deep-orange / red).

**SLA bar on Kanban cards:** `slaPercent = min(elapsed / slaHours * 100, 100)` — visual only, does not affect status.

---

### 2.6 Leave Approval Hierarchy

**Enforced by:** `LeaveService.approve()` and `LeaveService.reject()`

| Rule | Enforcement |
|------|-------------|
| Self-approval blocked | `if (leave.userId === approverId) throw ForbiddenException` |
| Approver must outrank requester | `if (approver.role.level >= requester.role.level) throw ForbiddenException` (lower level number = higher rank) |
| Only PENDING leave can be approved/rejected | `if (leave.status !== PENDING) throw ForbiddenException('Already processed')` |
| Only owner can cancel | `if (leave.userId !== userId) throw ForbiddenException` |
| Already-approved leave cannot be cancelled | `if (leave.status !== PENDING) throw ForbiddenException` |

---

### 2.7 Leave Quota Rules

No hard quota enforcement exists in the current codebase (no `leaveBalance` table). Leave requests are approved by managers at their discretion. This is a known gap — not a bug, but worth noting for future implementation.

---

### 2.8 Overlapping Leave Rules

No backend check for overlapping leave dates currently exists. A user can submit two leave requests for the same period; both will show as PENDING. Manager must detect overlap manually during review. Known gap, not blocking.

---

### 2.9 Project Rules

| Rule | Enforcement |
|------|-------------|
| Only ADMIN+ can create projects | `RolesGuard` on controller |
| Project progress = `DONE+CLOSED tickets / total linked tickets * 100` | `ProjectsService` — integer 0–100 |
| No linked tickets → progress = 0 | Guard in service: `total > 0 ? Math.round(...) : 0` |
| Member can be added only by project owner or Manager+ | Controller guard |

---

### 2.10 User Create / Edit / Deactivate Rules

| Rule | Enforcement |
|------|-------------|
| Only ADMIN+ can create users | `RolesGuard` |
| Only ADMIN+ can change roles | `RolesGuard` on user update |
| `isActive: false` — user cannot log in | `AuthService.login()` checks `isActive` → 401 `Invalid credentials` |
| Password hashed with bcrypt (10 rounds) on create/reset | `bcrypt.hash()` in service |

---

### 2.11 Role Change Rules

- Changing a user's role requires ADMIN+ (enforced by `RolesGuard`).
- Role change does not invalidate existing JWT tokens — the old role remains valid until token expiry (`JWT_EXPIRES_IN`, default 24h). This is a known limitation of stateless JWT auth.

---

### 2.12 Department Access Rules

- `ManagerDeptAccess` table records which departments a MANAGER can see.
- Ticket and leave queries for MANAGER role always union the `ManagerDeptAccess` entries with the manager's own `departmentId`.
- TEAM_LEAD sees their own department plus their own created/assigned tickets.
- EMPLOYEE / INTERN see only tickets they created or are assigned to.

---

### 2.13 Notification Trigger Rules

Notifications are created via `NotificationsService.create()` for:

| Event | Recipient |
|-------|-----------|
| Ticket assigned | Assignee |
| Ticket resolved/approved | Creator / reporter |
| Ticket rejected | Creator / reporter |
| Leave approved | Leave requester |
| Leave rejected | Leave requester |
| Password OTP | Sent via email (not stored as notification) |

Notifications are scoped: `GET /notifications` always filters by `userId = currentUser.id` — users cannot read other users' notifications.

---

### 2.14 Sensitive Data Visibility Rules

- Payroll / salary data: not present in current schema — no risk.
- User passwords: hashed, never returned in any API response (Prisma `select` never includes `password` field in reads).
- JWT tokens: returned on login only; not stored server-side.
- OTPs: stored in memory only; never returned to any API caller other than the email flow.

---

## Part 3 — Acceptance Check Results

| Check | Status | Notes |
|-------|--------|-------|
| Missing `DATABASE_URL` fails safely | ✅ | `process.exit(1)` on startup |
| Missing `JWT_SECRET` fails safely | ✅ | `process.exit(1)` on startup |
| Missing SMTP silently skips emails | ✅ | `transporter = null` guard |
| Missing OpenAI returns disabled response | ✅ | All AI methods return `{ disabled: true }` |
| Missing Cloudinary returns base64 fallback | ✅ | `this.configured` guard in uploads service |
| No movement-based auth logout | ✅ | Workday status change does not invalidate JWT |
| No core workflow depends on AI availability | ✅ | Ticket/leave/project flows skip AI calls |
| Business rules enforced by backend | ✅ | All transition guards, approval rules, and role checks are server-side |
| Staging does not share production services | ✅ | Separate `DATABASE_URL` + `FRONTEND_URL` per environment per `.env.example` |
| No fake success messages | ✅ | `onSuccess` callbacks only; mutations revert on error |
| Swagger hidden in production | ✅ | Only served when `NODE_ENV !== 'production'` |
| CORS locked to known origins | ✅ | No wildcard; specific origin list + `FRONTEND_URL` |

---

## Part 4 — Known Gaps (not bugs, documented for tracking)

| Gap | Impact | Priority |
|-----|--------|----------|
| In-memory OTP store resets on server restart | User mid-flow must re-request OTP | Low |
| No leave quota enforcement | Manager must manually track quotas | Medium |
| No overlapping leave date check | Possible duplicate submissions | Medium |
| Role change does not invalidate existing JWT | Old role persists until token expiry (≤24h) | Low |
| Ticket trend chart "resolved" is by creation date | Slight inaccuracy in trend visualization | Low |
