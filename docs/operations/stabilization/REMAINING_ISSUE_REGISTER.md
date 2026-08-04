# REMAINING ISSUE REGISTER
**Apex OS — Post Fix-Pack 9**
**Date:** 2026-05-30

---

## P0 — CRITICAL BLOCKERS (Must fix before any pilot)

| ID | Module | Issue | Evidence | Fix Action |
|---|---|---|---|---|
| P0-001 | Auth | No post-migration login verification — new laptop, new DB connection | `DATABASE_URL` is real but no login has been confirmed on new machine | Run backend + frontend, log in once |
| P0-002 | Deployment | Production smoke test not run after stabilization | `render.yaml` present, `dist/main.js` present, but live URL not verified | Deploy to Render, hit `/api/health`, confirm 200 |
| P0-003 | Tickets | Blocked ticket UI missing in ticket detail page | `block`/`BLOCKED`/`unblock` search returned 0 matches in `[id]/page.tsx`; backend endpoints exist | Add block/unblock action buttons to ticket detail for Manager+ roles |

---

## P1 — HIGH PRIORITY (Must fix before controlled pilot)

| ID | Module | Issue | Evidence | Fix Action |
|---|---|---|---|---|
| P1-001 | Attachments / Storage | Cloudinary env vars not confirmed present — silent upload skip | `UploadsService` logs warning if vars absent; `console.warn` only, no user error | Add `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` to `.env` OR surface error to user on upload attempt |
| P1-002 | SMTP | Email delivery unverified — transporter never initialized without SMTP config in DB | `email.service.ts` only creates transporter after reading from `AppSetting`; no SMTP saved on fresh install | Test SMTP via `POST /settings/email/test` after saving settings |
| P1-003 | Forget/Reset Password | No frontend UI page for forgot/reset password flow | `POST /auth/forgot-password` and `/auth/reset-password` exist; no page in `(auth)` folder | Build `(auth)/forgot-password/page.tsx` |
| P1-004 | Kanban | Drag-drop status mutation not verified wired | `PATCH /tickets/:id/status` exists; `@dnd-kit` present; onDrop handler not confirmed to call API | Verify `onDragEnd` handler calls `ticketsApi.updateStatus()` |
| P1-005 | Workday | Idle detection loop in production unverified | `useIdleDetection.ts` hook exists; `POST /workday/idle` endpoint present; no integration test | Manual test: leave browser idle, confirm idle event fires |
| P1-006 | Notifications | Socket.IO push unverified post-migration | `events.gateway.ts` JWT-authenticated; `useSocket.ts` present; no live test | Start both servers, trigger action, confirm notification appears in UI |
| P1-007 | Leave Balance | Balance display not verified against real leave data | `GET /leave/balance` exists; frontend renders balance; DB calculation unverified with real data | Submit and approve test leave, verify balance decrements |
| P1-008 | Tickets Export | Export button/trigger not confirmed in ticket list UI | `GET /tickets/export` endpoint exists; no export button found in page inspection | Add export button to tickets list page OR confirm it exists |

---

## P2 — MEDIUM PRIORITY (Fix before full rollout)

