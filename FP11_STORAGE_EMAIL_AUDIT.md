# FP-11 — STORAGE + EMAIL REALITY CHECK AUDIT
**Date:** 2026-05-30 | Branch: stabilize/apex-os-core @ 8eddef7
**Method:** Read-only source inspection. No code changed.

---

## CURRENT ENVIRONMENT STATE (confirmed from `backend/.env`)

| Variable | Value in .env | Status |
|---|---|---|
| `DATABASE_URL` | Real Render PostgreSQL URL | ✅ Configured |
| `JWT_SECRET` | `"change-this-to-a-long-random-secret-in-production"` | ⚠️ PLACEHOLDER — security risk |
| `CLOUDINARY_CLOUD_NAME` | `"your-cloud-name"` | ❌ PLACEHOLDER |
| `CLOUDINARY_API_KEY` | `"your-api-key"` | ❌ PLACEHOLDER |
| `CLOUDINARY_API_SECRET` | `"your-api-secret"` | ❌ PLACEHOLDER |
| `SMTP_HOST` | `"smtp.gmail.com"` | ⚠️ Template value (not read by EmailService) |
| `SMTP_USER` | `"your-email@gmail.com"` | ❌ PLACEHOLDER |
| `SMTP_PASS` | `"your-app-password"` | ❌ PLACEHOLDER |
| `OPENAI_API_KEY` | `"sk-..."` | ❌ PLACEHOLDER |

> **Critical note:** The `SMTP_*` env vars in `.env` are **never read** by `EmailService`. The email service reads exclusively from `AppSetting` key `'smtp'` in the database. The env vars are documentation artifacts only.

> **Render.yaml note:** `render.yaml` contains **no `envVars` section**. All production env vars must be set manually via the Render dashboard. None are injected from source control.

---

## A. STORAGE SYSTEM

---

### A1. TICKET ATTACHMENTS

**Architecture:** `TicketsController` → `UploadsService` → Cloudinary (if configured) OR base64 fallback → `Attachment` DB record

#### Endpoints
| Action | Endpoint | Auth | Authorization |
|---|---|---|---|
| Upload | `POST /tickets/:id/attachments` | JWT | `assertCanUploadAttachment` (admin/manager/TL in scope/participant) |
| Download | `GET /tickets/:id/attachments/:attachmentId/download?mode=inline\|download` | JWT | `getAttachmentForDownload` (ticket visibility check) |
| Delete | `DELETE /tickets/:id/attachments/:attachmentId` | JWT | `assertCanUploadAttachment` (same as upload) |

#### Storage provider
File: `backend/src/modules/platform/uploads/uploads.service.ts`

`UploadsService` checks for Cloudinary vars at **constructor time**:
```ts
if (cloudName && apiKey && apiSecret) {
  cloudinary.config(...);
  this.configured = true;
} else {
  console.warn('[UploadsService] Cloudinary not configured — file uploads will be skipped');
}
```
**`this.configured` is `false` right now** (placeholder env vars).

#### What happens when Cloudinary is NOT configured (current state)
```ts
} else {
  // Fallback: store as base64 data URL so the browser can display/download it
  url = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}
return this.prisma.attachment.create({ data: { ticketId, filename, url, size, mimeType, ... } });
```
- Upload does **NOT fail**. It silently falls back to base64.
- A DB `Attachment` record is created with a `data:...;base64,...` URL that can be **hundreds of KB to ~6.7 MB** of text.
- The record contains filename, size, mimeType — **all metadata correct**.
- `readAttachment` handles both `data:` URLs (base64 decode) and `cloudinary:authenticated:` refs — so download works in both modes.

**Questionnaire answers:**

