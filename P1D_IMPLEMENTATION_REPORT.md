# P1-D Implementation Report

Status: COMPLETE
Date: 2026-05-27
Branch note: attempted to create a Codex work branch, but local Git ref lock permissions blocked branch creation. Work remained on `stabilize/apex-os-core`.

## What Was Fixed

### FIX-01 Secure Ticket Attachments End-to-End
- Added authenticated attachment proxy/download route:
  - `GET /api/tickets/:id/attachments/:attachmentId/download`
  - `backend/src/modules/operations/tickets/tickets.controller.ts:57`
- Attachment download now resolves through `TicketsService.getAttachmentForDownload`, which first verifies ticket visibility through `TicketAccessService.findAccessibleTicket`.
  - `backend/src/modules/operations/tickets/tickets.service.ts:203`
- Ticket detail and upload responses strip the stored `url` field and return only safe proxy paths.
  - `backend/src/modules/operations/tickets/tickets.service.ts:93`
  - `backend/src/modules/operations/tickets/tickets.controller.ts:126`
- Frontend attachment preview/download now uses authenticated `fetch` with bearer token and blob URLs instead of opening raw stored URLs.
  - `frontend/lib/api.ts:161`
  - `frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx:124`
- New Cloudinary ticket uploads use `type: 'authenticated'` and store an internal `cloudinary:authenticated:*` reference, not a directly browser-openable URL.
  - `backend/src/modules/platform/uploads/uploads.service.ts:37`
  - `backend/src/modules/platform/uploads/uploads.service.ts:100`

### FIX-02 Dashboard Count Convergence
- Dashboard overdue counts now use `TicketTimingService.getTimingState`, not due-date-only logic.
  - `backend/src/modules/platform/dashboard/dashboard.service.ts:26`
  - `backend/src/modules/platform/dashboard/dashboard.service.ts:247`
- Dashboard project totals are now role-scoped.
  - `backend/src/modules/platform/dashboard/dashboard.service.ts:39`
  - `backend/src/modules/platform/dashboard/dashboard.service.ts:57`
- Home metrics now use scoped ticket access and timing-backed overdue values for manager, team lead, admin, and super admin paths.
  - `backend/src/modules/platform/dashboard/dashboard.service.ts:292`
  - `backend/src/modules/platform/dashboard/dashboard.service.ts:310`
  - `backend/src/modules/platform/dashboard/dashboard.service.ts:323`

### FIX-03 Quick Action URL Filter Hydration
- Tickets page now hydrates filter/search/priority/department/assignee/project/date/overdue/my-ticket state from URL params.
  - `frontend/app/(dashboard)/(operations)/tickets/page.tsx:56`
- Ticket list filter changes now update the URL so quick actions, refresh, and back/forward navigation are stable.
  - `frontend/app/(dashboard)/(operations)/tickets/page.tsx:81`
- Overdue quick-action URLs now call backend timing-backed `overdue=true` filtering.
  - `frontend/app/(dashboard)/(operations)/tickets/page.tsx:96`
  - `backend/src/modules/operations/tickets/tickets.service.ts:144`

### FIX-04 SMTP Configuration Consistency
- Chosen architecture: Option A, DB settings are the active SMTP transporter source.
- `EmailService` now loads and reloads SMTP config from persisted `AppSetting` key `smtp`.
  - `backend/src/modules/platform/email/email.service.ts:45`
- Added test email endpoint:
  - `POST /api/settings/email/test`
  - `backend/src/modules/platform/settings/settings.controller.ts:106`
- SMTP password is masked in API responses and legacy mask values are preserved safely during updates.
  - `backend/src/modules/platform/settings/settings.controller.ts:10`
  - `backend/src/modules/platform/settings/settings.controller.ts:84`
- Frontend settings page now has a real Send Test Email action with loading and toast states.
  - `frontend/app/(dashboard)/settings/page.tsx:870`
  - `frontend/app/(dashboard)/settings/page.tsx:898`

### FIX-05 Operational UX Closure
- Dashboard overdue card links now route to `/tickets?overdue=true`, which hydrates correctly and uses backend timing.
  - `frontend/components/home/MetricCards.tsx:42`
  - `frontend/components/home/MetricCards.tsx:49`
  - `frontend/components/home/MetricCards.tsx:58`
- Attachment errors now show clean permission/load messages through the frontend blob fetch path.
- SMTP settings no longer claim test delivery is unavailable.

## Architecture Notes

- No protected architecture services were bypassed.
- `TicketAccessService` remains the authority for ticket visibility.
- `TicketTimingService` remains the authority for overdue/SLA state.
- No parallel role scope system was introduced.
- No parallel ticket timing system was introduced.
- SMTP runtime source was consolidated to DB-backed settings.
- Test runtime keeps production throttling behavior intact, while `NODE_ENV=test` avoids smoke-test self-throttling.

## Tests Added

- `backend/test/unit/p1d.attachment-security.spec.ts`
  - Authorized attachment resolution
  - Cross-scope attachment access blocked
  - Missing/deleted ticket attachment access blocked
  - Stored URL stripped from API response
- `backend/test/unit/p1d.dashboard-consistency.spec.ts`
  - Dashboard overdue metrics use `TicketTimingService`, not due-date-only counts
- `backend/test/unit/p1d.smtp-settings.spec.ts`
  - SMTP transporter loads from DB settings
  - Incomplete persisted SMTP settings fail cleanly

## Deferred

- No redesign work.
- No AI/workflow/calendar/broadcast/task-system expansion.
- No historical attachment storage migration was performed. Current code stops exposing stored URLs, and new Cloudinary uploads are authenticated; if old production Cloudinary URLs were copied before this fix, a provider-level rotation/private migration remains advisable.
