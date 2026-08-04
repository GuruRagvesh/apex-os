# Apex OS Feature Status Board

Audit date: 2026-05-29  
Source detail: `docs/SYSTEM_FEATURE_AUDIT.md`

## Classification Summary

```text
Total features audited: 109
Complete real: 56
Complete local-only: 5
Partial working: 14
UI-only namesake: 3
Backend-only unused: 6
Broken: 5
Security risk: 6
Misleading: 5
Intentionally not supported: 5
Future roadmap: 4
```

## Master Board

| Priority | Module | Feature | Status | Risk | Effort | Recommended Action |
|---|---|---|---|---|---|---|
| P0 | Realtime / Socket.IO | Ticket created/status socket broadcasts | G | Cross-scope ticket metadata can be emitted to every connected socket. | M | FIX_NOW |
| P0 | AI Features | Ticket-specific suggestions | G | Authenticated users can request AI context for tickets without `TicketAccessService` authorization. | M | FIX_NOW |
| P1 | AI Features | Ticket summaries and daily digest | G | Manager/admin summaries and digest queries are global instead of recipient-scoped. | M | FIX_NOW |
| P1 | Projects | Project detail/edit/delete/member management | F | Controller UUID pipes reject Prisma cuid IDs, breaking core project workflows. | XS | FIX_NOW |
| P1 | Notifications | Mark single read and delete | F | Controller UUID pipes reject Prisma cuid notification IDs. | XS | FIX_NOW |
| P1 | Authentication | Forgot-password OTP | G | OTP is in memory and not sent through SMTP; unknown-email response leaks account existence. | M | FIX_NOW |
| P1 | User Management | Admin role/status/reset/deactivate hierarchy | G | Admin can target equal or higher privilege accounts unless blocked elsewhere. | M | FIX_NOW |
| P1 | Task Types | Public `GET /task-types` | G | Internal task taxonomy is readable without authentication. | XS | FIX_NOW |
| P1 | Tickets / Tasks | Custom ticket type | F | UI sends unsupported enum/custom text to Prisma ticket type field. | S | FIX_NOW |
| P1 | Settings | Ticket preferences | H | Auto-assign/default priority are persisted but not applied to ticket creation. | S | FIX_NOW |
| P1 | Team Management | Request member addition | D | UI promises approval/rejection, but backend only sends a notification and stores local pending state. | M | NEEDS_BUSINESS_DECISION |
| P1 | Projects | Manager project creation | C | UI needs admin-only departments API, so manager create flow can fail. | S | FIX_NEXT |
| P1 | Authentication | Super admin team-lead mode | H | UI implies scoped team-lead operation while backend remains full super-admin. | M | NEEDS_BUSINESS_DECISION |
| P2 | Departments | Department create/update/delete logging | C | Org-structure changes are not written to OperationalEvent. | S | FIX_NEXT |
| P2 | Employee Documents | Document verification logging | C | Verification/rejection logs legacy ActivityLog only. | S | FIX_NEXT |
| P2 | Activity / Audit | Split legacy and operational audit trails | C | Some sensitive actions are absent from the primary `/events` audit feed. | M | FIX_NEXT |
| P2 | Leave Management | Cancel pending leave | E | Backend/API/client exist but no visible UI action exists. | S | FIX_NEXT |
| P2 | Leave Policy | Public holiday calendar | C | Leave balance has hardcoded 2026 holidays, not configurable policy data. | M | FIX_NEXT |
| P2 | Workday / Attendance | Idle/resume logging and state guards | C | Attendance events persist, but OperationalEvent logging is incomplete. | S | FIX_NEXT |
| P2 | Attendance | Dedicated attendance page | C | Records and API exist, but no first-class attendance route exists. | M | NEEDS_BUSINESS_DECISION |
| P2 | Calendar | Leave drilldown | C | Ticket drilldown is real; leave has no dedicated detail route. | S | FIX_NEXT |
| P2 | Public Site | Public landing claims/stats | H | Hardcoded employee/department counts and AI claims overstate implementation. | XS | FIX_NEXT |
| P2 | AI / Marketing | Smart assignment / agents | D | Claims exist, but no assignment engine or agent workflow exists. | XS | MOVE_TO_ROADMAP |
| P2 | Task Types | Admin task-type edit/audit | C | Create/delete visible, update API exists, audit logging missing. | S | FIX_NEXT |
| P3 | Ticket Attachments | Cloudinary remote object cleanup | C | DB row delete exists; remote storage cleanup was not found. | S | DOCUMENT_ONLY |
| P3 | Ticket Comments | Edit/delete comments | E | Backend exists, but UI does not expose edit/delete. | XS | DOCUMENT_ONLY |
| P3 | Analytics / Reports | `/reports` route | C | Redirect only; no separate reports product. | XS | DOCUMENT_ONLY |
| P3 | Projects | Project deadlines on calendar | I | `Project.endDate` exists but calendar intentionally excludes projects. | S | DOCUMENT_ONLY |
| P3 | Exports | Non-ticket exports | I | Only ticket CSV export exists. | M | MOVE_TO_ROADMAP |
| P3 | Settings | Appearance preferences | B | Correctly local/device-scoped; company defaults persist. | XS | KEEP |
| P3 | Auth | Welcome flow | H | Local-only flow works; copy includes unsupported AI claims. | XS | FIX_NEXT |
| P3 | Static Pages | Privacy and terms | B | Static content exists; legal correctness not audited. | S | DOCUMENT_ONLY |
| Roadmap | Future Platform | CRM, workflow builder, marketplace, mobile app | J | No route/controller/model exists. | XL | MOVE_TO_ROADMAP |

