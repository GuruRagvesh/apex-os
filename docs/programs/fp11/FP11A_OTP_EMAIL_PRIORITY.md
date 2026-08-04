# FP-11A — OTP + EMAIL PRIORITY REGISTER
**Date:** 2026-05-30 | Branch: stabilize/apex-os-core @ 8eddef7
**Rule:** Every item backed by file + line-number evidence. No hypothetical issues.

---

## P0 — CRITICAL (Feature non-functional; must fix before pilot)

---

### P0-1 · OTP never delivered — forgot-password completely non-functional in production

**Classification:** BROKEN

**Evidence (three independent proofs):**
1. `auth.module.ts:9-26` — `AuthModule` imports only `PassportModule` and `JwtModule`. `EmailModule` is absent. NestJS DI means `EmailService` cannot be injected here.
2. `auth.service.ts:14-19` — `AuthService` constructor: `(prisma, jwtService, configService, eventLogger)`. No `EmailService` parameter.
3. `auth.service.ts:151` — `// TODO: send via SMTP when configured` — developer-left marker confirming this was always planned but never implemented.

**Impact:** A user who forgets their password submits their email, sees "If an account exists, a one-time code has been sent", waits for an OTP that will **never arrive**, and cannot reset their password. The feature is UI-complete but non-functional.

**Fix scope (description only — not implementation):**
Two additions required:
1. Add `EmailModule` to `AuthModule.imports` in `auth.module.ts`
2. Inject `EmailService` in `AuthService` constructor and call `emailService.sendEmail()` after `otpStore.set()` in `sendOtp()` — using the existing `buildHtml()` or a simple OTP template

**Dependency:** P1-1 (SMTP must be configured in DB for email to actually send, but the wiring fix should be done regardless so the path is ready)

---

## P1 — HIGH (Must fix before pilot users can self-service passwords)

---

### P1-1 · SMTP not configured in DB — EmailService sends nothing

**Classification:** FUNCTIONAL BUT UNCONFIGURED

**Evidence:**
- `settings.service.ts:19` — default for `'smtp'` key: `{ host: '', port: '587', email: '', password: '' }`
- `email.service.ts:46` — reads `AppSetting` key `'smtp'` from DB
- `email.service.ts:58-63` — blank config → `transporter = null`, logger.warn, all sends skip
- `backend/.env:25-29` — env vars `SMTP_HOST/USER/PASS` are placeholders; **not read by EmailService**

**Impact:** All transactional emails (ticket-assigned, ticket-resolved, leave-approved, leave-rejected) and once P0-1 is fixed, OTP emails — are all silent no-ops. No user receives any email.

**Fix:** SUPER_ADMIN logs into Settings → SMTP tab, enters valid credentials, clicks "Test Email" button (`POST /settings/email/test`). No code change needed.

---

### P1-2 · No rate limiting on `POST /auth/forgot-password`

**Classification:** BROKEN (security gap)

**Evidence:**
- `auth.controller.ts:18` — `@Throttle` present only on `@Post('login')` with `{ limit: 5, ttl: 900000 }` in production
- `auth.controller.ts:49-52` — `@Post('forgot-password')` has **no** `@Throttle` decorator

**Impact:** An attacker can:
- Make unlimited requests to trigger OTP generation for any known email (DoS on OTP state)
- Once P0-1 is fixed, spam OTP emails to a victim
- Attempt all 900,000 possible 6-digit OTPs within the 10-minute window with no lockout

**Fix scope:** Add `@Throttle({ default: { limit: 5, ttl: 900000 } })` to both `POST /auth/forgot-password` and `POST /auth/reset-password`. Matches login rate limit.

---

### P1-3 · No input validation DTO on forgot-password endpoint

**Classification:** BROKEN (security gap)

**Evidence:**
- `auth.controller.ts:50` — `@Body() body: { email: string }` — raw TypeScript type, no class-validator
- `login.dto.ts:6-7` — `LoginDto` uses `@IsEmail()` and `@IsString()` — correct pattern not applied here
- Any string (empty, malformed, injection attempt) passes to `sendOtp()`

**Impact:** Non-email strings reach `findUserByEmailCI()`, which uses a Prisma `contains` insensitive query. While unlikely to cause SQL injection (Prisma parameterizes), it pollutes OTP store with invalid keys and bypasses email-format intent.

**Fix scope:** Create a `ForgotPasswordDto` with `@IsEmail()` and apply it via `@Body()`. Same pattern as `LoginDto`.

---

## P2 — MEDIUM (Fix before full rollout)

---

### P2-1 · `sendOtp` response message claims delivery when no delivery occurs

**Classification:** FUNCTIONAL BUT UNCONFIGURED (misleading behavior)

**Evidence:**
- `auth.service.ts:156` — `return { message: 'OTP sent to ${normalizedEmail}' }`
- Frontend step 2 text: `"Enter the OTP sent to <email>"` — reinforces the false claim

**Impact:** After P0-1 is fixed and SMTP is configured, the message becomes truthful. Until then, it creates user confusion ("I never received it"). This is a UX trust issue in the interim.

**Fix scope:** Change response to a neutral `{ message: 'If an account exists, a reset code was generated.' }` — matches the frontend generic message.

---

### P2-2 · OTP uses Math.random() — not cryptographically secure

