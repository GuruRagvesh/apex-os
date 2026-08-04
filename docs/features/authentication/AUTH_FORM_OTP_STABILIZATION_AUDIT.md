# Stabilization Audit — Auth Throttling, Form Focus, Data Persistence, and OTP Resend

Audit of the stability, security, and usability issues identified in the Apex OS platform.

## 1. Login Throttling Audit
* **Problem**: Entering an incorrect password multiple times blocked all users globally from logging in.
* **Root Cause**: The default NestJS `ThrottlerGuard` generated a cache tracker key based solely on the incoming IP address (e.g., `req.ip`). For users behind shared NAT gateways, corporate networks, or VPNs, one user's failed attempts locked out everyone sharing that public IP address.
* **Risk**: High vulnerability to Denial of Service (DoS) attacks on valid user accounts and general operational disruption.
* **Required Resolution**: Scope the login throttler dynamically. Login attempts on `/auth/login` must be tracked using a combination of the user's normalized email address and their IP address (e.g., `login-${email}-${ip}`). Other API routes should remain scoped by IP only.

## 2. Form Focus and Cursor Loss Audit
* **Problem**: Typing in the user profile edit forms caused the cursor to lose focus on every character entered.
* **Root Cause**: The custom `Field` and `SelectField` components were defined inline inside the main rendering function of `EmployeeProfilePage` in `frontend/app/(dashboard)/(platform)/users/[id]/profile/page.tsx`. In React, defining components inside a parent render function causes the component definition to be recreated on every state update (keystroke), leading to complete remounts and immediate focus loss.
* **Risk**: Degraded UX, rendering profile edits practically unusable for standard users.
* **Required Resolution**: Extract the `Field` and `SelectField` component declarations outside of the parent page component and establish a stable react context to pass form state without causing element remounts.

## 3. Data Saving and Persistence Audit
* **Problem**: Clearing fields (like setting department to "None" or removing an end date) failed to persist or caused database exceptions.
* **Root Causes**:
  1. **Relation Validation Crashes**: The profile update handler in `users.service.ts` copied relation objects (like `role` or `department`) directly into the Prisma `update` payload. Prisma throws runtime schema validation errors when relation objects are passed directly into update structures.
  2. **Ignore Undefined**: The frontend settings and project edit pages were passing `undefined` for empty inputs, causing the backend serializer to omit the field and leaving the old database value intact.
* **Risk**: Data inconsistency and silent database write failures.
* **Required Resolution**: 
  - Filter and whitelist only valid schema-level columns in `updateProfile` before updating the database.
  - Correctly cast date fields (`joiningDate`, `dateOfBirth`) to valid Date objects.
  - Send explicit `null` values from the frontend instead of `undefined` when empty or "None" is selected to force database persistence.

## 4. Forgot-Password OTP Cooldown Audit
* **Problem**: Resending forgot-password OTP emails lacked rate limiting or a cooldown UI.
* **Root Cause**: The backend generated a new OTP and sent a new email on every hit of `sendOtp`, with no minimum interval check. The frontend lacked a countdown timer to prevent users from spamming the "Resend code" button.
* **Risk**: Email sending quota exhaustion, carrier throttling, and potential user enumeration.
* **Required Resolution**:
  - Implement a 30-second resend window in the backend. Keep response messages generic to prevent account enumeration.
  - Overwrite existing OTP entries if a valid resend occurs after the 30-second window.
  - Implement a client-side 30-second countdown timer and disable the resend button until the countdown reaches zero.
