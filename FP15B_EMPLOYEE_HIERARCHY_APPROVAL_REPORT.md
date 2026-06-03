# FP15B Employee Profile & Hierarchy Change Approval Workflow Report

## Overview
This report details the implementation of a controlled approval workflow for employee hierarchy changes, satisfying all FP-15B requirements. Direct mutations of sensitive hierarchy fields by employees are now strictly blocked and require a staged approval process (TL → Manager → Admin).

## Architecture Changes
- **Data Model:** Added `EmployeeProfileChangeRequest` to Prisma schema to store intent, changes JSON, and multi-stage approval statuses.
- **Service Layer:** Created `ChangeRequestsService` handling the resolution of the approval chain dynamically based on current user hierarchy links (`teamLeadName`, `reportingManager`).
- **Endpoints:** Created `ChangeRequestsController` to expose REST operations for fetching summaries and managing request lifecycle.

## Approval Routing Behavior
- **Employee Request:** Employee → TL → Manager. If no TL exists, routes directly to Manager. If no Manager exists, escalates to Admin.
- **Escalation Rules:** Changes impacting `reportingManager`, `departmentId`, or leadership responsibility are flagged for manager/admin approval.
- **Validation:** Prevents concurrent duplicate requests for the same target user and field. Captured changes strictly store `oldValue` alongside `newValue`.

## Frontend Integration
- **Profile Page (`frontend/app/(dashboard)/profile/page.tsx`):**
  - Displays "Current Approved Details" representing the eight key hierarchy questions.
  - Lists "Pending Change Requests" allowing employees to track and cancel pending requests.
  - Includes a "Request Change" modal.
- **Approvals Inbox (`frontend/app/(dashboard)/admin/approvals/page.tsx`):**
  - Dedicated inbox for approvers (TL/Manager/Admin) to review pending changes in their scope.
  - Provides visual old vs. new value comparison.
  - Mandatory reasoning required for rejections.

## Verification & Status
- **OTP / Notification Integration:** Operational events are emitted via `EventLoggerService`, leaving the email/OTP provider untouched.
- **Security Check:** `access-policy.service` permissions successfully enforced across endpoints.
- **Migration:** Run as `--create-only`. Awaiting deployment for schema push.

## Next Steps
- Verify the newly created DB migration is safely applied in production.
- Review notification payload structures to integrate smoothly with the upcoming activity feed/email provider pipeline if required.
