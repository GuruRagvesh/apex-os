# FP-11B — REMAINING GAPS
**Date:** 2026-05-30 | Branch: stabilize/apex-os-core @ 8eddef7

Gaps are categorized per the FP-11B brief.

---

## 1. RESEND DOMAIN NOT VERIFIED

**Gap:** `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are not yet set in `.env` or Render.
**Impact:** Email delivery is not live. OTP emails are not sent in production until credentials are added.
**Not a code gap** — the code is correct. This is an operational step.

**To resolve:**
1. Sign up at `https://resend.com` (free tier: 3,000 emails/month, 100/day)
2. Verify a sending domain (e.g. `technoedge.in` or any domain you control)
3. Copy the API key (`re_...`)
4. Set in Render dashboard → Environment:
   - `RESEND_API_KEY = re_your_real_key`
   - `RESEND_FROM_EMAIL = Apex OS <noreply@your-verified-domain.com>`
5. If domain is not yet verified, use Resend's test address temporarily:
   - `RESEND_FROM_EMAIL = Apex OS <onboarding@resend.dev>` — works without domain verification for initial testing

---

## 2. PRODUCTION ENV NOT CONFIGURED

**Gap:** `backend/.env` still has:
- `JWT_SECRET="change-this-to-a-long-random-secret-in-production"` — placeholder (P0 security risk)
- `RESEND_API_KEY="re_..."` — placeholder
- `CLOUDINARY_*` — all placeholders
- `OPENAI_API_KEY="sk-..."` — placeholder

**Impact:** Backend can start (JWT_SECRET is set to something) but tokens are forgeable, email does not send, file uploads fall back to base64.

**To resolve:** Set real values in Render dashboard — do NOT put real secrets in the `.env` file that is committed to git. Confirm `.gitignore` includes `.env`.

---

## 3. SMTP FALLBACK NOT TESTED END-TO-END

**Gap:** The SMTP path in `sendOtpEmail()` is code-complete but was not exercised against a real SMTP server (no server running locally).
**Impact:** Low risk — the logic is the same as the existing `sendEmail()` SMTP path which has been in production. The `sendOtpEmail` SMTP branch is a straightforward `transporter.sendMail()` call.
**To test:** Configure SMTP via Settings UI, ensure `RESEND_API_KEY` is absent, trigger forgot-password flow.

---

## 4. IN-MEMORY OTP STORAGE

**Gap:** OTPs are stored in `AuthService.otpStore` (a `Map`). They are lost on any backend restart or deploy.
**Impact:** A user mid-flow (between requesting OTP and submitting it) will get an "Invalid or expired code" error if the backend restarts in that 10-minute window. In practice this is rare at single-instance scale on Render.
**Not fixed in FP-11B** — this is a known P3 architectural debt. Fix: persist OTPs to a `PasswordResetToken` DB table or Redis. Tracked in FP11A_OTP_EMAIL_PRIORITY.md as P3-1.

---

## 5. EMAIL NOTIFICATION TEMPLATES (unrelated to this task)

**Gap:** Existing email notifications (ticket-assigned, leave-approved, etc.) use `sendEmail()` which returns `false` silently when no provider is configured. With Resend now available, these notifications will start sending once `RESEND_API_KEY` is set — but no `sendOtpEmail`-style strict path was added for them.
**Impact:** Acceptable — notification email is best-effort. A missed ticket-assignment email is recoverable via in-app notifications. Silent degradation is intentional for these paths.
**Not in scope for FP-11B** — only the OTP path required strict delivery guarantees.

---

## 6. ATTACHMENT / STORAGE (unrelated to this task)

**Gap:** Cloudinary is not configured. All file uploads fall back to base64 in PostgreSQL. This is unchanged from FP-11 findings.
**Not touched in FP-11B** as specified. Tracked in FP11_STORAGE_EMAIL_PRIORITY.md as P1-3.

---

## SUMMARY TABLE

| Gap | Severity | Code change needed? | Action |
|---|---|---|---|
| Resend domain not verified | P1 (operational) | ❌ No | Set Render env vars |
| Production env not configured (JWT_SECRET) | P0 (security) | ❌ No | Set Render env vars |
| SMTP fallback not live-tested | P2 | ❌ No | Manual test when SMTP configured |
| In-memory OTP storage | P3 | ✅ Yes (future) | Add PasswordResetToken model |
| Email notification strict delivery | P3 | ✅ Yes (future) | Low priority — in-app works |
| Attachment/storage | P1 (separate) | ✅ Yes (future) | FP-11 P1-3 |
