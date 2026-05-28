# Activity Log UX Fix Report
**Phase:** UX Fix 4 — Activity Log UX Clarity Pass
**Date:** 2026-05-28
**Status:** COMPLETE

---

## Objective

Make the Activity Log and Recent Activity feel useful, trustworthy, and understandable for real daily TechnoEdge operations.

---

## Fixes Applied

### FIX-1 — Backend: Rich Event Descriptions with Entity Names
**File:** `backend/src/modules/platform/events/events.controller.ts`

**Problem:** All event descriptions were generic: "created a ticket", "started working on a ticket", "commented on a ticket". No entity names — you couldn't tell which ticket, which project.

**Fix:** Added `enrichWithTitles()` private method to the controller. After fetching events, it batch-fetches ticket titles and project names for all entity IDs in the result set (no N+1), then rewrites descriptions to include the actual entity name:

| Before | After |
|--------|-------|
| created a ticket | created 'Fix login redirect bug' |
| started working on a ticket | started working on 'Adobe Short 3' |
| submitted ticket for review | submitted 'API timeout fix' for review |
| was assigned a ticket | was assigned 'Data pipeline issue' |
| completed a ticket | completed 'UI button alignment' |
| commented on a ticket | commented on 'Fix login redirect bug' |
| created a project | created project 'Q3 Analytics Dashboard' |
| updated a project | updated project 'Mobile App v2' |

Metadata is also enriched: if a ticket event's `metadata.ticketId` is missing, it's added from the fetched ticket — ensuring the frontend badge always appears.

**Architecture:** Two batch queries only (one for tickets, one for projects), keyed by entityId. Zero N+1. Does not touch any protected services.

---

### FIX-2 — Activity Log Page: Event Type Badges
**File:** `frontend/app/(dashboard)/admin/activity/page.tsx`

**Problem:** All events looked identical — only a colored dot differentiated them. No category label.

**Fix:** Added `getEventBadge()` function that maps action names to badge categories:

| Badge | Actions Covered | Color |
|-------|----------------|-------|
| Ticket | TICKET_*, COMMENT_ADDED, ATTACHMENT_UPLOADED | Blue |
| Leave | LEAVE_* | Purple |
| Workday | WORKDAY_*, BREAK_*, IDLE_* | Emerald |
| Project | PROJECT_* | Indigo |
| User | USER_*, PROFILE_UPDATED | Slate |
| Settings | SETTINGS_UPDATED | Orange |

Each row shows a compact badge pill (`[Ticket]`, `[Leave]`, etc.) next to the timestamp on the right side.

---

### FIX-3 — Activity Log Page: Active Filter Summary Bar
**File:** `frontend/app/(dashboard)/admin/activity/page.tsx`

**Problem:** No indication of what was currently filtered. User had to visually check button states.

**Fix:** Added a filter summary line below filters:
> "All events · Today · Department Scope · 42 events"
> "ticket creation · This Week · Personal Scope · 8 events"

Shows event count when data is available.

---

### FIX-4 — Activity Log Page: Contextual Empty States
**File:** `frontend/app/(dashboard)/admin/activity/page.tsx`

**Problem:** Empty state said "No activity logs found" for all filter combinations with only a generic fallback.

**Fix:** `getEmptyState()` function produces context-aware titles and hints:

| Situation | Title | Hint |
|-----------|-------|------|
| No activity today | "No activity recorded today" | "Start your workday or take an action..." |
| No ticket activity today | "No ticket creation activity today" | "Try 'This Week' or 'Last 7 Days'..." |
| No leave activity this week | "No leave request activity this week" | "Try 'All' to see complete history..." |
| No activity (all time, scoped) | "No activity found in your scope" | "Try expanding..." |

---

### FIX-5 — Activity Log Page: Improved Timestamps
**File:** `frontend/app/(dashboard)/admin/activity/page.tsx`

**Problem:** Only showed relative time ("2h ago", "3d ago"). No context for same-day events.

**Fix:** `formatTimestamp()` function:
- < 1 min → "just now"
- < 60 min → "5m ago"
- Same day → "Today · 2:30 PM"
- Yesterday → "Yesterday · 11:00 AM"
- Older → "23 May · 3:15 PM"

Added `title` attribute on each row for exact timestamp on hover (e.g., "23 May 2026, 03:15 pm").

---

### FIX-6 — Activity Log Page: Click Affordance
**File:** `frontend/app/(dashboard)/admin/activity/page.tsx`

**Problem:** Clickable rows (ticket → ticket detail, leave → leave page, project → project detail) had no visual indicator that they were links. Cursor changed but no arrow icon.

