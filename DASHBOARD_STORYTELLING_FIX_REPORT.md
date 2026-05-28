# Dashboard Storytelling Fix Report
**Phase:** UX Fix 3 — Dashboard Storytelling and Command Center Pass
**Date:** 2026-05-28
**Status:** COMPLETE

---

## Objective

Transform the dashboard from a technically-connected metrics page into a real operational command center that communicates:
1. What needs attention now?
2. What is overdue?
3. What is in review?
4. Who is active?
5. What approvals are pending?
6. What changed recently?
7. Which projects are active?
8. What is all clear?

---

## Fixes Applied

### FIX-1 — CommandCard: Inline Preview Rows
**File:** `frontend/components/ui/CommandCard.tsx`

**Problem:** Preview items (overdue tickets, active projects, pending leave) were only visible in a floating hover popup (`HoverPreview`). Not discoverable, hidden on mobile, required hover to see.

**Fix:** Added a permanent inline preview section inside the card body that shows when `previewItems.length > 0`. Top 2 items are always visible with colored bullet dots and truncated labels. Overflow count shown as "+N more — click to view all".

**Severity-matched bullet colors:**
- `urgent` → red dot (overdue tickets)
- `warning` → amber dot (pending leave, in review)
- `success` → emerald dot (all-clear state)
- `blue` → blue dot (projects, general)

**Result:** Users can immediately see the top 2 overdue tickets, active projects, or pending leave requests without hovering. The hover preview still exists on desktop for additional detail.

---

### FIX-2 — AnnouncementBroadcast: Rename + Fix Dead Button + Fix Hardcoded Content
**File:** `frontend/components/ui/AnnouncementBroadcast.tsx`

**Problems:**
1. Labeled "Command Broadcast" — a made-up military name with no real backend system
2. "Add to Calendar" button called `onAddCalendar(() => {})` — a no-op with no functionality
3. Hover popup showed hardcoded "Department Review & KPI Assessment" regardless of actual alert content
4. "No active broadcasts today" — confusing when nothing is broadcast

**Fixes:**
1. Renamed "Command Broadcast" → **"Operational Alert"** when an alert exists, **"Latest Alert"** otherwise
2. Alert count badge added when `alertCount > 1`
3. "Add to Calendar" button changed to **"View All"** (calls `onOpenAnnouncement`) when an alert is active; shows **"All Clear"** (disabled) when none
4. Hover popup now shows actual `eventTitle` content and accurate action text
5. Default title changed from "No active broadcasts today" → **"No active operational alerts"**

**Result:** The component accurately represents what it does — showing the first/most critical operational alert from the backend, with a working drilldown to the full alerts modal.

---

### FIX-3 — Dashboard: Error State Guard
**File:** `frontend/app/(dashboard)/(core)/dashboard/page.tsx`

**Problem:** If the `/home/summary` API call failed, all KPI values silently showed `0` — indistinguishable from a genuine "no work" state.

**Fix:**
- Added `isError: summaryError` to the home-summary `useQuery` destructure
- Changed `queryFn` to `throw new Error(...)` on non-OK response (was returning `null`)
- Added `summaryError` banner above the broadcast component
- All KPI capsule values show `'–'` when `summaryError` is true
- All CommandCard counts and summaries show error-specific text when `summaryError`

**Result:** Clear distinction between "no data yet" (genuine zeros) and "data failed to load" (dash values + error banner).

---

### FIX-4 — Dashboard: Team Online / Active Today Drilldown URLs
**File:** `frontend/app/(dashboard)/(core)/dashboard/page.tsx`

**Problem:** Three KPI capsules routed to `/team` instead of `/team?tab=live-status`:
- TEAM_LEAD: "Team Online" → `/team`
- MANAGER: "Team Size" → `/team`
- ADMIN/SUPER_ADMIN: "Active Today" → `/team`

This landed on the Roster tab, not the Live Status tab where active worker information lives.

**Fix:** All three now route to `/team?tab=live-status`.

---

### FIX-5 — Dashboard: Role-Specific CommandCard Summaries
**File:** `frontend/app/(dashboard)/(core)/dashboard/page.tsx`

**Problem:** Empty-state summaries were generic ("No overdue tickets in your scope" for all roles).

**Fix:** Per-role empty-state copy:
- `EMPLOYEE/INTERN`: "No overdue tickets — you're on track!"
- `TEAM_LEAD`: "No overdue tickets in your team"
- `MANAGER`: "No overdue tickets in your department"
- `ADMIN/SUPER_ADMIN`: "No overdue tickets across your scope"

Active-state summaries improved:
- Overdue: "X overdue tickets past SLA — action needed now" (adds urgency)
- Projects: "X active projects currently in progress"
- Leave: "X leave requests awaiting your approval" (highlights the action needed)
- In Review: "X tickets submitted and waiting for review" (gives context)