## Keep

| Module | Features |
|---|---|
| Authentication | Login, JWT handling, invalid credential rejection, forced password change, protected API routes. |
| Tickets | Scoped list/detail/create/edit/assign/status/review/block/SLA/attachments/history/kanban/export. |
| Leave | Apply, scoped lists, needs-action, approve/reject, balance, overlap validation, calendar mapping. |
| Workday | Start/end/break/resume core persistence, team live status scope, dashboard status. |
| Dashboard / Analytics | Scoped cards, previews, charts, ticket export, honest partial-failure handling. |
| Settings | Company, leave policy, SLA, SMTP, notification preferences, appearance local-only behavior. |
| Activity | Operational event page and scoped event visibility, with known logging gaps separated. |

## Fix Now

1. Scope socket ticket events or stop broadcasting ticket payloads globally.
2. Add ticket access checks before AI ticket suggestions.
3. Scope AI summaries/digests per requester or recipient.
4. Remove `ParseUUIDPipe` from project cuid endpoints.
5. Remove `ParseUUIDPipe` from notification cuid endpoints.
6. Wire forgot-password OTP to email delivery and remove user enumeration.
7. Enforce role hierarchy for admin user mutations.
8. Guard `GET /task-types`.
9. Fix or remove custom ticket type.
10. Apply or relabel ticket preferences.

## Disable Or Remove Namesakes

| Feature | Recommended action |
|---|---|
| Team member request approval UI | DISABLE_UI or implement real request model, approval, and status. |
| Smart assignment / AI agents copy | REMOVE_NAMESAKE until assignment engine exists. |
| Super admin team-lead mode claims | Relabel as local view mode or implement scoped impersonation. |
| Public hardcoded employee/department stats | Remove or source from real public-safe data. |

## Move To Roadmap

| Feature | Reason |
|---|---|
| CRM | No current route/API/model. |
| Workflow builder | No current route/API/model. |
| Marketplace | No current route/API/model. |
| Mobile app | No current route/API/model. |
| Non-ticket exports | Not currently built. |
| Project deadlines on calendar | Explicitly unsupported by current calendar mapping. |

## Final Readiness Verdict

Apex OS is operationally real in its core ticket, leave, workday, dashboard, settings, attachments, calendar, notification, and activity foundations. It should not be treated as production-smoke-ready until the P0/P1 board is resolved. The highest-risk truth is not missing UI polish; it is cross-scope data exposure through realtime/AI paths and several broken cuid endpoints that turn visible workflows into failing workflows.
