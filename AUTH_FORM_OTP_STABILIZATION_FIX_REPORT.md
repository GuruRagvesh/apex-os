# Stabilization Fix Report — Auth Throttling, Form Focus, Data Persistence, and OTP Resend

Detailed report of technical implementations resolving stabilization issues across NestJS (backend) and Next.js (frontend).

## Summary of Changes

### 1. Backend

#### Custom Throttler Guard (`AppThrottlerGuard`)
* **File**: [app-throttler.guard.ts](file:///c:/Projects/nexus-app/backend/src/shared/guards/app-throttler.guard.ts)
* **Action**: Created custom throttler guard extending NestJS `ThrottlerGuard`.
* **Details**: Overrode `getTracker` to intercept requests.
  - For `POST /api/auth/login`, it normalizes the email to lowercase and generates a composite tracker key: `login-${normalizedEmail}-${ip}`.
  - For all other routes, it defaults to the standard IP-based tracking (`req.ip`).
  - Added bypass logic to skip throttling when `NODE_ENV === 'test'`.
* **Registration**: Updated [app.module.ts](file:///c:/Projects/nexus-app/backend/src/app.module.ts) to register `AppThrottlerGuard` as the global `APP_GUARD` provider.

#### OTP Cooldown (`AuthService`)
* **File**: [auth.service.ts](file:///c:/Projects/nexus-app/backend/src/modules/core/auth/auth.service.ts)
* **Action**: Modified `sendOtp` method to enforce a 30-second cooldown per account.
* **Details**:
  - The `otpStore` value type was updated to include a `createdAt` timestamp.
  - Before generating a new OTP, the system checks if a valid OTP was created within the last 30 seconds.
  - If a request is received within the 30-second window, the system returns a successful response without sending another email or generating a new OTP (enumeration safe).
  - After 30 seconds, a new request overwrites the prior OTP entry in the store and sends a new email.

#### Safe Profile updates (`UsersService`)
* **File**: [users.service.ts](file:///c:/Projects/nexus-app/backend/src/modules/core/users/users.service.ts)
* **Action**: Refactored `updateProfile` method.
* **Details**:
  - Created a whitelist of database columns defined in the `User` schema (e.g., `joiningDate`, `dateOfBirth`, `status`, `departmentId`, `bio`).
  - Extracted only these columns from the incoming DTO, ignoring relational objects (`role`, `department`) to prevent Prisma validation crashes.
  - Date strings are explicitly parsed into JS `Date` objects before updating.

#### Departments Access Control (`DepartmentsController`)
* **File**: [departments.controller.ts](file:///c:/Projects/nexus-app/backend/src/modules/core/departments/departments.controller.ts)
* **Action**: Restored read access (`findAll`, `findOne`) for all authenticated users.
* **Details**:
  - Removed `@UseGuards(RolesGuard)` and `@Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)` from the `findAll` and `findOne` routes.
  - This allows normal authenticated users (e.g., Employees, Interns) to query departments for filters, Kanban columns, and ticket creation forms without causing a 403 Forbidden crash.
  - All write routes (`create`, `update`, `patch`, `remove`) remain strictly protected for `ADMIN` and `SUPER_ADMIN`.

---

### 2. Frontend

#### Form Remounting & Focus Loss (`EmployeeProfilePage`)
* **File**: [profile/page.tsx](file:///c:/Projects/nexus-app/frontend/app/(dashboard)/(platform)/users/[id]/profile/page.tsx)
* **Action**: Extracted components and implemented a stable context.
* **Details**:
  - Moved `Field` and `SelectField` definitions completely out of the `EmployeeProfilePage` render tree.
  - Created `ProfileFormContext` to share form state and mutators (`editMode`, `formData`, `setFormData`, `profile`) stably.
  - This prevents component recreation and cursor jumps during keystrokes.
  - Added query invalidation for `['user-profile', userId]` and `['users']` caches on edit success.

#### Store Updating on Save (`Settings`)
* **File**: [settings/page.tsx](file:///c:/Projects/nexus-app/frontend/app/(dashboard)/settings/page.tsx)
* **Action**: Updated save handler for settings profile.
* **Details**:
  - Included `bio` explicitly in the `updateUser(...)` payload to ensure that changes persist to the local authentication store state and reflect immediately upon saving.

#### Clearable Fields (`Project` and `Projects`)
* **File**: [projects/[id]/page.tsx](file:///c:/Projects/nexus-app/frontend/app/(dashboard)/(operations)/projects/[id]/page.tsx)
* **Action**: Updated form submission payload.
* **Details**:
  - Empty or cleared fields (e.g., departmentId set to "None" or blank endDates) are explicitly sent to the backend as `null` instead of `undefined`. This forces database updates that clear the fields.

#### OTP Resend Cooldown UI (`ForgotPassword`)
* **File**: [forgot-password/page.tsx](file:///c:/Projects/nexus-app/frontend/app/(auth)/forgot-password/page.tsx)
* **Action**: Implemented cooldown timer and countdown.
* **Details**:
  - Added a client-side timer state (`resendCooldown`).
  - Added an effect that decrements this counter every second if it is greater than zero.
  - Disabled the "Resend code" button while the cooldown is active, changing its label to "Resend in Xs".
  - Allowed clicks only when the countdown reaches zero, triggering the API call and resetting the countdown to 30.