**Classification:** FUNCTIONAL BUT UNCONFIGURED (security improvement)

**Evidence:**
- `auth.service.ts:149` — `Math.floor(100000 + Math.random() * 900000).toString()`
- Node.js `Math.random()` is a pseudorandom number generator (V8 xorshift128+), not a CSPRNG

**Impact:** Theoretical predictability. In practice, 6-digit space (900,000 values) with 10-minute expiry is low risk, but `crypto.randomInt` is a one-line change and is the correct practice.

**Fix scope:** Replace with `require('crypto').randomInt(100000, 1000000).toString()` (Node built-in, no new dependency).

---

### P2-3 · Step-2 error messages leak OTP request existence

**Classification:** FUNCTIONAL BUT UNCONFIGURED (minor security gap)

**Evidence:**
- `auth.service.ts:166` — `'No OTP requested for this email'` — reveals no request was made
- `auth.service.ts:171` — `'Invalid OTP'` — reveals a request WAS made

**Impact:** An attacker can probe which emails have active OTP requests. Lower severity than step-1 enumeration (already mitigated); mainly relevant for privacy.

**Fix scope:** Unify to a single `'Invalid or expired code'` for both cases.

---

### P2-4 · OTP stored in plain text in memory

**Classification:** FUNCTIONAL (acceptable for now, improve before scale)

**Evidence:**
- `auth.service.ts:150` — `otpStore.set(normalizedEmail, { otp, expires })` — `otp` is the raw `'123456'` string

**Impact:** If process memory were dumped, active OTPs would be visible. This is a theoretical risk at current single-instance scale.

**Fix scope:** Hash the OTP before storage (`bcrypt.hash(otp, 8)`), compare with `bcrypt.compare()` at reset. Low urgency.

---

### P2-5 · No OTP email HTML template exists

**Classification:** FUNCTIONAL BUT UNCONFIGURED

**Evidence:**
- `email.service.ts` — templates: `sendTicketAssigned`, `sendTicketResolved`, `sendLeaveDecision` — no OTP template
- Once P0-1 is wired, the call will need to use `buildHtml()` inline or a new dedicated method

**Impact:** When the wiring fix is made (P0-1), a specific OTP email template will need to be written. Not a blocker but must be planned alongside P0-1.

---

## P3 — LOW / FUTURE

---

### P3-1 · OTP lost on backend restart

**Classification:** FUNCTIONAL BUT UNCONFIGURED

**Evidence:**
- `auth.service.ts:11-12` — `private otpStore = new Map<...>()`
- In-memory instance variable — not persisted

**Impact:** Backend deploy/restart (Render zero-downtime deploys still cause brief restart) invalidates all pending OTPs. User must re-request.

**Fix scope:** Persist OTP to a `PasswordResetToken` DB model or Redis. Only relevant when OTP delivery (P0-1) is working.

---

### P3-2 · No background cleanup for expired OTP entries

**Classification:** FUNCTIONAL (very minor)

**Evidence:**
- `auth.service.ts:167-169` — entries deleted only on verify attempt. No `setInterval` cleanup.

**Impact:** Expired OTP entries accumulate in the in-memory Map until the same email is retried. With low user volume, this is negligible.

**Fix scope:** Add a `setInterval` cleanup every 10 minutes — trivial, very low priority.

---

### P3-3 · Dev console log says "check SMTP logs" but no SMTP logs exist for this flow

**Classification:** MISLEADING (developer experience)

**Evidence:**
- `auth.service.ts:154` — `console.log('[OTP:DEV] Reset requested for: <email> — check email or SMTP logs')`
- No SMTP is called in `sendOtp()`, so there are no "SMTP logs" to check

**Impact:** Confusing for developers debugging the flow locally — they may search SMTP logs that do not exist.

**Fix scope:** Once P0-1 is implemented, update the dev log to something accurate like `'[OTP:DEV] OTP generated and email send attempted for: <email>'`.

---

## SUMMARY

| ID | Finding | Priority | Status |
|---|---|---|---|
| P0-1 | OTP never emailed — AuthService not wired to EmailService | **P0** | BROKEN |
| P1-1 | SMTP not configured in DB — all email silent no-ops | **P1** | UNCONFIGURED |
| P1-2 | No rate limiting on forgot-password endpoint | **P1** | BROKEN (security) |
| P1-3 | No input validation DTO on forgot-password | **P1** | BROKEN (security) |
| P2-1 | Response message claims delivery when no delivery | **P2** | MISLEADING |
| P2-2 | Math.random() instead of crypto.randomInt | **P2** | SECURITY IMPROVEMENT |
| P2-3 | Step-2 errors leak OTP request existence | **P2** | MINOR SECURITY GAP |
| P2-4 | OTP plain text in memory | **P2** | LOW RISK |
| P2-5 | No OTP email HTML template | **P2** | MUST BUILD WITH P0-1 |
| P3-1 | OTP lost on restart (in-memory) | **P3** | FUTURE |
| P3-2 | No background OTP entry cleanup | **P3** | VERY MINOR |
| P3-3 | Dev log references non-existent SMTP logs | **P3** | COSMETIC |

**Minimum to make forgot-password functional:** P0-1 + P1-1 + P1-2 (wire email, configure SMTP, add rate limit)
