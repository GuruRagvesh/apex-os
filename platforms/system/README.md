# platforms/system/

Platform services: delivery, storage, transport, scheduling, audit, health and
the public site.

**Status: Phase 0 — empty scaffold.** Live code remains in
`backend/src/modules/platform/` and `backend/src/modules/operations/notifications/`.
Migrates in **Phase 2**, except `websocket` (blocked on BUG-H) and the
scheduler split (Phase 5, with attendance).

## Planned components

| Component | Scope |
| --- | --- |
| `notifications/` | In-app and desktop notification delivery. |
| `email/` | Transactional email via Resend. |
| `uploads/` | File and attachment storage (Cloudinary). |
| `events/` | Operational event bus. |
| `audit/` | `OperationalEvent` audit trail and the activity log screen. |
| `websocket/` | Socket.IO gateway. |
| `scheduler/` | **Generic cron infrastructure only.** |
| `automation/` | Rule-driven automated actions. |
| `health/` | Health checks and readiness endpoints. |
| `backup/` | Backup vault integration. |
| `public-site/` | Landing page, privacy, terms. |

## `scheduler` holds no domain logic

This is the decision that keeps the dependency graph acyclic. `system/scheduler`
owns cron registration, scheduling utilities and job-run logging. It owns **no
jobs**.

Each scheduled job lives with the feature it acts on:

| Job | Owner |
| --- | --- |
| `autoCloseMidnightSessions` | `workforce/attendance/workday/backend/jobs/` |
| `autoLogoutInactive` | `workforce/attendance/workday/backend/jobs/` |
| `workdayEndReminder` | `workforce/attendance/workday/backend/jobs/` |
| `setLeaveStatuses` | `workforce/leave/applications/backend/jobs/` |
| `checkScheduledTickets` | `operations/tickets/lifecycle/backend/jobs/` |

Today `scheduler.service.ts` imports `WorkdayService` directly. Splitting the
jobs out removes that `system → workforce` edge entirely, rather than papering
over it with a contract.

## `public-site` is unauthenticated

The landing page, privacy policy and terms are real screens with no platform
affiliation. They live here rather than in `apps/web` so that page
implementation does not leak into the composition shell.

## Dependency direction

```
allowed:    system/ → shared/, database/client
allowed:    system/ → core/ (public contracts, e.g. user lookup for delivery)
forbidden:  system/ → workforce/, operations/, intelligence/, business/
forbidden:  system/ → apps/
```

System services are consumed by other platforms, not the reverse. A feature
publishes an event; `system/notifications` delivers it. The feature does not
import the delivery mechanism, and the delivery mechanism does not import the
feature.

## Open security issue carried into migration

⚠️ **BUG-H** — `events.gateway.ts` broadcasts `ticket:created` and
`ticket:status_changed` to every connected socket via a bare `server.emit(...)`,
unlike `notification:new` and `leave:status_changed`, which correctly scope to
`user:{id}` rooms. **Fix this on its own branch before migrating `websocket`,**
so the fix is reviewable in isolation rather than buried in a move.
