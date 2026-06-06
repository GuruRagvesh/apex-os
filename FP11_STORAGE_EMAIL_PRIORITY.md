# FP-11 — STORAGE + EMAIL PRIORITY REGISTER
**Date:** 2026-05-30 | Branch: stabilize/apex-os-core @ 8eddef7
**Rule:** Every item backed by code evidence. No hypothetical issues.

---

## P0 — CRITICAL (Must resolve before any production traffic)

---

### P0-1 · JWT_SECRET is a placeholder
**Evidence:** `backend/.env:5` → `JWT_SECRET="change-this-to-a-long-random-secret-in-production"`
**Impact:** Any attacker who knows this value (it is the widely-known example string from documentation) can forge valid JWT tokens and impersonate any user including SUPER_ADMIN.
**Fix:** Replace with a cryptographically random 64-character string. Set as a secret env var in Render dashboard — not in source-controlled `.env`.
**Do not:** Commit the real secret to git.

---

### P0-2 · OTP never delivered — forgot-password feature non-functional in production
**Evidence:** `auth.service.ts:151` → `// TODO: send via SMTP when configured — email.service.ts is wired but optional`. `AuthService` has no `EmailService` injection.
**Impact:** A user who forgets their password on production has **no way to receive the reset code**. The feature is code-complete on the frontend and has a working backend workflow — but the delivery channel (email) is missing.
**Fix (two-step):**
1. Inject `EmailService` into `AuthService`.
2. Call `emailService.sendEmail(normalizedEmail, 'Your Apex OS reset code', htmlOtpTemplate)` after generating the OTP.
**Also requires:** SMTP must be configured in DB settings (see P1-1) for the email to actually send.
**Blocked by:** P1-1 (SMTP config) and P1-2 (OTP rate limiting, should be added concurrently).

---

## P1 — HIGH (Must resolve before pilot users)

---

### P1-1 · SMTP not configured — all email notifications silently dropped
**Evidence:** `backend/.env:25-29` all placeholder values. `EmailService.ensureTransporter()` reads from `AppSetting` key `'smtp'` in DB — currently null/unset on a fresh install. `sendEmail()` returns `false` and logs at debug level only.
**Impact:** Ticket-assigned, ticket-resolved, leave-approved, leave-rejected emails are all silently skipped. Users receive no email for any event.
**Fix:** Admin must log in, go to Settings → SMTP, and save valid credentials. Then click "Test Email" to verify. The service will auto-reload on next email send (fingerprint caching).
**Options:** Gmail App Password, company SMTP server, or Resend HTTP API (see P3-1).
**Note:** `SMTP_*` env vars in `.env` are NOT read by `EmailService` — setting them in `.env` or Render dashboard has no effect on email delivery.

---

### P1-2 · No rate limiting on `POST /auth/forgot-password`
**Evidence:** `auth.controller.ts` — `@Throttle` decorator present only on `@Post('login')`. Forgot-password endpoint has no throttle.
**Impact:** An attacker can make unlimited OTP requests for any email, and attempt up to 1,000,000 combinations in a 10-minute window (6-digit numeric OTP, Math.random). Effectively allows automated password reset for any known email.
**Fix:** Add `@Throttle({ default: { limit: 5, ttl: 900000 } })` to `POST /auth/forgot-password` and `POST /auth/reset-password`. Matches the production login rate limit.

---

### P1-3 · Cloudinary not configured — all ticket attachments stored as base64 in PostgreSQL
**Evidence:** `backend/.env:32-34` all placeholder values. `UploadsService` constructor: `this.configured = false`. `uploadTicketAttachment`: `url = 'data:${file.mimetype};base64,${file.buffer.toString('base64')}'`.
**Impact:** Every uploaded attachment (max 5 MB) is stored as a base64-encoded string inside the `attachments` table. A 5 MB file produces ~6.7 MB of text in a single row. With multiple users uploading multiple files, this will measurably inflate DB storage and query performance.
**Fix:** Add real Cloudinary credentials to Render dashboard env vars: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. No code change needed — `UploadsService` auto-detects at startup.
**Note:** Existing base64 attachments will remain in DB. They remain functional (download works). A cleanup migration is optional.

---

### P1-4 · No file size limit on `POST /users/me/photo`
**Evidence:** `users.controller.ts:39-46` — `@UseInterceptors(FileInterceptor('photo'))` with no `limits` option. Compare to ticket attachments: `FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } })`.
**Impact:** An authenticated user can upload a large image (e.g. 50 MB raw photo) and store it as base64 in the `users` table row, impacting all queries that select user records (the photoUrl field is returned by default).
**Fix:** Add `FileInterceptor('photo', { limits: { fileSize: 2 * 1024 * 1024 } })` to `uploadPhoto` — 2 MB is sufficient for a profile photo.

---

## P2 — MEDIUM (Fix before full rollout)

---

### P2-1 · Cloudinary objects orphaned on attachment delete
**Evidence:** `uploads.service.ts:62-64` → `async deleteAttachment(attachmentId) { return this.prisma.attachment.delete(...) }`. No `cloudinary.uploader.destroy()` call anywhere in the file.
**Impact:** When Cloudinary is eventually configured, deleting an attachment removes the DB record but leaves the file in Cloudinary indefinitely. Storage cost accumulates silently.
**Fix:** Detect if URL starts with `cloudinary:authenticated:`, extract the `publicId`, call `cloudinary.uploader.destroy(publicId, { resource_type })` before the DB delete.
**Priority:** P2 (not P1) because Cloudinary is currently unconfigured — no orphans exist yet. Should be fixed before enabling Cloudinary.

