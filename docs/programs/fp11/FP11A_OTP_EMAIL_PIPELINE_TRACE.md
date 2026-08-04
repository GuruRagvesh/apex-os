# FP-11A — FORGOT PASSWORD + EMAIL PIPELINE TRACE AUDIT
**Date:** 2026-05-30 | Branch: stabilize/apex-os-core @ 8eddef7
**Method:** Read-only source inspection. No code changed.

---

## END-TO-END FLOW DIAGRAM

```
USER ACTION                     FRONTEND                        BACKEND                         EMAIL
──────────────────────────────────────────────────────────────────────────────────────────────────────
                                /forgot-password page
                                  (auth)/forgot-password/page.tsx

[Step 1] Enter email ────────→  handleSendOtp()
                                authApi.forgotPassword(email)
                                POST /auth/forgot-password ────→ AuthController.forgotPassword()
                                { email: string }                 authService.sendOtp(email)
                                                                    1. normalize email (lowercase)
                                                                    2. findUserByEmailCI(email)
                                                                       → DB lookup (case-insensitive)
                                                                    3. if !user → throw 404 ──────→ (frontend treats
                                                                       "User not found"             as success)
                                                                    4. otp = Math.floor(
                                                                         100000 +
                                                                         Math.random() * 900000
                                                                       ).toString()
                                                                    5. otpStore.set(email,
                                                                         { otp, expires: +10min })
                                                                    6. if (NODE_ENV !== 'production')
                                                                         console.log(
                                                                           "[OTP:DEV] Reset requested
                                                                            for: <email>"
                                                                         )
                                                                    7. *** TODO: send via SMTP ***
                                                                       ← NO EMAIL SENT HERE →
                                                                    8. return { message:
                                                                         "OTP sent to <email>" }
                                ← 200 { message: "OTP sent..." }
                                toast.success(GENERIC_OTP_MESSAGE)
                                setStep('reset')

                                                              ▲
                                                              │
                                                    OTP LIVES ONLY IN MEMORY
                                                    AuthService.otpStore (Map)
                                                    User has NO WAY to receive it
                                                    in production.
                                                              │
                                                              ▼

[Step 2] User sees:             "Enter the OTP sent to <email>"
         (page assumes           ← text implies delivery occurred
          delivery occurred)

[Step 2] Enter OTP +            handleReset()
         new password ─────────→ authApi.resetPassword(
                                   email, otp, newPassword
                                 )
                                 POST /auth/reset-password ────→ AuthController.resetPassword()
                                 { email, otp, newPassword }       authService.resetPasswordWithOtp(
                                                                     email, otp, newPassword
                                                                   )
                                                                    1. if newPassword.length < 8
                                                                         → throw 400
                                                                    2. normalize email
                                                                    3. entry = otpStore.get(email)
                                                                         if !entry → throw 400
                                                                         "No OTP requested"
                                                                    4. if expired → delete + throw
                                                                         "OTP has expired"
                                                                    5. if entry.otp !== otp
                                                                         → throw 400 "Invalid OTP"
                                                                    6. findUserByEmailCI(email)
                                                                    7. bcrypt.hash(newPassword, 12)
                                                                    8. prisma.user.update(
                                                                         { password: hashed,
                                                                           mustChangePassword: false }
                                                                       )
                                                                    9. otpStore.delete(email)
                                                                   10. return { message:
                                                                         "Password reset
                                                                          successfully" }
                                ← 200 { message: "Password reset..." }
                                toast.success(
                                  "Password reset successfully!
                                   Please log in.")
                                router.push('/login')

[Complete] ─────────────────→  /login page
```

---

## STEP 1 — FRONTEND FLOW

**File:** `frontend/app/(auth)/forgot-password/page.tsx`

| # | Question | Answer |
|---|---|---|
| 1 | Route location | `frontend/app/(auth)/forgot-password/page.tsx` — renders at `/forgot-password` |
| 2 | API endpoint called (step 1) | `POST /auth/forgot-password` via `authApi.forgotPassword(email.trim())` |
| 3 | Request payload (step 1) | `{ email: string }` |
| 4 | Success message shown | `'If an account exists for that email, a one-time code has been sent.'` (`GENERIC_OTP_MESSAGE`) |
| 5 | Error message shown | `err?.message \|\| 'Could not send the code right now. Please try again.'` — shown for non-404 errors only |
| 6 | Does frontend leak enumeration? | **NO** — 404 (`"User not found"`) is caught and treated identically to success (generic message + advance to OTP step). This is the FP-10 hardening. |
| 7 | Does frontend assume email was sent? | **YES** — step 2 displays `"Enter the OTP sent to <email>"`. This text implies delivery. The frontend has no way to know whether the backend actually sent email. |
| 8 | Does frontend wait for OTP? | **YES** — `setStep('reset')` transitions to step 2 which requires OTP input |
| 9 | Does frontend support OTP entry? | **YES** — numeric-only input field, maxLength 6, strips non-digits |
| 10 | Does frontend support password reset? | **YES** — step 2: OTP + new password + confirm password → `authApi.resetPassword(email, otp, newPassword)` → `POST /auth/reset-password` |

