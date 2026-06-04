# FP18D Notification Monitoring Issue Register

## Closed Issues (Fixed in FP-18D)
1. **[TKT-N-001] Missing Ticket Reassignment Notification**
   - **Issue:** Changing `assignedToId` in a ticket update silently changed owners, causing old assignees to wonder where their ticket went, and new assignees not knowing they got assigned.
   - **Fix:** In `tickets.service.ts` `update()`, added conditional `notificationEventService.sendNotification` calls to explicitly notify both the new and old assignees, provided the actor is not the assignee.
   - **Status:** CLOSED

2. **[TKT-N-002] Missing "Ready for Review" Notification**
   - **Issue:** When a ticket transitioned from `IN_PROGRESS` to `REVIEW`, the logical approver (Team Lead / Manager) was not pinged, causing ticket stalls.
   - **Fix:** In `tickets.service.ts` `update()`, mapped the reviewer via the ticket creator's `teamLeadName` or `reportingManager`, and dispatched a specific `REVIEW` notification.
   - **Status:** CLOSED

3. **[TKT-N-003] Missing Auto-Close Notification**
   - **Issue:** The midnight cron gracefully closed stale workday sessions but left the user unaware that their timer stopped, sometimes leading them to believe time was still tracking.
   - **Fix:** In `scheduler.service.ts` `autoCloseMidnightSessions()`, triggered an alert for `session.userId` upon successful auto-close.
   - **Status:** CLOSED

4. **[TKT-N-004] Missing Resume Notification**
   - **Issue:** Users starting work and picking up an `AUTO_CLOSED` session had no visual or system confirmation that their fragmented time was being grouped properly.
   - **Fix:** In `workday.service.ts` `startWork()`, tested for previous `AUTO_CLOSED` state and notified the user of successful session resumption.
   - **Status:** CLOSED

## Pending Issues (Deferred to FP-18D.2)
1. **[TKT-N-005] SLA Overdue Notifications (Pending Scheduler Design)**
   - **Issue:** Tickets breaching their SLA currently show red in the UI via `ticket-timing.service.ts`, but do not actively ping the assignee/manager.
   - **Reason for Deferral:** There is no existing clean batch scheduler. Writing a naive periodic cron would cause full-table scanning and severe DB overhead. Deferred to next phase for a queue-based or materialized-view approach.
   - **Status:** PENDING
