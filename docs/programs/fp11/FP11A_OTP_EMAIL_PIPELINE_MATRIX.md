# FP-11A — OTP + EMAIL PIPELINE MATRIX
**Date:** 2026-05-30 | Branch: stabilize/apex-os-core @ 8eddef7

| Step | Component | Works | Evidence |
|---|---|---|---|
| **FRONTEND** | | | |
| Forgot password route exists | `(auth)/forgot-password/page.tsx` | ✅ YES | File present, 213 lines |
| Login page links to /forgot-password | `login/page.tsx:120` | ✅ YES | `<Link href="/forgot-password">Forgot your password?</Link>` |
| Email input + submit | `handleSendOtp()` | ✅ YES | `type="email"`, `required`, HTML5 validation |
| Calls correct API endpoint | `authApi.forgotPassword(email)` | ✅ YES | `api.post('/auth/forgot-password', { email })` → `lib/api.ts:67` |
| Shows generic success (no enumeration) | `GENERIC_OTP_MESSAGE` | ✅ YES | `'If an account exists for that email, a one-time code has been sent.'` → `page.tsx:26` |
| Treats 404 as success | `handleSendOtp catch block` | ✅ YES | `if (isNotFound) { toast.success(GENERIC_OTP_MESSAGE); setStep('reset'); }` → `page.tsx:40-43` |
| Advances to OTP step | `setStep('reset')` | ✅ YES | `page.tsx:35, 42` |
| OTP input field | Step 2 form | ✅ YES | Numeric-only, maxLength 6, `font-mono tracking-widest` → `page.tsx:138-148` |
| Password + confirm fields | Step 2 form | ✅ YES | With show/hide toggles and mismatch validation → `page.tsx:152-182` |
| Min 8 chars validation | `page.tsx:55` | ✅ YES | `if (newPassword.length < 8) { toast.error(...) return; }` |
| Submit calls reset endpoint | `authApi.resetPassword(email, otp, newPassword)` | ✅ YES | `api.post('/auth/reset-password', { email, otp, newPassword })` → `lib/api.ts:68-69` |
| On success → redirect to /login | `router.push('/login')` | ✅ YES | `page.tsx:60` |
| Back to Login link | `<Link href="/login">` | ✅ YES | `page.tsx:205` |
| Back button on step 2 | `setStep('email')` button | ✅ YES | `page.tsx:185-190` |
| **BACKEND — FORGOT-PASSWORD** | | | |
| Endpoint exists | `POST /auth/forgot-password` | ✅ YES | `auth.controller.ts:49-52` |
| No auth guard (public) | No `@UseGuards` | ✅ YES | `auth.controller.ts:49` — no guard decorator |
| No rate limiting | No `@Throttle` | ❌ MISSING | Only `@Post('login')` has `@Throttle` → `auth.controller.ts:18` |
| No DTO validation on email | Raw `body: { email: string }` | ❌ MISSING | No class-validator DTO for forgot-password; `LoginDto` is separate → `auth.controller.ts:50` |
| Normalizes email (lowercase/trim) | `email.trim().toLowerCase()` | ✅ YES | `auth.service.ts:145` |
| DB user lookup | `findUserByEmailCI()` | ✅ YES | Case-insensitive Prisma query → `auth.service.ts:146` |
| Throws 404 for unknown email | `throw new NotFoundException` | ⚠️ YES (masked by FE) | `auth.service.ts:147` — enumeration risk; frontend masks |
| OTP generation | `Math.floor(100000 + Math.random() * 900000)` | ✅ YES | `auth.service.ts:149` |
| OTP stored in memory | `otpStore.set(email, { otp, expires })` | ✅ YES | `auth.service.ts:150` |
| 10-minute expiry set | `Date.now() + 10 * 60 * 1000` | ✅ YES | `auth.service.ts:150` |
| OTP NOT logged in production | `if (NODE_ENV !== 'production')` | ✅ YES | `auth.service.ts:153` — dev console log only; OTP value never logged |
| Response claims OTP sent | `{ message: 'OTP sent to <email>' }` | ⚠️ MISLEADING | `auth.service.ts:156` — says "sent" but email never sent |
| **BACKEND — EMAIL DELIVERY (CRITICAL)** | | | |
| EmailModule imported in AuthModule | Check `auth.module.ts` | ❌ **NOT PRESENT** | `auth.module.ts:9-26` imports only `PassportModule`, `JwtModule` |
| EmailService injected in AuthService | Check constructor | ❌ **NOT PRESENT** | `auth.service.ts:14-19` — 4 params, none is `EmailService` |
| sendEmail called in sendOtp | Search auth.service.ts | ❌ **NOT PRESENT** | Grep: zero matches for `emailService.`, `sendEmail`, `sendMail` in auth.service.ts |
| TODO comment confirms missing wiring | Line 151 | ✅ CONFIRMED | `// TODO: send via SMTP when configured — email.service.ts is wired but optional` |
| OTP delivered to user | Any mechanism | ❌ **NEVER** | No code path exists to deliver OTP to user in production |
| **BACKEND — OTP STORAGE** | | | |
| OTP stored in database | Prisma schema search | ❌ NOT IN DB | No `PasswordReset`, `OtpStore`, or similar model in schema |
| OTP persists across restarts | — | ❌ NO | In-memory Map only — lost on any restart/deploy |
| OTP is plain text | `{ otp: string }` | ⚠️ YES | Not hashed — direct string comparison at reset |
| Single OTP per email | `otpStore.set()` overwrites | ✅ YES | New request invalidates previous |
| OTP consumed after use | `otpStore.delete()` | ✅ YES | `auth.service.ts:178` — deleted after successful reset |
| Background expiry cleanup | — | ❌ NONE | No `setInterval` or cron job; entries persist until verified |
| **BACKEND — RESET PASSWORD** | | | |
| Endpoint exists | `POST /auth/reset-password` | ✅ YES | `auth.controller.ts:54-57` |
| Min 8 chars enforced | `newPassword.length < 8` | ✅ YES | `auth.service.ts:160-162` |
| OTP existence check | `otpStore.get(email)` | ✅ YES | `auth.service.ts:165-166` |
| Expiry check | `Date.now() > entry.expires` | ✅ YES | `auth.service.ts:167-170` |
| Correct OTP check | `entry.otp !== otp` | ✅ YES | `auth.service.ts:171` |
| Password hashed bcrypt-12 | `bcrypt.hash(newPassword, 12)` | ✅ YES | `auth.service.ts:176` |
| Password persisted | `updatePassword()` → `prisma.user.update` | ✅ YES | `auth.service.ts:177` |
| OTP consumed (single-use) | `otpStore.delete(normalizedEmail)` | ✅ YES | `auth.service.ts:178` |
| Residual enumeration (step 2) | Distinct error messages | ⚠️ YES | `"No OTP requested"` ≠ `"Invalid OTP"` |
| **SMTP SERVICE** | | | |
| EmailService exists | `email.service.ts` | ✅ YES | Complete nodemailer service |
| Reads config from DB | `AppSetting` key `'smtp'` | ✅ YES | `email.service.ts:46` |
| Reads config from ENV | — | ❌ NO | No `ConfigService` injection; env vars not read |
| Lazy transporter init | On first send call | ✅ YES | `ensureTransporter()` called in `sendEmail()` |
| Graceful degradation | Returns `false`, no throw | ✅ YES | `sendEmail()` → `return false` when unconfigured |
| SMTP currently configured | DB AppSetting 'smtp' | ❌ NO | Default = `{ host: '', port: '587', email: '', password: '' }` → null config |
| sendTestEmail endpoint | `POST /settings/email/test` | ✅ YES | Throws `400` if SMTP unconfigured (strict mode) |
| Email templates exist | `buildHtml()` | ✅ YES | Ticket-assigned, resolved, leave-approved, leave-rejected |
| OTP email template | — | ❌ MISSING | No OTP-specific HTML template in `email.service.ts` |
| **PRODUCTION READINESS** | | | |
| User can complete forgot-password | End-to-end | ❌ **NO** | OTP unreachable in production — feature non-functional |
| In-app notifications work | Socket.IO | ✅ YES | Fully independent of email |
| Email notifications work | SMTP required | ❌ **NO** | SMTP not configured in DB |
