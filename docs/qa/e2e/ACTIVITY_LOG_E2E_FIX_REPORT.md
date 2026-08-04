# Apex OS Surgical Fix 2 - Activity Log End-to-End Visibility Fix Report

This report details the diagnostics and surgical fixes applied to resolve the Activity Log end-to-end visibility and role scoping issues in Apex OS.

## 1. Diagnostics & Root Cause Analysis

### ParseUUIDPipe Validation Failures
* **Symptom**: Integration tests for ticket status transitions (`PATCH /api/tickets/:id/status`) failed with `400 Bad Request`.
* **Root Cause**: The ticket `id` is generated as a `cuid()` string in the database schema (`schema.prisma`), but the controller parameter validator was using `ParseUUIDPipe`. Since a CUID does not match the UUID format, the pipe rejected valid ticket IDs.
* **Scope**: This bug was also found in `comments.controller.ts` where both `ticketId` and comment `id` were validated using `ParseUUIDPipe`, rejecting valid request payloads.

### Integration Test Routing & Enum Issues
* **Comment API Route**: The integration test sent a `POST` request to `/api/comments` which returned `404 Not Found`. The correct route is nested under the tickets route: `/api/tickets/:ticketId/comments`.
* **Leave Type Enum**: The integration test used `type: 'CASUAL'` which was not present in the allowed database schema enum `LeaveType` (valid values: `ANNUAL`, `SICK`, `EMERGENCY`, `UNPAID`, `OTHER`), leading to a database error (`500 Internal Server Error`).

---

## 2. Implemented Fixes

### A. Backend Controller Validation Hardening
* **[tickets.controller.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/modules/operations/tickets/tickets.controller.ts)**: Removed `ParseUUIDPipe` validation for all ticket and attachment ID parameters, binding them directly to `string` variables.
* **[comments.controller.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/modules/operations/comments/comments.controller.ts)**: Removed `ParseUUIDPipe` validation for `ticketId` and comment `id` parameters to support CUID.

### B. Integration Tests Correction
* **[smoke.spec.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/test/integration/smoke.spec.ts)**:
  * Modified `comment add creates visible event` to request `POST /api/tickets/${ticketId}/comments` and omitted the unnecessary `ticketId` from the JSON payload.
  * Modified `leave request creates visible event` to use `type: 'ANNUAL'` instead of `'CASUAL'`.

---

## 3. Impact & Resolution
* All 8 activity log integration tests now execute and pass successfully.
* System events (ticket creation, status changes, comments, leaves, workday starts) are reliably captured in the `operational_events` table and appropriately scoped according to the user's role.