---

### P2-2 · SMTP env vars in .env are not read by EmailService — misleading
**Evidence:** `email.service.ts:46` reads `AppSetting` key `'smtp'` from DB. No `ConfigService` injection in EmailService. `SMTP_HOST/USER/PASS/PORT` in `.env` are never consumed.
**Impact:** Any developer or deployment engineer setting `SMTP_*` env vars in `.env` or the Render dashboard will believe email is configured when it is not. This creates a false-confidence failure mode.
**Fix options:** (A) Add `ConfigService` to `EmailService` as a bootstrap fallback — read env vars as initial SMTP config if no DB setting exists. (B) Document clearly in README that SMTP must be configured via the Settings UI. (B) is zero-code but relies on documentation being read.

---

### P2-3 · render.yaml has no envVars section — deployment env vars undocumented as infrastructure
**Evidence:** `render.yaml` (full file):
```yaml
services:
  - type: web
    name: apex-os-backend
    runtime: node
    rootDir: backend
    buildCommand: npm install --include=dev && npm run build
    startCommand: npx prisma migrate deploy && node dist/main.js
```
No `envVars` block.
**Impact:** On a fresh Render deployment, only `DATABASE_URL` and `JWT_SECRET` (required at startup) will cause visible failures. `CLOUDINARY_*`, `SMTP_*`, and `OPENAI_API_KEY` are silently absent — their features degrade without any deployment-time warning.
**Fix:** Add `envVars` entries to `render.yaml` (as `sync: false` for secrets) so the Render UI prompts for them on service creation. This is documentation as infrastructure.

---

### P2-4 · UserAvatar has no `onError` fallback for broken profile photos
**Evidence:** `components/ui/user-avatar.tsx:15-19` — `if (photoUrl) return <img src={photoUrl} ...>`. No `onError` handler.
**Impact:** If a photoUrl is corrupted (e.g. truncated base64) the browser renders a broken image icon instead of falling back to the initials avatar.
**Fix:** Add `onError={(e) => { (e.target as HTMLImageElement).style.display='none'; }}` or manage `imgError` state to fall back to initials.

---

### P2-5 · OTP uses Math.random() — not cryptographically secure
**Evidence:** `auth.service.ts:149` → `Math.floor(100000 + Math.random() * 900000).toString()`
**Impact:** `Math.random()` is pseudorandom and potentially predictable in theory. For a 6-digit OTP this is low practical risk, but security best practice is `crypto.randomInt(100000, 1000000).toString()` (Node built-in, no dependency).
**Fix:** Replace with `require('crypto').randomInt(100000, 1000000).toString()`.

---

## P3 — LOW / FUTURE

---

### P3-1 · Resend as SMTP alternative
**Evidence:** Not currently a dependency. Architecture supports a clean swap.
**Assessment:** Resend HTTP API would eliminate port-blocking issues common on Render, provide delivery tracking, and simplify configuration to a single API key. Migration cost is ~10 lines in `email.service.ts`. Justified if SMTP setup proves difficult for the team.
**Recommendation:** Attempt SMTP first (free, no new dependency). If delivery issues arise on Render, migrate to Resend.
**Action:** No code change needed now.

---

### P3-2 · In-memory OTP store lost on backend restart
**Evidence:** `auth.service.ts:11` → `private otpStore = new Map<string, { otp, expires }>()`
**Impact:** If the backend restarts (Render deploy, crash recovery) while a user has requested an OTP, their OTP is lost. They must request again.
**Fix:** Move OTP storage to DB (new `PasswordResetToken` model) or a Redis cache. Low urgency at single-instance pilot scale.

---

### P3-3 · Profile photos bypass Cloudinary — always base64
**Evidence:** `users.service.ts:109-118` — no `UploadsService` call, always base64.
**Assessment:** Unlike ticket attachments which have a Cloudinary path, profile photos have **no Cloudinary code path at all**. When Cloudinary is configured, photos will still be base64.
**Fix:** Route `uploadPhoto` through `UploadsService` with a new `uploadProfilePhoto(userId, file)` method. Requires adding `userId` folder to Cloudinary and handling existing base64 users.
**Priority:** P3 — functional at current scale. Becomes P2 if user base grows significantly.

---

## SUMMARY TABLE

| ID | Finding | Priority | Blocked by | Fix complexity |
|---|---|---|---|---|
| P0-1 | JWT_SECRET placeholder | **P0** | — | Trivial (set env var) |
| P0-2 | OTP never emailed | **P0** | P1-1 | Small (inject EmailService, add call) |
| P1-1 | SMTP not configured | **P1** | — | Admin action (Settings UI) |
| P1-2 | No rate limit on forgot-password | **P1** | — | Trivial (1 decorator) |
| P1-3 | Cloudinary not configured → DB bloat | **P1** | — | Admin action (set env vars) |
| P1-4 | No upload size limit on profile photo | **P1** | — | Trivial (1 interceptor option) |
| P2-1 | Cloudinary orphans on delete | **P2** | P1-3 | Small (~10 lines) |
| P2-2 | SMTP env vars not read — misleading | **P2** | — | Small or doc-only |
| P2-3 | render.yaml missing envVars | **P2** | — | Config-only |
| P2-4 | UserAvatar no onError fallback | **P2** | — | Trivial |
| P2-5 | Math.random() for OTP | **P2** | — | 1 line |
| P3-1 | Resend evaluation | **P3** | — | Medium (if pursued) |
| P3-2 | In-memory OTP store | **P3** | — | Medium |
| P3-3 | Profile photos bypass Cloudinary | **P3** | — | Medium |
