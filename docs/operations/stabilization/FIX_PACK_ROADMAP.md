# FIX PACK ROADMAP
**Apex OS — Post Fix-Pack 9 → Production**
**Date:** 2026-05-30

---

## COMPLETED FIX PACKS (1–9)

| Pack | Name | Status |
|---|---|---|
| FP-1 | Deployment / Runtime Recovery | ✅ Complete |
| FP-2 | Projects Module Recovery | ✅ Complete |
| FP-3 | Workday Live Status Accuracy | ✅ Complete |
| FP-4 | Raw Fetch + Activity Reliability | ✅ Complete |
| FP-5 | Blocked Ticket Workflow | ✅ Backend Complete / **Frontend UI Missing** |
| FP-6 | Dashboard Command Center Recovery | ✅ Complete |
| FP-7 | Calendar Leave Mapping Fix | ✅ Complete |
| FP-8 | Role-based UX Route/Action Cleanup | ✅ Complete |
| FP-9 | Final UX Polish | ✅ Complete |

---

## UPCOMING FIX PACKS

---

### FP-10 — PILOT GATE (P0 blockers — do before first user)
**Target:** Immediately

| # | Issue | Action |
|---|---|---|
| 1 | Block/Unblock UI missing in ticket detail | Add block reason modal + block/unblock buttons for Manager+ in `[id]/page.tsx` |
| 2 | Post-migration login verification | Run both servers, log in, confirm tickets/dashboard load |
| 3 | Production smoke test | Deploy to Render, hit `/api/health`, test login on live URL |

**Exit criteria:** All P0 issues resolved + successful login on production URL.

---

### FP-11 — ENVIRONMENT HARDENING (P1 infrastructure)
**Target:** Before controlled pilot

| # | Issue | Action |
|---|---|---|
| 1 | Cloudinary env vars | Add to `.env` and Render environment variables; test file upload end-to-end |
| 2 | SMTP configuration | Save SMTP settings in app, run `POST /settings/email/test`, confirm email received |
| 3 | OpenAI API key | Add `OPENAI_API_KEY` to env; test `POST /ai/suggest-priority` |
| 4 | Idle detection live test | Manual idle test on both browsers |
| 5 | Socket.IO notification push | Trigger leave approval, confirm notification fires in real-time |

**Exit criteria:** Attachments upload successfully. Email test returns 200. AI endpoint returns suggestion.

---

### FP-12 — MISSING UI FLOWS (P1 frontend gaps)
**Target:** Before controlled pilot

| # | Issue | Action |
|---|---|---|
| 1 | Forgot/Reset Password page | Build `(auth)/forgot-password/page.tsx` using existing backend endpoints |
| 2 | Kanban drag-drop API wire | Verify/fix `onDragEnd` → `PATCH /tickets/:id/status` call |
| 3 | Ticket export button | Add export trigger to tickets list page |
| 4 | Leave balance display verification | Submit/approve test leave, verify balance panel updates |

**Exit criteria:** User can reset password. Kanban drag updates status. Export produces file.

---

### FP-13 — DATA INTEGRITY (P2 backend fixes)
**Target:** Before full rollout

| # | Issue | Action |
|---|---|---|
| 1 | Project activity feed scoping | Add `projectId` filter to `GET /events` endpoint and service |
| 2 | Comment scoping verification | Trace `GET /comments?ticketId=` in service; confirm scoped properly |
| 3 | Team Requests module | Define purpose or remove `POST /team/request` — no frontend |
| 4 | Manager multi-dept access UI | Build or verify UI for `ManagerDeptAccess` assignment |

**Exit criteria:** Project detail shows only project events. Comments are ticket-scoped.

---

### FP-14 — ADMIN & REPORTING (P2 completeness)
**Target:** Before full rollout

| # | Issue | Action |
|---|---|---|
| 1 | Activity log export | Add CSV export to activity log page for Admin |
| 2 | SLA browser verification | Change SLA in settings, create ticket, verify timer reflects change |
| 3 | AI cron schedule review | Check `@Cron` schedule in `ai.cron.service.ts`, confirm safe |
| 4 | Settings page refactor | Split 1529-line settings page into tab components |

**Exit criteria:** Admin can export activity log. SLA changes propagate to new tickets.

---

### FP-15 — QUALITY & POLISH (P3 backlog)
**Target:** Post-launch hardening

| # | Issue | Action |
|---|---|---|
| 1 | Mobile responsive testing | Test all pages at 375px, 768px viewports; fix overflow |
| 2 | Accessibility audit | Run axe-core, fix WCAG 2.1 AA violations |
| 3 | Ticket recurrence engine | Confirm or remove recurrence labels |
| 4 | Project member role editing | Add `PATCH /projects/:id/members/:userId` endpoint + UI |
| 5 | PWA manifest | Add if mobile-first adoption is required |

---

## OVERALL ROADMAP SUMMARY

```
FP-1 to FP-9  [DONE]  ████████████████████  100%
FP-10         [NOW]   ░░░░░░░░░░░░░░░░░░░░  Pilot Gate
FP-11         [NOW]   ░░░░░░░░░░░░░░░░░░░░  Env Hardening
FP-12         [SOON]  ░░░░░░░░░░░░░░░░░░░░  Missing UI Flows
FP-13         [SOON]  ░░░░░░░░░░░░░░░░░░░░  Data Integrity
FP-14         [LATER] ░░░░░░░░░░░░░░░░░░░░  Admin/Reporting
FP-15         [LATER] ░░░░░░░░░░░░░░░░░░░░  Quality/Polish
```

**Minimum for controlled pilot:** FP-10 + FP-11 + FP-12
**Minimum for full rollout:** FP-10 through FP-14