Also improved KPI capsule subtexts:
- "Pending Leave" → routes to `/leave?tab=needs-action` (was `/leave`)
- MANAGER "Pending Leave" statusType now reacts: `orange` when pending, `green` when clear
- ADMIN/SUPER_ADMIN "Overdue" statusType now reacts: `red` when overdue, `green` when clear

---

### FIX-6 — RecentActivityFeed: Accurate Scope Label
**File:** `frontend/components/home/RecentActivityFeed.tsx`

**Problem:** The scope label showed "Department Scope (Managed Members)" for MANAGER and TEAM_LEAD roles, but `EventsController` only returns the requesting user's own events for non-admins (`actorId = user.id`). The label was misleading — managers expected to see team activity but only saw their own.

**Fix:**
- `SUPER_ADMIN / ADMIN` → "Company-wide Activity" (accurate — these roles can see all org events)
- All other roles → "Your Personal Activity" (accurate — EventsController scopes to their own `actorId`)

Also improved empty-state message:
- Was: "No events were found within your [scope]."
- Now: "Activity appears here as you create tickets, start work, and take action."

---

## Verification

### Build Status
- `npx tsc --noEmit` — ✅ 0 type errors
- `npm run build` — ✅ Clean build, all pages compile

### Drilldown Routes Audit

| Card | Route | Status |
|------|--------|--------|
| Overdue Tickets | `/tickets?overdue=true` | ✅ |
| In Review | `/tickets?status=REVIEW` | ✅ |
| Active Projects | `/projects?status=ACTIVE` | ✅ |
| Pending Leave | `/leave?tab=needs-action` | ✅ Fixed |
| Team Online | `/team?tab=live-status` | ✅ Fixed |
| Active Today | `/team?tab=live-status` | ✅ Fixed |
| Team Size | `/team?tab=live-status` | ✅ Fixed |

### Empty-State Audit

| Card | Zero State | Status |
|------|-----------|--------|
| Overdue (EMPLOYEE) | "No overdue tickets — you're on track!" | ✅ |
| Overdue (TEAM_LEAD) | "No overdue tickets in your team" | ✅ |
| Overdue (MANAGER) | "No overdue tickets in your department" | ✅ |
| Overdue (ADMIN) | "No overdue tickets across your scope" | ✅ |
| Active Projects | "No active projects in your scope" | ✅ |
| Pending Leave | "No pending leave requests — all resolved" | ✅ |
| In Review (EMPLOYEE) | "No tickets in review — submit completed work to move forward" | ✅ |

### Preview Row Audit

| Card | Preview Source | Inline Visible |
|------|--------------|---------------|
| Overdue Tickets | `summary.previews.overdueTickets` | ✅ Inline rows |
| Active Projects | `summary.previews.activeProjects` | ✅ Inline rows |
| Pending Leave | `summary.previews.pendingLeave` | ✅ Inline rows |
| In Review | `summary.previews.inReviewTickets` | ✅ Inline rows |

---

## Dashboard Operational Readiness After Fixes

| Question | Answer |
|----------|--------|
| What needs attention now? | ✅ Overdue card with inline preview rows, SLA risk banner, CriticalActionPanel |
| What is overdue? | ✅ Overdue CommandCard with top 2 ticket IDs inline |
| What is in review? | ✅ In Review card (EMPLOYEE/TL/MANAGER) with top 2 items |
| Who is active? | ✅ Team Online / Active Today → `/team?tab=live-status` |
| What approvals are pending? | ✅ Leave Requests card with top 2 leave items inline |
| What changed recently? | ✅ RecentActivityFeed with accurate scope label |
| Which projects are active? | ✅ Active Projects card with top 2 project names inline |
| What is all clear? | ✅ Role-specific "all clear" messages, success severity on zero counts |

---

## Files Modified

| File | Change |
|------|--------|
| `frontend/components/ui/CommandCard.tsx` | Inline preview rows section |
| `frontend/components/ui/AnnouncementBroadcast.tsx` | Rename + live alert content + working button |
| `frontend/app/(dashboard)/(core)/dashboard/page.tsx` | Error state, drilldowns, role copy, alert count |
| `frontend/components/home/RecentActivityFeed.tsx` | Scope label accuracy + empty state |

---

## Architecture Compliance

- ✅ No new backend endpoints added
- ✅ No frozen services (AccessPolicyService, TicketAccessService, etc.) modified
- ✅ No database schema changes
- ✅ No P2/P3 features introduced
- ✅ No AI or automation added
- ✅ Existing `previews` data from `DashboardService.getPreviews()` consumed — no new queries
- ✅ Frontend build passes clean