**Fix:** Added `ArrowUpRight` icon (12px) on the right of clickable rows, colored slate-300 by default and blue-500 on hover via CSS group. Non-clickable rows (workday events → no link since `/workday` doesn't exist) correctly show no arrow.

---

### FIX-7 — Activity Log Page: Loading Skeleton
**File:** `frontend/app/(dashboard)/admin/activity/page.tsx`

**Problem:** Loading state was "Loading activity…" plain text centered in the card.

**Fix:** Animated skeleton rows (5 rows, matching the event row structure: dot + text lines + timestamp width). Uses `animate-pulse` with `var(--border-primary)` and `var(--border-subtle)` colors for theme compatibility.

---

### FIX-8 — Activity Log Page: Expanded Event Type Filter
**File:** `frontend/app/(dashboard)/admin/activity/page.tsx`

**Problem:** Filter dropdown had only 5 options: Login, Work Start, Break, Ticket, Leave.

**Fix:** Expanded to grouped `<optgroup>` sections covering all major event categories:
- **Workday:** Login, Logout, Work Start, Work End, Break Started, Break Ended
- **Tickets:** Created, Assigned, Started, Submitted for Review, Completed, Comment, Attachment
- **Leave:** Requested, Approved, Rejected
- **Projects:** Created, Updated

Added a "Clear ×" button to reset the event type filter without reloading.

---

### FIX-9 — RecentActivityFeed: Fix Scope Label
**File:** `frontend/components/home/RecentActivityFeed.tsx`

**Problem:** A prior fix incorrectly set MANAGER/TEAM_LEAD scope label to "Your Personal Activity". The `EventsController` (from the operational convergence audit) correctly gives MANAGER/TEAM_LEAD department-scoped events (member activities, department tickets, leaves, projects).

**Fix:** Corrected scope labels:
- `SUPER_ADMIN / ADMIN` → "Company-wide Activity" (all org events)
- `MANAGER / TEAM_LEAD` → "Your Department Activity" (department member events)
- `EMPLOYEE / INTERN` → "Your Activity" (own events only)

---

### FIX-10 — RecentActivityFeed: 5 Events + "View all activity" Link
**File:** `frontend/components/home/RecentActivityFeed.tsx`

**Problem:** Showed 10 events — too long for a dashboard widget. No way to navigate to the full Activity Log from the feed.

**Fix:**
- Limited to top 5 events (`slice(0, 5)`)
- Added a "View all activity →" footer link that navigates to `/admin/activity`

---

### FIX-11 — Backend Test Mock: Missing `project.findMany`
**File:** `backend/test/unit/p1d.dashboard-consistency.spec.ts`

**Problem:** The `getPreviews()` change (from QA audit session) added `project.findMany()` to the dashboard service, but the test mock only had `project.count`. The test suite had 1 failure.

**Fix:** Added `findMany: jest.fn()` to the `project` mock and `mockResolvedValue([])` in `beforeEach`.

---

## Verification

### Tests
- Backend: **117/117 tests pass** (was 116 passing, 1 failing before fix)
- Frontend TypeScript: **0 errors** (`npx tsc --noEmit`)
- Frontend build: **clean**

### RBAC Scope Verification

| Role | Event Scope | Correct? |
|------|------------|---------|
| SUPER_ADMIN | All company events | ✅ |
| ADMIN | All company events | ✅ |
| MANAGER | Department members' events (tickets, leave, projects) | ✅ |
| TEAM_LEAD | Department members' events (tickets, leave, projects) | ✅ |
| EMPLOYEE | Own events + own tickets/leave/projects events | ✅ |
| INTERN | Own events + own tickets/leave/projects events | ✅ |

### Filter Functionality

| Filter | Behavior | Status |
|--------|---------|--------|
| Today | Events from midnight today | ✅ |
| This Week | Events from Monday of current week | ✅ |
| Last 7 Days | Rolling 7-day window | ✅ |
| All | No date filter applied | ✅ |
| Event Type filter | API param `?action=ACTION_NAME` | ✅ |
| Clear × button | Resets event type to All | ✅ |

### Description Enrichment Examples

| Action | Before | After (with entity name) |
|--------|--------|--------------------------|
| TICKET_CREATED | created a ticket | created 'Adobe Short 3' |
| TICKET_SUBMITTED_FOR_REVIEW | submitted ticket for review | submitted 'Bug fix PR' for review |
| COMMENT_ADDED | added a comment | commented on 'Data pipeline issue' |
| PROJECT_UPDATED | updated a project | updated project 'Q3 Dashboard' |

### Drilldown Routing

| Event Type | Route | Status |
|-----------|-------|--------|
| Ticket events | `/tickets/:id` | ✅ Clickable + arrow |
| Leave events | `/leave` | ✅ Clickable + arrow |
| Project events | `/projects/:id` | ✅ Clickable + arrow |
| Workday events | No link (no `/workday` page) | ✅ No dead route |

---

## Files Modified

| File | Type | Change |
|------|------|--------|
| `backend/src/modules/platform/events/events.controller.ts` | Backend | `enrichWithTitles()` method + call |
| `frontend/app/(dashboard)/admin/activity/page.tsx` | Frontend | Full UX pass (badges, timestamps, skeleton, filter summary, empty states, expanded filter) |
| `frontend/components/home/RecentActivityFeed.tsx` | Frontend | Scope label fix, 5-event limit, "View all" link |
| `backend/test/unit/p1d.dashboard-consistency.spec.ts` | Test | Add missing `project.findMany` mock |

---

## Architecture Compliance

- ✅ No new operational event types added
- ✅ No RBAC scoping changed (only fixed frontend label accuracy)
- ✅ No protected services modified (AccessPolicyService, TicketAccessService, etc.)
- ✅ No demo or fake data added
- ✅ `enrichWithTitles()` uses standard Prisma queries, 2 batch queries only
- ✅ No P2/P3 features introduced
- ✅ 117/117 backend tests pass
- ✅ Frontend build clean