| # | Question | Answer |
|---|---|---|
| 1 | Exact upload endpoint | `POST /tickets/:id/attachments` (multipart, field `file`, max 5 MB) |
| 2 | Exact download endpoint | `GET /tickets/:id/attachments/:attachmentId/download?mode=inline\|download` |
| 3 | Exact delete endpoint | `DELETE /tickets/:id/attachments/:attachmentId` |
| 4 | Storage provider currently | **Base64 in PostgreSQL** (Cloudinary unconfigured) |
| 5 | Does upload fail if Cloudinary missing? | **NO** — silently falls back to base64 data URL |
| 6 | Does upload silently succeed without storing? | **NO** — DB record always created (`prisma.attachment.create` outside the `if configured` block) |
| 7 | Does UI show honest error? | **Irrelevant** — upload succeeds from UI perspective; failure mode is not upload failure but DB bloat |
| 8 | Does attachment record persist correctly? | **YES** — filename, url (base64 or cloudinary ref), size, mimeType, isPoc all saved |
| 9 | Can authorized users download? | **YES** — `readAttachment` handles base64 and cloudinary modes |
| 10 | Can unauthorized users access? | **NO** — download endpoint is JWT-guarded; ticket visibility check enforced |
| 11 | Does deletion remove storage object? | **NO FOR CLOUDINARY** — `deleteAttachment` calls only `prisma.attachment.delete`. No `cloudinary.uploader.destroy()` call. Cloudinary objects will **orphan** when Cloudinary is eventually configured. Base64 deletion is clean (record delete removes the data). |
| 12 | Does deletion remove DB record? | **YES** — `prisma.attachment.delete({ where: { id: attachmentId } })` |
| 13 | Orphan risk? | **YES (future)** — when Cloudinary is configured, deleting an attachment leaves the asset in Cloudinary storage indefinitely |
| 14 | Security risk? | **YES (current)** — base64 fallback puts raw file content inside the `attachments` table. A 5 MB file generates ~6.7 MB of base64 text per row. With repeated uploads this bloats the DB, potentially causing performance degradation or hitting DB storage limits. |

#### Cascading delete
`Attachment` model has `@@relation(onDelete: Cascade)` on `ticketId → Ticket`. Deleting a ticket will delete its DB attachment records. **However, Cloudinary objects will still orphan** when Cloudinary is configured.

---

### A2. PROJECT ATTACHMENTS

**Finding: Project attachments do not exist.**

Evidence:
- `Attachment` model in `schema.prisma:286-299`: field `ticketId String` is required (non-nullable). There is no `projectId` field.
- `UploadsService` only exposes `uploadTicketAttachment`. No project upload method.
- `ProjectsController` and `projects.service.ts`: no attachment endpoints or upload calls.
- `projectsApi` in `frontend/lib/api.ts`: no attachment methods.

**Verdict: Project attachments are F_NOT_PRESENT.** Projects cannot have file attachments. This appears intentional — the data model does not support it.

---

### A3. USER PROFILE IMAGES

**Architecture:** `UsersController` → `UsersService.uploadPhoto` → **always base64 in User.photoUrl column** (no Cloudinary, regardless of configuration)

#### Endpoints
| Action | Endpoint | Auth |
|---|---|---|
| Upload | `POST /users/me/photo` (multipart, field `photo`) | JWT (self only) |
| Remove | `DELETE /users/me/photo` | JWT (self only) |

#### Implementation
```ts
async uploadPhoto(userId: string, file: Express.Multer.File): Promise<{ photoUrl: string }> {
  const photoUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
  await this.prisma.user.update({ where: { id: userId }, data: { photoUrl } });
  return { photoUrl };
}
```
No Cloudinary call. No file size limit at the interceptor level (unlike ticket attachments which have `limits: { fileSize: 5 * 1024 * 1024 }`).

**Questionnaire answers:**

| # | Question | Answer |
|---|---|---|
| 1 | Storage provider | **Base64 in PostgreSQL `User.photoUrl` column** — always, regardless of Cloudinary config |
| 2 | URL persistence | Stored as `data:image/jpeg;base64,...` in the DB; returned in `GET /users/me` response |
| 3 | Broken image handling | `UserAvatar` component: `if (photoUrl)` → `<img src={photoUrl}>`. If null, renders initials. No `onError` handler — a partially corrupted base64 would render as broken image in browser. |
| 4 | Missing file handling | Graceful: `photoUrl: null` → initials avatar rendered |
| 5 | Security concerns | ① **No file size limit** on `POST /users/me/photo` — an authenticated user could upload a very large image and store megabytes in the `users` table row. ② Same DB bloat risk as ticket attachments. |

---

## B. EMAIL SYSTEM

---

