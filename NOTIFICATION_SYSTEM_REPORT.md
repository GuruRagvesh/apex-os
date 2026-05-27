# Notification System Report — P1-A Product Stability

**Date:** 2026-05-27  
**Status:** Completed & Verified  

---

## Overview

A centralized `NotificationEventService` (`backend/src/modules/operations/notifications/notification-event.service.ts`) has been implemented to handle all in-app notifications and real-time Socket.io emissions. It checks user notification preferences and timezone-aware quiet hours before delivering alerts.

All legacy direct database writes and raw socket emissions inside business services have been refactored to route through this centralized pipeline.

---

## 1. Core Engine Features

- **Preference Filtering**: Resolves user notification preferences (via `UsersService.getPreferences`). If a preference key (e.g. `commentAdded`, `assignedTicket`) is disabled, the notification is discarded and no DB record is created.
- **Timezone-Aware Quiet Hours**:
  - Checks user-configured quiet hours (`quietFrom`, `quietTo`) in the user's preferred timezone (default `Asia/Kolkata`).
  - Correctly parses overlapping midnight quiet hours (e.g., `22:00` to `08:00`).
  - If the user's current local hour is within quiet hours, the notification is written to the database (for history retrieval) but **suppresses the real-time Socket.io emission** to avoid disturbance.
- **In-App Bell Deliveries**: Delivers real-time Socket.io emissions using `EventsGateway.emitNotificationToUser` if the user is active, outside quiet hours, and has `inApp` enabled.

---

## 2. Refactored Integration Points

The following event points have been wired to use `NotificationEventService`:

### Tickets Module (`tickets.service.ts`)
- **Ticket Creation & Assignment**: Dispatches `assignedTicket` notification to each primary and secondary assignee.
- **Ticket Resolution (DONE / CLOSED)**: Dispatches `ticketResolved` notification to the ticket creator.
- **Status Changes**: Dispatches `statusChanged` notifications (e.g., ticket approved/rejected).

### Comments Module (`comments.service.ts`)
- **Comment Creation**: Dispatches a `commentAdded` notification to the ticket owner and all assignees (except the comment author).

### Leave Module (`leave.service.ts`)
- **Leave Application**: Dispatches a `teamLeaveApply` notification to all active department managers/leads when a team member applies for leave.
- **Leave Decisions**: Dispatches `leaveApproved` or `leaveRejected` notifications to the leave applicant.
- **Leave Cancellations**: Dispatches a `teamLeaveApply` cancellation notification to all department managers.

---

## 3. Test Coverage

A new unit test suite has been created at `backend/test/unit/p1.notification-event.spec.ts` covering:
- **Quiet Hours Time Calculation**: Verifies correctness across both standard and midnight-crossing quiet ranges.
- **Timezone Mapping**: Ensures correct mapping of UTC timestamps to Indian Standard Time (IST) or other timezones.
- **Preference Suppression**: Verifies that notifications are blocked if user preferences are disabled.
- **Quiet Hours Suppression**: Verifies that database records are still written, but Socket.io emissions are correctly suppressed.

All 56 unit tests in the backend pass successfully.