**Frontend complete flow:**
```
/forgot-password
↓
Step 1: Email input → POST /auth/forgot-password
↓
(404 or success) → show GENERIC_OTP_MESSAGE → advance to step 2
↓
Step 2: OTP input + new password + confirm → POST /auth/reset-password
↓
200 success → toast → router.push('/login')
```

**Assessment:** Frontend is well-built and complete. Its only known issue is that it says "OTP sent to <email>" implying delivery, which cannot be guaranteed until the backend actually sends email.

---

## STEP 2 — BACKEND ENTRYPOINT

**Files:** `auth.controller.ts:49-56`, `auth.service.ts:144-157`

```typescript
// auth.controller.ts:49-56
@Post('forgot-password')
async forgotPassword(@Body() body: { email: string }) {
  return this.authService.sendOtp(body.email);
}
```

| # | Question | Answer |
|---|---|---|
| 1 | Exact controller method | `@Post('forgot-password')` in `AuthController` — line 49 |
| 2 | Exact service method | `AuthService.sendOtp(email: string)` — line 144 |
| 3 | Validation performed | **NONE** — body typed as `{ email: string }` but no `class-validator` DTO. No `@IsEmail()` applied. Any string (or empty string) passes through. |
| 4 | User lookup performed? | **YES** — `findUserByEmailCI(normalizedEmail)` — case-insensitive, trims whitespace |
| 5 | OTP generation | `Math.floor(100000 + Math.random() * 900000).toString()` — 6-digit numeric, `Math.random()` (not `crypto.randomInt`) |
| 6 | OTP storage | `this.otpStore.set(normalizedEmail, { otp, expires: Date.now() + 10 * 60 * 1000 })` — **in-memory Map on AuthService instance** |
| 7 | OTP expiry logic | `expires = Date.now() + 600_000` (10 minutes) |
| 8 | Rate limiting | **NONE** — no `@Throttle()` decorator. `@Throttle` exists only on `@Post('login')` (line 18) |
| 9 | Enumeration protection | **NONE in backend** — throws `NotFoundException('User not found')` for unknown emails. Frontend masks this. Network-level 404 still visible. |
| 10 | Exact response returned | `{ message: 'OTP sent to <normalizedEmail>' }` — **note:** this message implies delivery; delivery does not occur |

---

## STEP 3 — OTP STORAGE

**Evidence:** `auth.service.ts:11-12`
```typescript
/** In-memory OTP store: email → { otp, expires } */
private otpStore = new Map<string, { otp: string; expires: number }>();
```

**Prisma schema audit:** Searched for `otp`, `OTP`, `VerificationCode`, `PasswordReset`, `ForgotPassword` — **zero matches**. No DB table exists for OTP storage.

| # | Question | Answer |
|---|---|---|
| 1 | Where OTP stored? | **In-memory `Map<string, { otp: string; expires: number }>` on `AuthService` instance** |
| 2 | Plain text or hashed? | **Plain text** — stored exactly as generated: `'123456'` |
| 3 | Expiry duration | **10 minutes** from generation time |
| 4 | Cleanup strategy | Entry deleted on: (a) successful reset (`otpStore.delete` at line 178); (b) detected expiry on verify attempt (line 168); **no background timer or periodic cleanup** |
| 5 | Multiple OTPs allowed? | **NO** — `otpStore.set()` overwrites previous entry for same email |
| 6 | Old OTP invalidated by new request? | **YES** — overwrite semantics |
| 7 | Security concerns | ① Plain text storage (not hashed) ② In-memory only — **lost on any backend restart/deploy** ③ No background expiry cleanup — stale entries linger until verified ④ `Math.random()` not cryptographically secure ⑤ No rate limiting = brute-forceable in 10-min window |

---

## STEP 4 — EMAIL TRACE (CRITICAL SECTION)

This is the definitive answer to: **does the OTP actually get emailed?**