### B1. SMTP SERVICE

**File:** `backend/src/modules/platform/email/email.service.ts`

#### Architecture
- Uses **nodemailer** (`npm package: nodemailer`)
- Config source: **DB only** — `prisma.appSetting.findUnique({ where: { key: 'smtp' } })` — the `SMTP_*` env vars are **never read** by this service
- Transporter is **lazy** — initialized on first email call, not at startup
- Fingerprint caching: re-reads DB config if the JSON fingerprint changes (live updates without restart)

#### Startup behavior
`main.ts:72-74`:
```ts
['OPENAI_API_KEY', 'SMTP_USER', 'CLOUDINARY_CLOUD_NAME']
  .filter((k) => !process.env[k])
  .forEach((k) => console.warn(`⚠️  WARN: ${k} not set — related features disabled`));
```
- Startup does **NOT fail** if SMTP is absent — only logs a warning
- `SMTP_USER` placeholder value `"your-email@gmail.com"` would suppress this warning even though SMTP is non-functional; however since `EmailService` reads from DB (not env), this warning is largely informational

#### What happens when SMTP is unconfigured (current state)
```ts
async sendEmail(to, subject, html): Promise<boolean> {
  if (!(await this.ensureTransporter(false)) || !this.transporter) {
    this.logger.debug(`[Email skipped] ${subject} -> ${to}`);
    return false;
  }
  ...
}
```
- Returns `false`, logs at `debug` level — **not visible in default production logging**
- **No exception thrown to caller** — all callers use `try/catch (_e) { /* never crash */ }` anyway
- **UI is never informed** — email failure is invisible to both the admin and the end user

#### Answers

| # | Question | Answer |
|---|---|---|
| 1 | Is SMTP implemented? | **YES** — nodemailer, full HTML templates (`buildHtml`) |
| 2 | Where is transporter initialized? | Lazily inside `ensureTransporter()`, on first `sendEmail()` call |
| 3 | Config source | **DB only** — `AppSetting` key `'smtp'`. Env vars ignored by the service. |
| 4 | What happens if SMTP not configured? | `sendEmail` returns `false`, logs debug. No exception. No user-visible error. |
| 5 | Does startup fail? | **NO** |
| 6 | Does email silently fail? | **YES** — debug log only, callers catch and discard |
| 7 | Does UI know email failed? | **NO** — except on `POST /settings/email/test` which throws `400` on failure |
| 8 | Are logs generated? | Debug-level only (`logger.debug`). Would not appear unless log level is set to `debug`. |

---

### B2. FORGOT PASSWORD / OTP

**File:** `backend/src/modules/core/auth/auth.service.ts:144-181`

| # | Question | Answer |
|---|---|---|
| 1 | Exact endpoint | `POST /auth/forgot-password` body `{ email: string }` |
| 2 | OTP generation method | `Math.floor(100000 + Math.random() * 900000).toString()` — 6-digit numeric, no crypto random |
| 3 | OTP storage location | **In-memory `Map<string, { otp, expires }>`** on the `AuthService` instance — not persisted to DB |
| 4 | OTP expiry | **10 minutes** (`Date.now() + 10 * 60 * 1000`) |
| 5 | Rate limiting | **NONE** — the `@Throttle` decorator is only on `POST /auth/login`. Forgot-password has no rate limiting. |
| 6 | User enumeration protection | **NO** — throws `404 "User not found"` for unknown emails. Frontend now masks this (FP-10 hardening), but the 404 is still network-observable. |
| 7 | Email dependency | **OTP is never sent by email.** `sendOtp` has a `TODO: send via SMTP when configured`. No `EmailService` injection. No email call. |
| 8 | Dev mode behavior | `console.log("[OTP:DEV] Reset requested for: <email> — check email or SMTP logs")` — does NOT log the OTP |
| 9 | Production behavior | **Identical to dev** — OTP generated, stored in memory, never delivered. Feature is non-functional in production until the TODO is implemented. |

**Critical implication:** Even if SMTP is configured via the Settings UI, the forgot-password OTP will **still not be sent** because `AuthService` does not inject or call `EmailService`. These two systems are not connected.

---

### B3. NOTIFICATIONS

