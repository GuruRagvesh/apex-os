# APEX OS — FEATURE STATUS MATRIX (COMPACT)
**Date:** 2026-06-02 | `main` @ `7f1c8fb`

Status: ✅ WORKING · 🟡 PARTIAL · 🔴 BROKEN · 🟣 UI_ONLY · 🔵 BACKEND_ONLY · ⚪ PLACEHOLDER · ⚠️ RISKY · ❓ UNKNOWN

| # | Feature | Module | Status | Risk |
|---|---|---|---|---|
| 1 | Login (email/password) | Auth | ✅ | P0 |
| 2 | JWT 24h expiry | Auth | ✅ | — |
| 3 | Forgot-password OTP | Auth | 🟡 needs Resend | P1 |
| 4 | Reset password | Auth | ✅ | P1 |
| 5 | Force password change | Auth | ✅ | P2 |
| 6 | Login rate limiting | Auth | ✅ | P1 |
| 7 | Logout (stateless) | Auth | 🟡 no blacklist | P2 |
| 8 | User list (role-scoped) | Users | ✅ | P2 |
| 9 | Create/Edit/Deactivate user | Users | ✅ | P2 |
| 10 | Reset user password (admin) | Users | ✅ | P2 |
| 11 | Profile 5-tab page | Users | ✅ | P2 |
| 12 | Avatar/photo upload | Users | 🟡 base64, no size cap | P2 |
| 13 | Role assignment | Roles | ✅ | P2 |
| 14 | Department CRUD | Depts | ✅ | P2 |
| 15 | Employee documents | Users | 🟡 needs Cloudinary | P2 |
| 16 | Hierarchy change-requests | Approvals | ✅ | P2 |
| 17 | Create ticket | Tickets | ✅ | P1 |
| 18 | Ticket list + filters | Tickets | ✅ | P1 |
| 19 | Ticket detail | Tickets | ✅ | P1 |
| 20 | Status workflow | Tickets | ✅ | P0 |
| 21 | Review→Rework→InProgress | Tickets | ✅ | P1 |
| 22 | Self-assign self-approval | Tickets | ✅ | P2 |
| 23 | Comments | Tickets | ✅ | P2 |
| 24 | Attachments | Tickets | 🟡 base64 fallback | P1 |
| 25 | History/audit | Tickets | ✅ | P2 |
| 26 | Delete ticket | Tickets | ✅ | P2 |
| 27 | Edit modal | Tickets | ✅ | P2 |
| 28 | Export CSV | Tickets | ✅ | P3 |
| 29 | SLA timer (execution) | Tickets | ✅ | P1 |
| 30 | SLA timer (review) | Tickets | ✅ | P1 |
| 31 | Overdue detection | Tickets | ✅ | P1 |
| 32 | Blocked ticket workflow | Tickets | ✅ | P1 |
| 33 | Rework clocks + ratings | Tickets | ✅ | P1 |
| 34 | Workday↔ticket timer | Tickets | ✅ | P1 |
| 35 | Custom subtype text | Tickets | ✅ | P3 |
| 36 | Ticket departmentId populated | Tickets | 🟡 **263/263 NULL** | P1 |
| 37 | Kanban board | Kanban | ✅ | P2 |
| 38 | Drag-and-drop | Kanban | ❓ manual QA | P2 |
| 39 | RBAC on drag | Kanban | ✅ backend | P2 |
| 40 | Column counts | Kanban | ✅ | P3 |
| 41 | Project list | Projects | ✅ | P2 |
| 42 | Create project | Projects | ✅ | P2 |
| 43 | Project detail (CUID) | Projects | ✅ | P2 |
| 44 | Edit project | Projects | ✅ | P2 |
| 45 | Members add/remove/role | Projects | ✅ | P2 |
| 46 | Linked tickets | Projects | ✅ | P2 |
| 47 | Stages CRUD/reorder | Projects | 🔵 no UI | P3 |
| 48 | Archive/restore | Projects | 🔵 no UI | P3 |
| 49 | Project activity | Projects | ✅ | P3 |
| 50 | Apply leave | Leave | ✅ | P1 |
| 51 | Approve (hierarchy) | Leave | ✅ | P1 |
| 52 | Reject leave | Leave | ✅ | P1 |
| 53 | Cancel leave | Leave | ✅ | P2 |
| 54 | Balance tracking | Leave | ✅ | P1 |
| 55 | Leave stats | Leave | ✅ | P2 |
| 56 | Can't approve own/higher | Leave | ✅ | P1 |
| 57 | Leave calendar | Calendar | ✅ | P2 |
| 58 | Start workday | Workday | ✅ | P1 |
| 59 | Breaks (multi-type) | Workday | ✅ | P1 |
| 60 | Resume from break | Workday | ✅ | P1 |
| 61 | End workday | Workday | ✅ | P1 |
| 62 | Idle detection | Workday | 🟡 manual QA | P2 |
| 63 | Session recovery | Workday | ✅ | P1 |
| 64 | Auto-close cron | Workday | ⚠️ Render keepalive | P1 |
| 65 | Session history (grouped) | Workday | ✅ | P2 |
| 66 | Team live status | Workday | ✅ | P2 |
| 67 | Corrupted sessions cleanup | Workday | 🟡 **55 in prod** | P1 |
| 68 | Workday policy | Workday | ✅ | P2 |
| 69 | In-app bell + unread | Notifications | ✅ | P2 |
| 70 | Real-time Socket.IO | Notifications | 🟡 manual QA | P2 |
| 71 | Mark read / read-all | Notifications | ✅ | P2 |
| 72 | Delete notification | Notifications | ✅ | P3 |
| 73 | Event-driven notifications | Notifications | ✅ | P2 |
| 74 | Email notifications | Notifications | 🟡 needs Resend | P2 |
| 75 | Role-aware home | Dashboard | ✅ | P1 |
| 76 | KPI capsules | Dashboard | ✅ | P2 |
| 77 | Critical alerts | Dashboard | ✅ | P2 |
| 78 | Workday bar | Dashboard | ✅ | P1 |
| 79 | Activity feed | Dashboard | ✅ | P2 |
| 80 | Team pressure/workload | Dashboard | ✅ | P2 |
| 81 | Analytics 7-tab | Analytics | ✅ | P2 |
| 82 | Command center | Analytics | ✅ | P2 |
| 83 | Employee/Reviewer metrics | Analytics | ✅ | P2 |
| 84 | Manager rankings | Analytics | 🟡 placeholder `[]` | P3 |
| 85 | SLA/Rework top-lists | Analytics | 🟡 placeholder `[]` | P3 |
| 86 | Company settings | Settings | ✅ | P2 |
| 87 | Leave policy settings | Settings | ✅ | P2 |
| 88 | SLA settings (DB) | Settings | ✅ | P1 |
| 89 | Workday policy settings | Settings | ✅ | P2 |
| 90 | SMTP settings | Settings | 🟡 Resend-first | P2 |
| 91 | Email test | Settings | 🟡 needs provider | P2 |
| 92 | Theme settings | Settings | ✅ | P3 |
| 93 | Task types CRUD | Settings | ✅ | P2 |
| 94 | Activity log page | Activity | ✅ | P2 |
| 95 | OperationalEvent logging | Activity | ✅ | P2 |
| 96 | AI suggest/summarize/digest | AI | ⚪ needs OPENAI | CONFIG |
| 97 | Reports page (redirect) | Reports | 🟣 → /analytics | P3 |
| 98 | `GET /task-types` | Security | ✅ **JWT guard added** | P1 |
| 99 | Team request | Team | 🟡 thin | P3 |

**Totals:** ✅ 64 · 🟡 18 · 🔴 0 · 🟣 1 · 🔵 2 · ⚪ 1 · ⚠️ 2 · ❓ 1 (some overlap — see master for canonical 81-feature roll-up)