| ID | Module | Issue | Evidence | Fix Action |
|---|---|---|---|---|
| P2-001 | Projects | Activity feed in project detail fetches all 250 events and filters client-side | `eventsApi.getAll({ limit: 250 })` in project detail page | Add `projectId` filter param to `GET /events` endpoint |
| P2-002 | Departments | Manager multi-department access (`ManagerDeptAccess` model) not verified in UI | `ManagerDeptAccess` model in Prisma schema; `access-policy.service.ts` exists; no UI confirmed | Verify or build manager dept assignment UI |
| P2-003 | Team Requests | `POST /team/request` is the only endpoint; no frontend page | Single controller endpoint; no route in frontend | Define what Team Requests is meant to do; build or remove |
| P2-004 | User Documents | Document upload depends on Cloudinary (same issue as P1-001) | `POST /users/:id/documents` wired to uploads service | Covered by P1-001 resolution |
| P2-005 | Reports | Reports page is a redirect — no standalone report generation | `reports/page.tsx` calls `router.replace('/analytics')` | Intentional redesign — document clearly or build standalone export |
| P2-006 | AI Endpoints | `OPENAI_API_KEY` not confirmed in `.env` | `ai.service.ts` requires OpenAI client; key absence causes 500 on AI routes | Add key to `.env` OR handle missing key gracefully with user-facing error |
| P2-007 | AI Cron Digest | Cron schedule for AI digest unverified | `ai.cron.service.ts` and `platform/scheduler` exist; schedule not confirmed | Check `@Cron` decorator schedule; confirm it won't fire unexpectedly |
| P2-008 | Settings | Settings page is 1529 lines — potential rendering and maintenance burden | File size confirmed | Consider splitting into tabbed sub-components |
| P2-009 | Profile Page | Profile page is only 145 lines — may be a thin wrapper | Confirm profile page renders full profile or redirects to settings | Verify behaviour |
| P2-010 | SLA | SLA settings save flow (frontend → `PATCH /settings/sla`) not browser-verified | Service persistence confirmed via code; frontend call not traced | Test: change SLA in settings, create ticket, verify timer reflects new value |
| P2-011 | Comments | Comment scoping — `?ticketId=` query param pattern not confirmed in service | `GET /comments` endpoint exists; scoping unverified | Trace `commentsApi.getAll()` in frontend → confirm query param sent |
| P2-012 | Ticket Export | CSV/Excel format of export not confirmed | `GET /tickets/export` exists | Test export, verify file format |
| P2-013 | Audit Trail | No separate audit export — activity log IS the audit trail | `OperationalEvent` model used as audit; no dedicated export | Add export to activity log page for Admin |

---

## P3 — LOW PRIORITY (Backlog / Future)

| ID | Module | Issue | Evidence | Fix Action |
|---|---|---|---|---|
| P3-001 | Mobile | No mobile-specific layouts tested | Tailwind responsive present; no breakpoint test | Run on mobile viewport, fix overflow issues |
| P3-002 | Accessibility | No systematic aria-label audit | `eslint-plugin-jsx-a11y` present; not enforced | Run axe-core audit, fix violations |
| P3-003 | AI Digest | Cron-based AI digest has no user-facing output confirmed | `POST /ai/trigger-digest` exists | Define output destination (email? notification?) |
| P3-004 | Project Member Role Edit | Can add/remove members but role change flow absent | Add/remove endpoints present; no PATCH member role endpoint | Add `PATCH /projects/:id/members/:userId` |
| P3-005 | Analytics | Analytics uses dashboard endpoints — no dedicated analytics API | Recharts present, data comes from dashboard | Add dedicated `/analytics` namespace if needed |
| P3-006 | PWA | No PWA manifest or service worker | Not present | Add if mobile-first is a requirement |
| P3-007 | Ticket Recurrence | `RECURRENCE_LABELS` object present in ticket detail | Labels defined but no recurrence engine visible | Confirm if recurrence is implemented or just labelled |

---

## RESOLVED ISSUES (Confirmed fixed in recent fix packs)

| ID | Module | Issue | Fix Pack |
|---|---|---|---|
| R-001 | Activity Log | API failures silently hidden | Raw Fetch + Activity Reliability |
| R-002 | Projects | Projects module broken/missing | Projects Module Recovery |
| R-003 | Workday | Live status inaccurate (wrong status source) | Workday Live Status Accuracy |
| R-004 | Dashboard | Command center data not loading | Dashboard Command Center Recovery |
| R-005 | Calendar | Leave events not filtered to approved only | Calendar Leave Mapping Fix |
| R-006 | Settings | SMTP, company, SLA not persisting to DB | Settings Persistence |
| R-007 | Leave | Approval UX broken | Leave Approval UX Fix |
| R-008 | Roles | RBAC route/action enforcement incomplete | Role-based UX cleanup |
| R-009 | General | UX polish — empty states, loading skeletons, error states | Final UX Polish |
| R-010 | Deployment | Runtime crashes / migration failures | Deployment/Runtime Recovery |
