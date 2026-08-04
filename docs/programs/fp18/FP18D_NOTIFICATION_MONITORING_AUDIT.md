# FP18D Notification Monitoring Audit

## 1. Current Architecture
- **Model Fields (`Notification`)**: `id`, `userId`, `title`, `message`, `type` (`INFO`, `SUCCESS`, `WARNING`, `ERROR`), `isRead`, `link`, `entityId`, `entityType`, `createdAt`.
- **Notification Enums**: Prisma enum `NotificationType` handles severity levels.
- **Creation Path**: The application uses `NotificationEventService.sendNotification(...)` to persist the record and immediately invoke `EventsGateway.emitNotificationToUser(...)` for real-time socket delivery.
- **Recipient Selection**: Handled explicitly by caller services, ensuring no arbitrary spam.
- **Preferences & Quiet Hours**: Supported out of the box natively by `NotificationEventService.isInQuietHours()` using user timezones, avoiding intrusive late-night pings.
- **Frontend UI**: Integrated into `topbar.tsx`. Connects via WebSockets to auto-increment unread count, displays a drop-down list of clickable notifications, and provides a "mark all read" function.

## 2. Event Coverage Audit
### Tickets (`tickets.service.ts` & `comments.service.ts`)
| Event | Current Status | Notes |
|---|---|---|
| Assigned (on creation) | Covered | Correctly notifies assignee. |
| Reassigned (during update) | **Missing** | Needs to notify new assignee (and optionally old). |
| Comment Added | Covered | Correctly notifies creator, assignee, and additional assignees. |
| Submitted to Review | **Missing** | Reviewer doesn't get notified when ticket hits `REVIEW`. |
| Approved | Covered | Notifies assignee of successful resolution. |
| Rejected / Rework | Covered | Notifies assignee of required fixes. |
| Blocked | Covered | Notifies assignee and creator. |
| Unblocked | Covered | Notifies assignee of clearance. |
| SLA Warning / Overdue | **Missing** | No scheduler currently pushes SLA pings. |

### Workday (`workday.service.ts` & `scheduler.service.ts`)
| Event | Current Status | Notes |
|---|---|---|
| Workday Auto-Closed | **Missing** | Scheduler silently closes logs without user notification. |
| Resumed after Auto-Close | **Missing** | User isn't alerted if they resume a stale session. |

### Hierarchy (`change-requests.service.ts`)
| Event | Current Status | Notes |
|---|---|---|
| Request Created | Covered | Notifies target approver. |
| Approved / Escalated | Covered | Notifies requester (if final) or next approver. |
| Rejected | Covered | Notifies requester. |

## 3. Findings & Risks
The foundation of the notification engine is robust, providing real-time socket updates and quiet hours logic. The main gap lies purely in missing invocation hooks within `tickets.service.ts` (reassignment, review requests) and `scheduler.service.ts` (auto-close alerts). Adding these hooks securely satisfies the Phase 1 goals.
