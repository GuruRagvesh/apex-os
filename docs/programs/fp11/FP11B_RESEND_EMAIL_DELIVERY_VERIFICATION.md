# FP-11B — VERIFICATION REPORT
**Date:** 2026-05-30 | Branch: stabilize/apex-os-core @ 8eddef7

---

## AUTOMATED VERIFICATION

| Check | Command | Result |
|---|---|---|
| Backend type-check | `tsc -p backend/tsconfig.json --noEmit` | ✅ **PASS** (exit 0) |
| Backend build | `npm run build` (backend) | ✅ **PASS** (exit 0) |
| `auth.otp` unit tests | `npm test -- --runInBand --testPathPatterns auth.otp` | ✅ **PASS** 12/12 |
| `p1d.smtp-settings` unit tests | `npm test -- --runInBand --testPathPatterns p1d.smtp-settings` | ✅ **PASS** 2/2 |
| All unit tests (13 suites) | `npm test -- --runInBand --testPathPatterns test/unit` | ✅ **PASS** 90/90 |
| Resend package installed | `package.json` grep | ✅ `"resend": "^6.12.4"` |
| Integration tests | Full suite | ⏭️ 38 pre-existing failures (need live DB) — not caused by this change |

---

## TEST DETAIL — auth.otp.spec.ts (12 tests)

```
AuthService — OTP
  ✓ generates OTP and sends email for existing user
  ✓ stores OTP in memory after successful email dispatch
  ✓ returns generic response for unknown user without throwing
  ✓ throws safe error when email provider fails, does not store OTP
  ✓ does not leak OTP in exception message when provider fails
  ✓ accepts correct OTP and resets password
  ✓ returns "Invalid or expired code" for unknown email on reset
  ✓ returns "Invalid or expired code" for wrong OTP
  ✓ returns "Invalid or expired code" for expired OTP
  ✓ rejects new password shorter than 8 characters

AuthService — login
  ✓ throws UnauthorizedException for inactive user
  ✓ throws UnauthorizedException for wrong password
```

---

## BEHAVIORAL VERIFICATION (code-trace)

### Resend path (when `RESEND_API_KEY` set)

| Step | Verified by |
|---|---|
| `initResend()` reads `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | `email.service.ts:56-65` |
| `resendClient.emails.send()` called with branded HTML | `email.service.ts:101-111` |
| `error` from Resend propagates as `BadRequestException` | `email.service.ts:113-115` |
| Success → `logger.log` | `email.service.ts:117` |

### SMTP fallback path (when Resend env absent)

| Step | Verified by |
|---|---|
| `resendClient` is `null` — skips Resend block | `email.service.ts:100` |
| `ensureSmtpTransporter()` reads DB | `email.service.ts:76-100` |
| If SMTP unconfigured → throws honest error | `email.service.ts:122-124` |
| SMTP send failure → throws (not swallowed) | `email.service.ts:126-130` |
| `p1d.smtp-settings.spec.ts` still constructs with `new EmailService(prisma)` | `@Optional() configService?` → `undefined`, no crash |

### OTP not stored on email failure

| Step | Verified by |
|---|---|
| `sendOtpEmail()` called BEFORE `otpStore.set()` | `auth.service.ts` — email call precedes store |
| `sendOtpEmail()` throws on any failure | `email.service.ts` — all paths throw on failure |
| Test: OTP not in store after provider failure | `auth.otp.spec.ts` — `expect(otpStore.has(...)).toBe(false)` |

### Enumeration prevention

| Scenario | Before | After |
|---|---|---|
| Step 1 — unknown email | `404 "User not found"` | `200 OTP_GENERIC_RESPONSE` |
| Step 2 — no OTP requested | `400 "No OTP requested"` | `400 "Invalid or expired code"` |
| Step 2 — expired OTP | `400 "OTP has expired"` | `400 "Invalid or expired code"` |
| Step 2 — wrong OTP | `400 "Invalid OTP"` | `400 "Invalid or expired code"` |

---

## INTERACTIVE E2E — NOT EXECUTED (environment blocked)

The following require a running backend + Resend API key:

- Sending a real OTP email via Resend and receiving it
- Completing the full forgot → OTP → reset → login cycle on a live environment
- Verifying Resend delivery logs and Resend dashboard show the send event

These are blocked by: backend not running locally + no `RESEND_API_KEY` in `.env` + no confirmed email address to receive. Not caused by this change — pre-existing P0 environment dependency.

---

## HOW TO COMPLETE INTERACTIVE VERIFICATION

1. Get a free Resend API key at `https://resend.com`
2. Add to `backend/.env`:
   ```
   RESEND_API_KEY=re_your_real_key
   RESEND_FROM_EMAIL=Apex OS <onboarding@resend.dev>  # Resend test address for initial test
   ```
3. Start backend: `npm run start:dev`
4. Navigate to `/forgot-password`, enter a real email address
5. Check email inbox for the OTP
6. Complete reset flow
7. Confirm old password no longer works, new password works
