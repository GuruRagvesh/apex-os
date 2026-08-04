# Manager & Team Lead Intelligence UX Report
**Phase:** UX Fix 6 — Manager and Team Lead Intelligence
**Date:** 2026-05-28
**Status:** COMPLETE

---

## Objective

Managers and Team Leads should instantly understand team pressure, overdue work, review bottlenecks, and workday status — using only existing, RBAC-scoped backend data.

---

## Audit Findings

### What was already working for MANAGER / TEAM_LEAD

| Feature | Location | Status |
|---------|----------|--------|
| Overdue team tickets | Dashboard KPI capsule + CommandCard + Bottlenecks panel | ✅ |
| Pending reviews | Dashboard KPI capsule ("Pending Reviews") | ✅ |
| Pending leave approvals | Dashboard KPI capsule + CommandCard | ✅ |
| Active projects | Dashboard CommandCard | ✅ |
| Recent team activity | Dashboard RecentActivityFeed (department-scoped) | ✅ |
| SLA risk banner (overdue + due-soon + review-ageing) | Dashboard — only for isLeadOrAbove | ✅ |
| Critical alerts (overdue, pending review, pending leave) | Dashboard CriticalActionPanel | ✅ |
| Team workday status | Team page → Live Status tab | ✅ (UX Fix 5) |
| Stale session detection | Team page → Live Status tab | ✅ (UX Fix 5) |
| Analytics workload table | Analytics page (TEAM_LEAD+) | ✅ |

### What was missing

| Feature | Gap |
|---------|-----|
| Workload by member on dashboard | `dashboardApi.getWorkload()` existed but was not surfaced on the main dashboard — only in analytics |
| Inactive/not-started users on dashboard | Team workday status was only on the team page — no dashboard summary |
| Combined ticket-load + workday awareness | No single view showed who has the most work AND whether they've started their day |
| Analytics workload bar: wrong scale | Progress bar used `count * 10` (arbitrary) instead of relative-to-max |
| Analytics workload: urgency not shown | U/H count badges missing from analytics workload view |

---

## Fixes Applied

### FIX-1 — TeamPressurePanel Component
**File:** `frontend/components/home/TeamPressurePanel.tsx` (new)

A new full-width panel for MANAGER / TEAM_LEAD / ADMIN / SUPER_ADMIN showing two sections:

**Left section — Workload by Member** (2/3 width):
- Fetches `dashboardApi.getWorkload()` — RBAC-scoped server-side (uses `TicketAccessService.visibleUserIdsForWorkload`)
- Shows top 7 members sorted by `totalAssigned` descending
- Each row:
  - Avatar initial + name + role/department
  - Workday status dot (green=Working, orange=On Break, yellow=Idle, gray=Not started)
  - Urgency badges: `[2U]` (urgent), `[3H]` (high)
  - Total ticket count (red if ≥ 8, amber if ≥ 5, normal otherwise)
  - Arrow affordance on hover
  - Click → `/tickets?assignedToId=${userId}` (tickets page already supports this filter)
- "+N more — view full workload →" link to `/analytics` when more than 7 members

**Right section — Workday Status** (1/3 width):
- Fetches `workdayApi.getTeam()` — RBAC-scoped server-side
- Shows live counts: Working / On Break / Idle / Not started / On Leave / Ended day
- Counts are zero-filtered (only shown when > 0)
- "Not started" shown in amber when any members haven't begun their day
- "X members have not started their workday" callout when notStarted > 0
- All rows click → `/team?tab=live-status`

**Data combination:**
Both queries are independently cached (`staleTime: 60000` workload, `30000` workday). The component merges them client-side by `user.id` to show workday status alongside ticket load on each member row.

**Footer legend:**
- "Ticket count = open + in-progress assigned to each member"
- U = Urgent, H = High labels
- "Full analytics →" link

---

### FIX-2 — Dashboard Integration
**File:** `frontend/app/(dashboard)/(core)/dashboard/page.tsx`

Added `TeamPressurePanel` between the CommandCard grid and the Bottlenecks/Events/Activity bottom section, visible only for `isLeadOrAbove`:

```tsx
{isLeadOrAbove && (
  <motion.section
    initial={{ opacity: 0, y: 15 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.28, delay: 0.22 }}
    className="mb-6"
  >
    <TeamPressurePanel />
  </motion.section>
)}
```