### Proof chain

**Claim to test:** `sendOtp()` sends the OTP via email.

**Evidence 1 — `auth.module.ts:1-27` (full file read):**
```typescript
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({ ... }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
```
`EmailModule` is **not imported** into `AuthModule`. NestJS dependency injection scopes apply: `EmailService` is not available to `AuthService` unless `EmailModule` is imported here (or provided globally, which it is not).

**Evidence 2 — `auth.service.ts:14-19` (constructor):**
```typescript
constructor(
  private prisma: PrismaService,
  private jwtService: JwtService,
  private configService: ConfigService,
  private eventLogger: EventLoggerService,
) {}
```
`EmailService` is **not injected**. The constructor has 4 parameters; none is `EmailService`.

**Evidence 3 — `auth.service.ts:151` (inside `sendOtp`):**
```typescript
// TODO: send via SMTP when configured — email.service.ts is wired but optional
```
The developer explicitly marked this as a TODO. Delivery was always intended but never implemented.

**Evidence 4 — `auth.service.ts:153-155`:**
```typescript
if (process.env.NODE_ENV !== 'production') {
  console.log(`[OTP:DEV] Reset requested for: ${normalizedEmail} — check email or SMTP logs`);
}
```
Dev log says "check email or SMTP logs" — **misleading**. There are no SMTP logs for this flow because no email is sent.

**Evidence 5 — Grep for any email call in auth.service.ts:**
```
auth.service.ts:144:  async sendOtp(email: string) {
auth.service.ts:151:    // TODO: send via SMTP ...
```
Zero `emailService.` calls, zero `sendMail` calls, zero `sendEmail` calls. Confirmed exhaustively.

### Verdict

**OUTCOME B: OTP generated but email NEVER sent.**

The full `sendOtp` sequence is:
```
sendOtp(email)
  ↓
  normalize email
  ↓
  DB lookup — user must exist
  ↓
  generate OTP (Math.random)
  ↓
  store in otpStore (memory)
  ↓
  console.log [OTP:DEV] in non-production ← NOT the OTP value
  ↓
  return { message: "OTP sent to <email>" }  ← message lies about delivery
  ↓
  *** EMAIL NEVER CALLED ***
  *** NO EmailService INJECTION ***
  *** NO sendEmail CALL ***
  *** OTP UNREACHABLE BY USER IN PRODUCTION ***
```

There is no code path by which a user can receive the OTP outside of:
- Being a developer who reads the server-side `[OTP:DEV]` console output (which, per the code comment, does NOT include the OTP value)
- Directly reading the AuthService in-memory `otpStore` (impossible from UI)

---

## STEP 5 — SMTP ARCHITECTURE

**File:** `email.service.ts`

### Configuration source

```typescript
private async ensureTransporter(strict = false) {
  const setting = await this.prisma.appSetting.findUnique({ where: { key: 'smtp' } });
  const raw = (setting?.value as any) ?? {};
  ...
}
```

Config source is **DB only** — `AppSetting` key `'smtp'`. The `SMTP_*` env vars in `.env` are **never read** by `EmailService`. `ConfigService` is not injected into `EmailService`.

### Default SMTP value (if no DB row exists)

From `settings.service.ts:19`:
```typescript
smtp: { host: '', port: '587', email: '', password: '' },
```
An empty object — `normalizeConfig` will return `null`, transporter will be `null`, all emails skip.

### Initialization

| # | Question | Answer |
|---|---|---|
| 1 | Where transporter created? | `emailService.ensureTransporter()` → `nodemailer.createTransport(...)` |
| 2 | When transporter created? | **Lazily** — on first `sendEmail()` or `sendTestEmail()` call, not at startup |
| 3 | What if config missing? | `transporter = null`, `logger.warn('SMTP not configured in settings - emails will be skipped')` |
| 4 | What if DB settings missing/blank? | Same — `normalizeConfig` returns `null`, transporter is null |
| 5 | What if SMTP auth fails at send time? | `transporter.sendMail()` throws, caught, `logger.error('Email failed: ...')`, returns `false` |
| 6 | Does system log? | `warn` on missing config, `debug` on each skip, `error` on send failure, `log` on success |
| 7 | Does API fail? | **NO** — `sendEmail` returns `false`; all callers use `try/catch (_e) {}` |
| 8 | Does API silently continue? | **YES** — primary operation always completes; email failure is invisible to user and admin |

---

## STEP 6 — RESET PASSWORD TRACE

**File:** `auth.service.ts:159-181`

