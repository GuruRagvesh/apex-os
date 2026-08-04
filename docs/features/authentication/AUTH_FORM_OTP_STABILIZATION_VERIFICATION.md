# Stabilization Verification Report — Auth Throttling, Form Focus, Data Persistence, and OTP Resend

Verification plan results and build details confirming stabilization fixes are ready for rollout.

## 1. Automated Verification

### Unit Tests
* **Command**: `npm run test:unit`
* **Outcome**: Passed (18 suites, 136 tests total)
* **Specific Specs**:
  - [auth.throttle.spec.ts](file:///c:/Projects/nexus-app/backend/test/unit/auth.throttle.spec.ts):
    - Verified that `AppThrottlerGuard` successfully scopes `/auth/login` by both email and IP.
    - Verified that user A and user B on the same IP receive distinct throttling keys (preventing global lockout).
    - Verified that other routes remain scoped strictly by IP only.
  - [auth.otp.spec.ts](file:///c:/Projects/nexus-app/backend/test/unit/auth.otp.spec.ts):
    - Verified that calling `sendOtp` twice within 30 seconds does not generate a new OTP or send a second email.
    - Verified that calling `sendOtp` after 30 seconds generates a new OTP and sends a new email.
  - [users.profile.spec.ts](file:///c:/Projects/nexus-app/backend/test/unit/users.profile.spec.ts):
    - Verified that `updateProfile` filters out relations (such as `role` and `department`) before writing to Prisma to avoid schema validation crashes.

### Integration Tests
* **Command**: `npx jest test/integration/smoke.spec.ts --runInBand` and `npx jest test/integration/p2.dashboard-recovery.spec.ts --runInBand`
* **Seeding**: Ran `npx ts-node prisma/seed-test-users.ts` to populate the test database with QC personas.
* **Outcome**:
  - `smoke.spec.ts` passed completely (41/41 tests passed).
  - `p2.dashboard-recovery.spec.ts` passed completely (7/7 tests passed).
  - Crucially: `GET /api/departments as any authenticated user → 200` passed without returning 403 Forbidden after fixing `DepartmentsController`.

### Build Compilation
* **Backend**: `npm run build` completed successfully.
* **Frontend TSC**: `npx tsc --noEmit` checked out with 0 type errors.
* **Frontend Build**: `npm run build` successfully optimized and compiled Next.js routes with zero errors.
* **Prisma**: `npx prisma validate` completed with success.

---

## 2. Manual Verification Guidelines

### A. Login Throttling
1. Try to log in with an incorrect password 10 times for `admin@apex.local`.
2. Observe that `admin@apex.local` becomes throttled.
3. Immediately try to log in with the correct credentials for `employee@apex.local` from the same machine (same IP).
4. Verify that the employee login is successful and not blocked by the admin's throttling.

### B. Form Focus
1. Log in as an administrator and go to `/users/cmpwb2yp4000frd9p3d9fk44c/profile` (or any employee profile page).
2. Click "Edit Profile" (or edit mode).
3. Type continuously in any text input field (e.g., "Full Name" or "Designation").
4. Verify that the cursor stays inside the input field and focus is never lost.

### C. Value Clearing (Data Persistence)
1. Navigate to `/projects`. Select any project and edit it.
2. Change the department selection from a specific department to "None".
3. Save the project and reload the page.
4. Verify that the department field remains "None" and has been updated in the database.
5. In settings profile, update the bio field and save. Reload the settings page.
6. Verify that the saved bio is persisted in settings and matches the topbar user avatar card bio.

### D. OTP Resend Countdown
1. Go to the login screen and click "Forgot Password".
2. Type an email address and click "Send Code".
3. The UI shifts to the verification code screen.
4. Verify that the "Resend code" button is disabled and displays a countdown timer (e.g., "Resend code in 30s").
5. Wait 30 seconds until the countdown ends.
6. Click the enabled "Resend code" button. Verify that the countdown restarts at 30 seconds.
