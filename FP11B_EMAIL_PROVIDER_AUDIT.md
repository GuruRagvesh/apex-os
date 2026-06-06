# FP-11B — EMAIL PROVIDER AUDIT
**Date:** 2026-05-30 | Branch: stabilize/apex-os-core @ 8eddef7
**Method:** Read-only inspection — audit phase only.

---

## AUDIT ANSWERS

| # | Question | Answer |
|---|---|---|
| 1 | Is Resend package already installed? | **NO** — `backend/package.json` lists `nodemailer ^8.0.7` but no `resend` package anywhere in dependencies |
| 2 | Does EmailService currently support provider switching? | **NO** — single nodemailer path only (`email.service.ts`) |
| 3 | Does EmailService currently read ENV? | **NO** — constructor is `constructor(private prisma: PrismaService)` — no `ConfigService` injection |
| 4 | Does EmailService currently read SMTP DB settings? | **YES** — `ensureTransporter()` calls `prisma.appSetting.findUnique({ where: { key: 'smtp' } })` |
| 5 | What method should AuthService call to send OTP email? | New `sendOtpEmail(to, otp)` on `EmailService`, or the existing `sendEmail(to, subject, html)` with an OTP-specific template |
| 6 | What happens if email send fails? | Currently: `sendEmail()` returns `false` and logs debug/error — **caller never knows**. FP-11B requirement: honest failure when no provider configured. |
| 7 | What tests must change? | `auth.otp.spec.ts` (needs `EmailService` mock); `p1d.smtp-settings.spec.ts` must continue passing; new `EmailService` provider-switching tests needed |

---

## FILES THAT WILL CHANGE

| File | Change |
|---|---|
| `backend/package.json` | Add `resend` dependency |
| `backend/.env.example` | Add `RESEND_API_KEY`, `RESEND_FROM_EMAIL` |
| `backend/src/modules/platform/email/email.service.ts` | Add Resend primary path + provider selection logic |
| `backend/src/modules/core/auth/auth.module.ts` | Import `EmailModule` |
| `backend/src/modules/core/auth/auth.service.ts` | Inject `EmailService`, send OTP, harden reset errors |
| `backend/test/unit/auth.otp.spec.ts` | Add `EmailService` mock, new tests |
| `render.yaml` | Document `RESEND_API_KEY`, `RESEND_FROM_EMAIL` env vars |

---

## EXISTING SMTP TESTS — IMPACT ASSESSMENT

`p1d.smtp-settings.spec.ts`:
- Tests `EmailService` directly via `new EmailService(prisma)` with no `ConfigService`
- After change, `EmailService` will also accept an optional `ConfigService` for Resend
- Tests construct with 1 arg — must remain valid (ConfigService optional)
- Both tests use mocked SMTP path — must continue to pass

`auth.otp.spec.ts`:
- Tests `AuthService` with mocked `PrismaService`, `JwtService`, `ConfigService`, `EventLoggerService`
- After change, `AuthService` will also need a mocked `EmailService`
- Test for "throws NotFoundException for non-existent user" must change to "returns generic response, no email sent"
- Tests for reset errors must change to "Invalid or expired code" (unified)
