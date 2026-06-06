# FP-11 — STORAGE + EMAIL FEATURE MATRIX
**Date:** 2026-05-30 | Branch: stabilize/apex-os-core @ 8eddef7

| Feature | Backend | Frontend | Storage / Email | Verified | Risk |
|---|---|---|---|---|---|
| **STORAGE** | | | | | |
| Ticket attachment upload | ✅ `POST /tickets/:id/attachments` — multer, 5 MB limit, MIME filter | ✅ Drag-drop UI in ticket detail | ⚠️ Base64 in DB (Cloudinary unconfigured) | ✅ Code verified | ⚠️ DB bloat — up to 6.7 MB per file row |
| Ticket attachment download | ✅ `GET /tickets/:id/attachments/:id/download` — serves base64 or Cloudinary | ✅ View/Download buttons in AttachmentCard | ⚠️ Base64 served via backend buffer | ✅ Code verified | None at current scale |
| Ticket attachment delete | ✅ `DELETE /tickets/:id/attachments/:id` — removes DB record | ✅ Delete button in AttachmentCard | ⚠️ Cloudinary object NOT deleted | ✅ Code verified | ⚠️ Orphan risk when Cloudinary configured |
| Ticket attachment auth | ✅ JWT guard + `assertCanUploadAttachment` | ✅ Bearer token via central api client | — | ✅ Code verified | None |
| Ticket attachment authorization | ✅ `assertCanUploadAttachment`: admin/manager/TL-in-scope/participant | ✅ Upload restricted to ticket participants | — | ✅ Code verified | None |
| Project attachments | ❌ No endpoint | ❌ No UI | ❌ Not implemented | ✅ Code verified (absent) | None — not a designed feature |
| User profile photo upload | ✅ `POST /users/me/photo` — no size limit | ✅ Photo upload in settings page | ❌ Always base64 in User row (no Cloudinary) | ✅ Code verified | ⚠️ No size limit; DB bloat risk |
| User profile photo remove | ✅ `DELETE /users/me/photo` — sets photoUrl null | ✅ Remove button in settings | ✅ Clean (nulls DB field) | ✅ Code verified | None |
| User profile photo display | ✅ photoUrl returned in `/users/me` | ✅ UserAvatar: img if photoUrl, else initials | ⚠️ Base64 data URL in img src | ✅ Code verified | Minor: no `onError` fallback |
| User document upload | ✅ `POST /users/:id/documents` | ✅ Frontend API method | ⚠️ Uses same UploadsService / base64 | UNVERIFIED (code path not fully traced) | Same as ticket attachments |
| **EMAIL** | | | | | |
| SMTP configuration | ✅ `GET/PATCH /settings/smtp` (SuperAdmin only) | ✅ SMTP section in settings page | ⚠️ Reads/writes `AppSetting` key `smtp` | ✅ Code verified | None |
| SMTP test send | ✅ `POST /settings/email/test` — throws 400 if unconfigured | ✅ Test button in settings | ❌ No SMTP in DB — would throw 400 | ✅ Code verified | None |
| Email: ticket assigned | ✅ `sendTicketAssigned()` called in `tickets.service.ts` | — | ❌ Silent no-op (SMTP unconfigured) | ✅ Code verified | None (graceful degradation) |
| Email: ticket resolved | ✅ `sendTicketResolved()` called in `tickets.service.ts` | — | ❌ Silent no-op | ✅ Code verified | None |
| Email: leave approved | ✅ `sendLeaveDecision('APPROVED')` in `leave.service.ts` | — | ❌ Silent no-op | ✅ Code verified | None |
| Email: leave rejected | ✅ `sendLeaveDecision('REJECTED')` in `leave.service.ts` | — | ❌ Silent no-op | ✅ Code verified | None |
| Email: ticket blocked | ❌ No email template — in-app notification only | — | — | ✅ Code verified (absent) | None (in-app works) |
| Email: OTP (forgot password) | ❌ OTP generated but **never sent via email** — `TODO` comment | ✅ Forgot-password page complete | ❌ Email delivery broken by design | ✅ Code verified | 🔴 OTP unreachable in production |
| In-app notifications | ✅ `prisma.notification.create()` + Socket.IO push | ✅ Notification bell, unread count, mark-read | ✅ DB-persisted, socket delivered | ✅ Code verified | None |
| Notification preferences | ✅ Per-user prefs with fallback defaults | ✅ Preferences settable | ✅ DB-persisted | ✅ Code verified | None |
| Quiet hours | ✅ 22:00–08:00 IST default | — | ✅ Logic verified (timezone-aware) | ✅ Code verified | None |
| **SECURITY / ENV** | | | | | |
| JWT_SECRET | ✅ Required; exits on missing | — | ⚠️ Placeholder value in .env | ✅ Confirmed from .env | 🔴 Tokens forgeable |
| Cloudinary env vars | ✅ Graceful fallback if absent | — | ❌ All placeholder values | ✅ Confirmed from .env | ⚠️ DB bloat (base64 active) |
| SMTP env vars | — (not read by EmailService) | — | ❌ Placeholder values; irrelevant | ✅ Confirmed | None (DB is source) |
| OTP rate limiting | ❌ No `@Throttle` on forgot-password | — | — | ✅ Confirmed from controller | ⚠️ Brute-force risk |
| render.yaml env vars | ❌ No `envVars` section | — | ❌ Manual Render dashboard setup required | ✅ Confirmed from file | ⚠️ Easy to miss on redeploy |