EMPLOYEE / INTERN do not see this panel.

---

### FIX-3 — Analytics Workload Bar: Correct Scale + Urgency Badges
**File:** `frontend/app/(dashboard)/analytics/page.tsx`

**Before:**
- Progress bar: `width: ${count * 10}%` — arbitrary, breaks for members with >10 tickets
- No urgency count
- Used `row.user?.name ?? row.name` — inconsistent with API shape

**After:**
- Progress bar: `width: ${(total / maxAssigned) * 100}%` — relative to highest-loaded member
- Urgency badge `[2U]` shown when `urgent > 0`
- Ticket count shown in red when > 5
- Uses `row.name` (correct for current API response shape from `getWorkloadByUser()`)
- Shows up to 10 members (was 8)

---

## Architecture Compliance

- ✅ No backend changes
- ✅ No new API endpoints — uses `dashboardApi.getWorkload()` and `workdayApi.getTeam()` which already existed
- ✅ Both endpoints are RBAC-scoped server-side (TicketAccessService + AccessPolicyService)
- ✅ No fake metrics or calculations
- ✅ EMPLOYEE / INTERN do not see TeamPressurePanel
- ✅ No protected services modified
- ✅ No P2/P3 features

---

## Verification

### Role visibility

| Role | TeamPressurePanel | Description |
|------|------------------|-------------|
| SUPER_ADMIN | ✅ Visible | Company-wide scope |
| ADMIN | ✅ Visible | Company-wide scope |
| MANAGER | ✅ Visible | Managed department scope |
| TEAM_LEAD | ✅ Visible | Own team scope |
| EMPLOYEE | ❌ Hidden | `isLeadOrAbove` guard |
| INTERN | ❌ Hidden | `isLeadOrAbove` guard |

### Data accuracy

| Metric | Source | Scoped? |
|--------|--------|---------|
| Workload per member | `GET /dashboard/workload` → `DashboardService.getWorkloadByUser()` → `TicketAccessService.visibleUserIdsForWorkload()` | ✅ Role-scoped |
| Workday status breakdown | `GET /workday/team` → `WorkdayService.getTeam()` → RBAC-filtered | ✅ Role-scoped |
| Ticket counts | Active only (DONE/CLOSED excluded) | ✅ |

### Drilldowns

| Interaction | Route |
|-------------|-------|
| Member workload row click | `/tickets?assignedToId=${id}` — shows that member's assigned tickets |
| Any workday status row click | `/team?tab=live-status` |
| "Full view" header link | `/team?tab=live-status` |
| "+N more" link | `/analytics` |
| "Full analytics →" footer | `/analytics` |

### Tests
- Frontend TypeScript: **0 errors** (`npx tsc --noEmit`)
- Backend: **117/117 tests pass** (no backend changes)
- Frontend build: clean

---

## Coverage Summary vs Requirements

| Requirement | Covered by |
|-------------|-----------|
| Overdue team tickets | Dashboard KPI + CommandCard + Bottlenecks panel (existing) |
| Pending reviews | Dashboard KPI capsule (existing) |
| Tickets by member | TeamPressurePanel — workload table with per-member counts |
| Workload by member | TeamPressurePanel — sorted by totalAssigned, with U/H badges |
| Inactive/not-started users | TeamPressurePanel — Workday Status section, "Not started" count |
| Stale/incomplete workdays | Team Live Status page — stale row detection (UX Fix 5) |
| Pending leave approvals | Dashboard KPI + CommandCard (existing) |
| Recent team activity | Dashboard RecentActivityFeed (dept-scoped, existing) |
| Active projects | Dashboard CommandCard (existing) |
| Delivery/SLA risks | Dashboard SLA risk banner (existing, managers/TLs only) |

---

## Files Modified

| File | Type | Change |
|------|------|--------|
| `frontend/components/home/TeamPressurePanel.tsx` | Frontend (new) | Full workload + workday status panel for leads/managers |
| `frontend/app/(dashboard)/(core)/dashboard/page.tsx` | Frontend | Import + render TeamPressurePanel for isLeadOrAbove |
| `frontend/app/(dashboard)/analytics/page.tsx` | Frontend | Correct workload bar scale, add urgency badges, use correct field names |
