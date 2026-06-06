# FP-11B — RESEND-FIRST EMAIL DELIVERY REPORT
**Date:** 2026-05-30 | Branch: stabilize/apex-os-core @ 8eddef7

---

## SUMMARY

Apex OS now has a functional, provider-agnostic email delivery system. The `EmailService` selects a provider at runtime with a clear priority order. The forgot-password OTP email is fully wired end-to-end. `AuthService` no longer leaks user enumeration via the forgot-password endpoint.

---

## PROVIDER PRIORITY (implemented)

```
1. Resend (env: RESEND_API_KEY + RESEND_FROM_EMAIL)
   ↓ if absent
2. SMTP (DB: AppSetting key 'smtp' — configured via Settings UI)
   ↓ if absent
3. Throw: "Email provider is not configured. Contact your administrator."
   (strict path: sendOtpEmail, sendTestEmail)
   Return false / log
   (soft path: sendEmail, notification helpers)
```

---

## FILES CHANGED

### New dependency
- `resend ^6.12.4` added to `backend/package.json` (`npm install resend`)

### Backend source

| File | Change |
|---|---|
| `backend/src/modules/platform/email/email.service.ts` | Full rewrite — Resend primary + SMTP fallback + strict/soft paths + `sendOtpEmail()` method + `@Optional() ConfigService` |
| `backend/src/modules/platform/email/email.module.ts` | Added `ConfigModule` to imports |
| `backend/src/modules/core/auth/auth.module.ts` | Added `EmailModule` to imports |
| `backend/src/modules/core/auth/auth.service.ts` | Injected `EmailService`; rewrote `sendOtp()` and `resetPasswordWithOtp()` |

### Tests

| File | Change |
|---|---|
| `backend/test/unit/auth.otp.spec.ts` | Added `EmailService` mock; 12 tests covering all cases per spec |

### Documentation

| File | Change |
|---|---|
| `backend/.env.example` | Added `RESEND_API_KEY`, `RESEND_FROM_EMAIL`; clarified SMTP is DB-only |
| `render.yaml` | Added inline deployment notes for all required env vars |

---

## `EmailService` architecture

### New method: `sendOtpEmail(to, otp)` — strict
- Builds branded OTP HTML email with 32px mono code, 10-min expiry note
- Tries Resend first: `resendClient.emails.send(...)` — throws on `error`
- Falls to SMTP: `nodemailer.sendMail(...)` — throws on any failure
- If neither configured: throws `BadRequestException('Email provider is not configured. Contact your administrator.')`
- **Never** passes otp into an exception message

### Modified: `sendEmail(to, subject, html)` — soft (backward-compatible)
- Returns `false` instead of throwing when no provider is configured
- Existing callers (tickets, leave) are unaffected

### Modified: `sendTestEmail(to?)` — strict (existing behavior preserved)
- Tests active provider (Resend first, SMTP fallback)
- `p1d.smtp-settings.spec.ts` continues to pass unchanged

### Provider init
- `ConfigService` is `@Optional()` — `new EmailService(prisma)` in tests still works
- Resend reads `RESEND_API_KEY` / `RESEND_FROM_EMAIL` from `ConfigService?.get()` OR `process.env` fallback
- SMTP reads from DB (unchanged)

---

## `AuthService` changes

### `sendOtp(email)` — before vs after

| Behavior | Before | After |
|---|---|---|
| Unknown email | Throw `NotFoundException('User not found')` — **leaked enumeration** | Return `OTP_GENERIC_RESPONSE` — **no leak** |
| Known email | Store OTP, return message claiming delivery (no email sent) | Attempt email FIRST; if succeeds → store OTP → return generic; if fails → throw (OTP not stored) |
| Email provider unconfigured | No failure (email was never called) | Throws `BadRequestException` — honest failure |
| Response | `{ message: 'OTP sent to <email>' }` — misleading | `{ message: 'If an account exists for that email, a reset code has been sent.' }` |

### `resetPasswordWithOtp(email, otp, newPassword)` — before vs after

| Case | Before | After |
|---|---|---|
| No OTP for email | `'No OTP requested for this email'` | `'Invalid or expired code'` |
| Expired OTP | `'OTP has expired — please request a new one'` | `'Invalid or expired code'` |
| Wrong OTP | `'Invalid OTP'` | `'Invalid or expired code'` |
| Unknown user (post-verify) | `NotFoundException('User not found')` | `BadRequestException('Invalid or expired code')` |

All step-2 errors are now unified — no information leaks about which specific check failed.

---

## OTP SEND SEQUENCE (after fix)

```
AuthService.sendOtp(email)
  ↓
  normalize email
  ↓
  DB lookup (findUserByEmailCI)
  ↓
  if !user → return OTP_GENERIC_RESPONSE (no email, no OTP stored)
  ↓
  generate OTP (Math.random, 6-digit)
  ↓
  emailService.sendOtpEmail(email, otp)
    ├─ Resend configured? → send via Resend API
    ├─ SMTP configured?   → send via nodemailer
    └─ Neither?           → throw BadRequestException (propagates to controller)
  ↓
  (only reached if email succeeded)
  otpStore.set(email, { otp, expires: +10min })
  ↓
  return OTP_GENERIC_RESPONSE
```

---

## TEST RESULTS

| Suite | Tests | Result |
|---|---|---|
| `auth.otp.spec.ts` | 12 | ✅ PASS |
| `p1d.smtp-settings.spec.ts` | 2 | ✅ PASS |
| All unit tests (13 suites) | 90 | ✅ PASS |
| `tsc --noEmit` (backend) | — | ✅ PASS |
| `npm run build` (backend) | — | ✅ PASS |
| Integration tests | 38 failed | ⏭️ Pre-existing DB-dependency failures (no live database) |
