# FP18D Notification Monitoring Report

## Executive Summary
The goal of this phase was to construct a robust, real-time notification engine tracking lifecycle and workday changes, ensuring no silent auto-closures or uncommunicated assignments. We completed all the requested Phase 1 to Phase 5 implementations.

## 1. Events Now Covered (Implemented in FP-18D)
1. **Ticket Reassigned (New Assignee)**: If a ticket is assigned to a different user, the new assignee is notified in-app.
2. **Ticket Reassigned (Old Assignee)**: If a ticket is reassigned away from a user, the old assignee is notified to prevent confusion.
3. **Submitted for Review**: When a ticket transitions to `REVIEW`, the logical reviewer (determined via team lead or reporting manager hierarchy) receives a notification to approve it.
4. **Workday Auto-Closed**: If a user leaves their session open past midnight, the scheduler notifies them upon successful auto-closure so they are aware of their time logging state.
5. **Resume After Auto-Close**: If a user starts work and resumes a previously auto-closed session, they receive a success notification confirming their time will be counted with the previous session.

## 2. Events Already Covered (Confirmed)
1. **Initial Ticket Assignment**: Assignee is notified.
2. **Ticket Resolved (Done/Closed)**: Reporter and assignee receive notification.
3. **Ticket Blocked / Unblocked**: Assignees and reporters receive prompt updates.
4. **Hierarchy Requests**: Escalations and final decisions correctly notify the relevant approvers and requesters.
5. **Comments**: Notifications sent correctly to assigned members and creators.

## 3. Events Deferred
1. **SLA Warning / Overdue Notifications**: 
   - Deferred to FP-18D.2.
   - Reason: There is currently no active global SLA polling scheduler. Implementing a safe, non-spammy cron job specifically for SLA warnings requires a dedicated batch process to avoid table scans and performance degradation on the production database.

## 4. Architectural Implementation Details
* **Recipient Logic**: Reassignments look up `existing.assignedToId` and `data.assignedToId`. Reviews traverse up the creator's user profile to find `teamLeadName` or `reportingManager`. 
* **Self-Notification Prevention**: Checks like `id !== userId` strictly enforce that actors do not get spammed about their own actions.
* **Duplicate Prevention**: Re-saving the same assignee triggers nothing. Workday auto-close relies on a strict single transition (`status = AUTO_CLOSED`), meaning multiple cron runs won't duplicate the notification.
* **Tests Added**: Unit tests expanded to mock `NotificationEventService` globally across the ticket, workday, and scheduler testing suites, explicitly satisfying requirements for Phase 7.

## 5. Next Steps
* Complete the deferred SLA notification engine in FP-18D.2 once a safe polling batch script is confirmed.
