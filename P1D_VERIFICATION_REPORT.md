# P1-D Verification Report

Status: PASSED
Date: 2026-05-27

## Command Verification

| Area | Command | Result |
| --- | --- | --- |
| Backend type-check | `npx.cmd tsc --noEmit` | PASS |
| Backend build | `npm.cmd run build` | PASS |
| Backend tests | `npm.cmd test -- --runInBand` | PASS, 13 suites / 96 tests |
| Backend lint | `npm.cmd run lint` | PASS with warnings only |
| Frontend type-check | `npx.cmd tsc --noEmit` | PASS |
| Frontend build | `npm.cmd run build` | PASS |
| Frontend lint | `npm.cmd run lint` | PASS with warnings only |
| Prisma validate | `npx.cmd prisma validate` | PASS |
| Prisma migrate status | `npx.cmd prisma migrate status` | PASS, database schema up to date |

Note: PowerShell blocks `npx.ps1` on this machine, so Windows-safe `npx.cmd` / `npm.cmd` were used.

## Security Verification

| Check | Evidence | Result |
| --- | --- | --- |
| Attachment download requires auth | `TicketsController.downloadAttachment` is under `@UseGuards(JwtAuthGuard)` on the controller | PASS |
| Attachment download inherits ticket visibility | `TicketsService.getAttachmentForDownload` calls `TicketAccessService.findAccessibleTicket` before loading attachment | PASS |
| Cross-department/direct-ID attachment access blocked | `p1d.attachment-security.spec.ts` cross-scope test | PASS |
| Deleted/missing ticket attachment access blocked | `p1d.attachment-security.spec.ts` missing ticket test | PASS |
| Raw stored attachment URL removed from API response | `sanitizeAttachmentForResponse` and unit test | PASS |
| New Cloudinary uploads are not public browser URLs | `UploadsService` uses `type: 'authenticated'` and internal reference | PASS |

Signed URL expiry test: not applicable, because signed Cloudinary URLs are not exposed to the client. The backend signs/fetches server-side only.

## Count Consistency Verification

| Check | Evidence | Result |
| --- | --- | --- |
| Dashboard overdue uses `TicketTimingService` | `DashboardService.countOverdueTickets` + `p1d.dashboard-consistency.spec.ts` | PASS |
| Dashboard removes dueDate-only overdue counts | unit assertion checks dashboard ticket count calls do not contain `dueDate` overdue filters | PASS |
| Dashboard project counts are scoped | `DashboardService.buildProjectScope` applied in overview and metrics | PASS |
| Ticket overdue list uses backend timing | `TicketsService.findAll` applies timing filter for `overdue=true` | PASS |
| Dashboard overdue links hydrate into timing-backed ticket list | metric links use `/tickets?overdue=true`, tickets page sends `overdue=true` | PASS |

## Quick Action URL Hydration

| Check | Evidence | Result |
| --- | --- | --- |
| `?filter=due-today` hydrates due-date range | tickets page parses quick filter and sets `dueAfter` / `dueBefore` | PASS |
| `?priority=HIGH` hydrates priority | tickets page reads `priority` query param | PASS |
| `?overdue=true` hydrates overdue filter | tickets page reads `overdue=true` and sends backend `overdue=true` | PASS |
| URL is refresh-safe/shareable | state is hydrated from `useSearchParams` | PASS |
| Filter changes preserve browser navigation | filter actions call `router.replace` with query params | PASS |

## SMTP Verification

| Check | Evidence | Result |
| --- | --- | --- |
| Runtime source is DB setting | `EmailService.ensureTransporter` reads `appSetting` key `smtp` | PASS |
| SMTP updates preserve masked password | `SettingsController.updateSmtp` handles mask values | PASS |
| Test endpoint exists | `POST /settings/email/test` | PASS |
| Frontend button exists with loading/error state | `SmtpSection.testEmail` mutation | PASS |
| Failure is graceful | `sendEmail` logs and returns false; `sendTestEmail` returns clean 400 | PASS |

## Role Visibility Verification

- Attachment access is tied to ticket visibility, so users inherit existing `TicketAccessService` role and scope rules.
- Dashboard tickets and overdue metrics use `TicketAccessService.buildTicketWhereForUser`.
- Dashboard project metrics use role-based project scope aligned to current project rules.
- SMTP read/update/test remains `SUPER_ADMIN` only.

## Lint Warnings

Both lint scripts exit successfully. Remaining warnings are pre-existing/no-error lint hygiene issues, plus one expected frontend warning for blob image preview using `<img>` instead of `next/image`.
