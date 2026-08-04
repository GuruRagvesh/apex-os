# Apex OS — Feature Connection Matrix (2026-08-02)

Compact companion to `APEX_OS_COMPLETE_PROJECT_AUDIT_2026.md` — see that file for full evidence, roadmap, and section-by-section deep audits. This matrix is the quick-reference view.

Legend: 🟢 Connected & real · 🟡 Partial/gap noted · 🔴 Confirmed bug or risk · ⚪ Not built · ❓ Not verified this pass

| Feature | Frontend | Backend | DB Model(s) | Status | Note |
|---|---|---|---|---|---|
| Auth/login | 🟢 | 🟢 | `User`, `Role` | 🟢 | OTP + throttle tested |
| Users | 🟢 | 🟢 | `User` | 🟢 | 4-tier profile visibility confirmed |
| Roles/permissions | 🟢 | 🟢 | `Role`, `UserRoleAssignment` | 🟢 | Fixed hierarchy, not granular RBAC — fine at current scale |
| Departments | 🟢 | 🟢 | `Department` | 🟢 | |
| Department Head | 🟡 | 🟡 | `ManagerDeptAccess` | 🟡 | Derived, not a first-class field; no KRA/KPI attached |
| Teams (Manage) | 🟢 | 🟢 | `Team` | 🟢 | Role-gated in sidebar this session (HR/Manager/Admin/SuperAdmin) |
| My Team | 🟢 | 🟢 | `Team`, `TeamMember` | 🟢 | |
| Team Lead | 🟢 | 🟢 | `Team.teamLeadId` | 🟢 | First-class field, used in approval chain |
| Tickets (core) | 🟢 | 🟢 | `Ticket` | 🟢 | |
| Task/Query/Help | 🟢 | 🟢 | `Ticket.type` + routing fields | 🟢 | Anyone-to-anyone confirmed this session |
| Ticket routing | 🟢 | 🟢 | cross-dept fields | 🟢 | Cache-safe, retry-safe (this session) |
| Ticket lifecycle | 🟢 | 🟢 | `TicketStatus` | 🟢 | Full transition matrix tested |
| Approval/review/rework | 🟢 | 🟢 | `ReviewCycleLog` | 🟢 | 35 dedicated tests |
| Comments | 🟢 | 🟢 | `Comment` | 🟢 | |
| Attachments | 🟢 | 🟢 | `Attachment` | 🟡 | Base64-in-DB fallback if Cloudinary unset — verify config |
| Ticket notifications (in-app) | 🟢 | 🟢 | `Notification` | 🟢 | Correctly per-user WebSocket room |
| Desktop notifications | 🟢 | 🟢 | — | 🟢 | Built this session, graceful fallback |
| Ticket activity/history | 🟢 | 🟢 | `TicketHistory`+`ActivityLog`+`OperationalEvent` | 🟡 | Three overlapping trail systems — works, but redundant |
| Ticket SLA/timing | 🟢 | 🟢 | `Ticket.*DueAt` | 🟢 | Correctly never pauses (by design) |
| Ticket worked-time ledger | 🔴 | 🟢 | `TicketTimeLog` | 🟡 | **Backend fixed this session; no frontend display exists yet** |
| Bulk ticket import | 🟢 | 🟢 | `Ticket` | 🟢 | Transactional all-or-nothing |
| Projects | 🟢 | 🟢 | `Project` | 🟡 | **Single department only — not many-to-many** |
| Project members | 🟢 | 🟢 | `ProjectMember` | 🟢 | |
| Project stages/milestones | 🔴 | 🟢 | `ProjectStage` | 🟡 | **Backend-only — fully built, zero frontend UI** |
| Kanban board | 🟢 | 🟢 | `Ticket.status` | 🟢 | |
| Workday | 🟢 | 🟢 | `WorkSession` | 🟢 | |
| Breaks | 🟢 | 🟢 | `BreakLog` | 🟢 | Now correctly pauses ticket ledger too |
| Auto-close/idle | 🟢 | 🟢 | `WorkSession` | 🟢 | |
| Leave | 🟢 | 🟢 | `LeaveRequest` | 🟢 | Confirmed correctly scoped this pass |
| Calendar | ❓ | ❓ | — | ❓ | Route exists (149 lines), not deep-read |
| Analytics | 🟢 | 🟢 | multiple aggregates | 🟡 | 2 ranking queries return empty placeholder arrays |
| Dashboard | 🟢 | 🔴 | multiple | 🔴 | **`getApprovalWorkload()` — confirmed unscoped, company-wide leak** |
| Activity log (admin) | 🟢 | 🟢 | `OperationalEvent` | 🟡 | Substantial, not deep-read this pass |
| Settings | ❓ | 🟢 | `AppSetting` | ❓ | Large page (1671 lines), not deep-read |
| AI (priority/summary/suggestions/digest) | 🟢 | 🟢 | — | 🟢 | **Real GPT-4o-mini, confirmed this pass, not a stub** |
| WebSocket/live updates | 🟢 | 🔴 | — | 🔴 | **2 of 4 events broadcast unscoped to every client** |
| Reports/export | 🟢 | 🟢 | `Ticket` | 🟢 | `/reports` cleanly redirects to `/analytics` |
| Backup (OneDrive vault) | 🟢 | 🟢 | — | 🟡 | Code confirmed correct; known 404 is a config issue |
| Seed scripts | N/A | 🔴 | `Project`, `User` | 🔴 | **No production guard — deletes real data unconditionally** |
| CRM/sales | ⚪ | ⚪ | ⚪ | ⚪ | Confirmed absent, zero code found anywhere |
| HRMS/KRA/KPI | 🟡 | 🟡 | ⚪ | ⚪ | People/attendance/AI side strong; performance layer 0% built |

## Confirmed bugs/risks requiring action (ranked)

| Rank | Item | Severity | File |
|---|---|---|---|
| 1 | Seed script deletes real data with no environment guard | **Critical** | `backend/prisma/seed.ts` |
| 2 | Dashboard approval-workload count has no department scope | **High** | `backend/src/modules/platform/dashboard/dashboard.service.ts` (`getApprovalWorkload`) |
| 3 | WebSocket ticket broadcasts unscoped to all connected clients | **Medium-High** | `backend/src/modules/platform/gateway/events.gateway.ts` |
| 4 | Project hard-delete has no linked-ticket safety check | **Medium** | `backend/src/modules/operations/projects/projects.service.ts` (`remove`) |
| 5 | Ticket worked-time backend fixed, no frontend display | **Low-Medium** | Frontend gap only |
| 6 | Project stages backend-complete, no frontend UI | **Medium** | Frontend gap only |
| 7 | Attachment fallback stores files as base64 in Postgres if Cloudinary unconfigured | **Medium (config-dependent)** | `backend/src/modules/platform/uploads/uploads.service.ts` |
| 8 | 5 pre-existing failing backend test suites (clock-dependent + 1 stale call signature) | **Low** | See main audit Section 11 |