```typescript
async resetPasswordWithOtp(email: string, otp: string, newPassword: string) {
```

| # | Question | Answer |
|---|---|---|
| 1 | Exact endpoint | `POST /auth/reset-password` body `{ email: string; otp: string; newPassword: string }` |
| 2 | Validation logic | ① `newPassword.length < 8` → `400 'New password must be at least 8 characters'` ② `!otpStore.get(email)` → `400 'No OTP requested for this email'` ③ `Date.now() > entry.expires` → delete + `400 'OTP has expired'` ④ `entry.otp !== otp` → `400 'Invalid OTP'` ⑤ `!user` → `404 'User not found'` |
| 3 | Expiry validation | **YES** — checked before OTP comparison; expired entry deleted on detection |
| 4 | Password hashing | `bcrypt.hash(newPassword, 12)` — cost factor 12 ✅ |
| 5 | OTP invalidation after use | **YES** — `otpStore.delete(normalizedEmail)` called on line 178 immediately after successful reset |
| 6 | Enumeration risk | **YES (residual)** — `'No OTP requested for this email'` vs `'Invalid OTP'` are distinct errors. An attacker can confirm whether an OTP request was ever made for a given email. Less severe than step-1 enumeration. |
| 7 | Replay attack risk | **LOW** — OTP is single-use (deleted on success). However, since OTP is plain-text in memory, a server compromise would expose all active OTPs. |

---

## STEP 7 — NOTIFICATION RELATIONSHIP

**Question:** Does forgot-password use EmailService, NotificationEventService, both, or neither?

**Answer: NEITHER.**

Evidence:
- `AuthService` constructor: injects `PrismaService`, `JwtService`, `ConfigService`, `EventLoggerService` — **no `EmailService`, no `NotificationEventService`**
- `AuthModule` imports: `PassportModule`, `JwtModule` — **no `EmailModule`, no `NotificationsModule`**
- Grep of entire `auth.service.ts` for `emailService`, `sendEmail`, `notificationEvent`, `sendNotification` — **zero matches**

The `EventLoggerService` is injected and logs `USER_LOGIN` on login. It is **not called** anywhere in `sendOtp` or `resetPasswordWithOtp`.

Architecture summary:
```
Forgot Password Flow
├── Uses: PrismaService (DB lookup + password update)
├── Uses: EventLoggerService (login event only — NOT for OTP)
├── Does NOT use: EmailService
├── Does NOT use: NotificationEventService
└── Does NOT use: Any delivery mechanism
```

---

## STEP 8 — PRODUCTION READINESS CLASSIFICATION

| Feature | Status | Evidence |
|---|---|---|
| **Forgot Password UI** | **FUNCTIONAL BUT UNCONFIGURED** | Page exists, API calls wired, step flow correct; "sent to email" text misleads once email is undelivered |
| **OTP Generation** | **FULLY FUNCTIONAL** | `Math.floor(100000 + Math.random() * 900000)`, 6-digit, 10-min expiry, overwrites on re-request — all working |
| **OTP Storage** | **FUNCTIONAL BUT UNCONFIGURED** | Works in-memory; not production-grade (no persistence, no DB, lost on restart) |
| **OTP Delivery** | **BROKEN** | No email sent. `AuthService` does not inject `EmailService`. `TODO` comment at line 151 confirms this is known missing wiring. User cannot receive OTP in production. |
| **SMTP** | **FUNCTIONAL BUT UNCONFIGURED** | `EmailService` is complete (nodemailer, HTML templates, DB-driven config, lazy transporter); no SMTP saved in DB; all sends are silent no-ops |
| **Email Notifications** | **FUNCTIONAL BUT UNCONFIGURED** | ticket-assigned, ticket-resolved, leave-approved, leave-rejected all call `EmailService`; all silently return `false` due to missing SMTP config |

---

## MINIMAL FIX DESCRIPTION (audit finding, not implementation)

The gap between "OTP generated" and "OTP delivered" is precisely two missing pieces in `auth.service.ts`:

1. Inject `EmailService` into `AuthService` (requires adding `EmailModule` to `AuthModule` imports)
2. Call `emailService.sendEmail(normalizedEmail, subject, htmlTemplate)` in `sendOtp()` after storing the OTP

The `EmailService.sendEmail()` method already exists, is well-tested, handles SMTP-unconfigured gracefully (returns `false`), and has the HTML template builder (`buildHtml`). The infrastructure is complete. Only the connection between `AuthService` and `EmailService` is missing.
