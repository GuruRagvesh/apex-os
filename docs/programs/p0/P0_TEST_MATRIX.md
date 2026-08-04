# Apex OS — P0 Test Matrix

This matrix maps critical P0 security and functionality verification steps, highlighting automatic test coverage and manual test scenarios.

## 1. Automated Test Coverage (Unit Tests)

The following test suites have been verified clean and pass successfully under Jest:

| Spec File | Target Component | Coverage Scenarios | Status |
|---|---|---|---|
| [p0.access-policy.spec.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/test/unit/p0.access-policy.spec.ts) | `AccessPolicyService` | - User payload sanitization (password, payroll stripping)<br>- Manager block on HR/Payroll/Docs by default<br>- Employee self-access permission checks | ✅ PASS |
| [p0.project-access.spec.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/test/unit/p0.project-access.spec.ts) | `ProjectService` Mutation Guards | - Blocking manager mutations outside scope<br>- Admin mutation bypass check | ✅ PASS |
| [p0.ticket-access-timing.spec.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/test/unit/p0.ticket-access-timing.spec.ts) | `TicketAccessService` & `TicketTimingService` | - Direct-ID ticket access scoping checks (403 if out of scope)<br>- Timer creation and overdue states<br>- Reviewer role responsibility assignment<br>- Stopping timers for completed tickets | ✅ PASS |
| [leave.rules.spec.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/test/unit/leave.rules.spec.ts) | `LeaveAccessService` Rules | - Employee self-approval block (403)<br>- Manager approval scope<br>- Submitter self-cancellation on pending requests<br>- Double-action/re-approval blocks | ✅ PASS |
| [ticket.transitions.spec.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/test/unit/ticket.transitions.spec.ts) | Status State Machine | - Intern progression checks (limited to IN_PROGRESS)<br>- Non-manager approval blocks<br>- Assignee/Reporter transition privileges | ✅ PASS |
| [auth.otp.spec.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/test/unit/auth.otp.spec.ts) | `AuthService` Security | - Throttling / Rate-limiting simulation<br>- OTP generation & expired tokens rejection<br>- Reset password verification block with bad OTP | ✅ PASS |

---

## 2. Interactive / Manual QA Verification Checklist

Reviewers can verify the following paths manually using the provided seed test accounts:

| Module | Test Action | Expected Behavior | Verification Role | Status |
|---|---|---|---|---|
| **Auth** | POST /auth/register | Rejects requests without Admin/SuperAdmin Bearer token. | All non-Admins | ✅ Verified |
| **Auth** | POST /auth/reset-password | Rejects password resets with wrong/blank OTP codes. | All | ✅ Verified |
| **Tickets** | Direct ticket ID access | Navigating to `/tickets/:id` outside own department/assignee scope returns a 403 Forbidden. | Employee / Intern | ✅ Verified |
| **Tickets** | Transition REVIEW $\rightarrow$ DONE | Attempting to approve a ticket to DONE returns 403 Forbidden. Only Managers and Admins can complete. | Intern / Employee | ✅ Verified |
| **Leave** | Approve own leave request | Action fails with a 403 error toast in the UI. | Manager / Admin | ✅ Verified |
| **Leave** | Date order validation | Submitting leave with start date > end date triggers a validation error. | All | ✅ Verified |
| **Payroll** | Read payroll details | Sensitive details (e.g. CTC, Bank accounts) are masked or removed from the JSON payload. | Employee / Manager | ✅ Verified |
| **Dashboard**| Org-wide Metrics | Dashboard displays department-specific card numbers matching the scoped lists. | Manager / Lead | ✅ Verified |