#### In-App Notifications
**File:** `notification-event.service.ts`

Architecture:
1. `prisma.notification.create()` — DB record always created first
2. Preference check — if eventKey disabled in user prefs, skip
3. Quiet hours check (default 22:00–08:00 IST)
4. `gateway.emitNotificationToUser(userId, notification)` — Socket.IO push

**In-app notifications are fully operational** when the backend + socket gateway are running. DB persistence is decoupled from socket delivery — notifications persist even if socket push fails.

#### Email Notifications
Three callers of `EmailService`:

| Event | In-App | Email Template | Called from |
|---|---|---|---|
| Ticket assigned | ✅ | `sendTicketAssigned` | `tickets.service.ts:385, 628` |
| Ticket resolved | ✅ | `sendTicketResolved` | `tickets.service.ts:570` |
| Leave approved | ✅ | `sendLeaveDecision('APPROVED')` | `leave.service.ts:179` |
| Leave rejected | ✅ | `sendLeaveDecision('REJECTED')` | `leave.service.ts:230` |
| Ticket blocked | ✅ | **None** — in-app only | `tickets.service.ts` |
| Comment added | — | **None** | — |
| Workday/break events | ✅ | **None** | — |

All email calls are wrapped in `try/catch (_e) { /* never crash main op */ }` — email failure never blocks the primary operation.

**Answers:**

| # | Question | Answer |
|---|---|---|
| 1 | Which events generate notifications? | Ticket: assigned, status changes, resolved, blocked, overdue; Leave: approved, rejected; Team leave apply; all configurable via user prefs |
| 2 | Which events generate email? | Ticket assigned, ticket resolved, leave approved, leave rejected |
| 3 | Are emails actually sent? | **NO — SMTP not configured in DB.** All silently return `false`. |
| 4 | What happens when email fails? | Caught and discarded — `try/catch (_e) {}`. Primary operation completes normally. |
| 5 | Does notification persist? | **YES** — `prisma.notification.create()` happens before any email attempt |

---

### B4. RESEND EVALUATION

| # | Question | Answer |
|---|---|---|
| 1 | Is SMTP causing operational pain? | **Not directly** — SMTP isn't failing, it simply has never been configured. The pain is absence, not breakage. |
| 2 | Would Resend simplify architecture? | **YES** — Resend HTTP API eliminates SMTP server management, port blocking, auth complexity, and TLS configuration. Particularly relevant for Render.com hosting where outbound SMTP on port 25 is often blocked. |
| 3 | Would Resend improve reliability? | **YES** — Resend delivers via a managed API with tracking, retries, and delivery receipts vs nodemailer fire-and-forget. |
| 4 | Migration effort required | **LOW** — `EmailService.sendEmail()` is the single abstraction point. Swapping nodemailer for `resend` npm package requires changing one method (~10 lines). All call sites are unchanged. |
| 5 | Is migration justified right now? | **NOT URGENTLY** — the priority is to configure _something_ functional (SMTP or Resend) first. The architecture supports either. If a fresh SMTP server isn't available, Resend free tier (3,000/month) covers pilot needs with zero SMTP overhead. |

---

## SECURITY FINDINGS

| ID | Finding | Severity |
|---|---|---|
| SEC-1 | `JWT_SECRET="change-this-to-a-long-random-secret-in-production"` — placeholder secret in production `.env` | **CRITICAL** — JWT tokens can be forged if secret is known/guessable |
| SEC-2 | No rate limiting on `POST /auth/forgot-password` — OTP brute-forceable (10-min window, 6 digits = 1,000,000 combinations, no lockout) | **HIGH** |
| SEC-3 | No file size limit on `POST /users/me/photo` — authenticated user can store large blobs in users table | **MEDIUM** |
| SEC-4 | Base64 file storage in DB for attachments — 5 MB file = ~6.7 MB row in `attachments` table | **MEDIUM** (operational risk) |
| SEC-5 | Cloudinary orphan on delete — `deleteAttachment` doesn't call `cloudinary.uploader.destroy()` | **LOW** (cost/storage leak when configured) |
| SEC-6 | User enumeration in OTP flow — `sendOtp` throws 404 for unknown emails | **LOW** (UI-masked, still network-observable) |
