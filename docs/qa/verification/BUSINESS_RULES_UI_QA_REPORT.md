# BUSINESS RULES + UI BEHAVIOR QA REPORT
**Mode:** QA — No new features; findings only  
**Date:** 2026-05-27  
**Scope:** Full role matrix, workday behavior, activity feed, dashboard UX, business rule gaps

---

## EXECUTIVE SUMMARY

Apex OS is largely sound. P0/P1 architecture delivers correct data scoping for tickets, leave, and projects. Core role-based navigation and authorization are enforced. However, **six medium-severity business rule gaps** and **twelve UI/UX confusion issues** were found during this audit. The most impactful:

1. **Activity feed shows own-events-only for ALL non-admin roles** — MANAGER and TEAM_LEAD see only their own activity, not their team's
2. **TEAM_LEAD cannot see Live Status tab** in the Team page despite it being their primary workday management view
3. **Logout does not end workday** — open work sessions persist until midnight auto-reset
4. **Midnight reset does not record logoutAt** — unclosed work sessions have no end time
5. **"High Priority Tickets" dashboard card always shows 0 for EMPLOYEE** — shows overdue count instead of correct metric
6. **Announcement Broadcast always shows "No active broadcasts today"** — severity mapping mismatch

---

## PART 1 — ROLE BEHAVIOR MATRIX

### 1A. Navigation Visibility

| Nav Item | SA | ADMIN | MGR | TL | EMP | INTERN |
|----------|-----|-------|-----|-----|-----|--------|
| Home (Dashboard) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tickets | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Kanban Board | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Projects | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Leave | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Calendar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Team | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Analytics | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Users & Roles | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Departments | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Activity Log | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Settings | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Findings:**
- Settings visible to ALL roles including INTERN — correct if settings = personal profile/theme only. ✅
- Activity Log visible to TEAM_LEAD and above, but data is scoped to own events only for non-admin. **Bug: misrepresented scope.** 🔴

### 1B. Action Permissions

| Action | SA | ADMIN | MGR | TL | EMP | INTERN |
|--------|-----|-------|-----|-----|-----|--------|
| Create ticket | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Assign ticket | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Approve ticket | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete ticket | ✅ | ✅ | ✅* | ✅* | ❌ | ❌ |
| Create project | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Add project member | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete project | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Apply leave | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Approve leave | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Create user | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Change user role | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View analytics | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| View all team activity | ✅ | ✅ | ❌** | ❌** | ❌ | ❌ |

*Delete is gated by `TicketAccessService` — enforced server-side  
**Bug: should be ✅ for MANAGER and ✅ for TEAM_LEAD — see Bug #1 below

---

## PART 2 — DASHBOARD VISIBILITY MATRIX

### 2A. KPI Cards by Role

| KPI Card | SA / ADMIN | MANAGER | TEAM_LEAD | EMP / INTERN |
|----------|-----------|---------|-----------|-------------|
| Active Today (staff online) | ✅ counts WORKING+ON_BREAK+LOGGED_IN | ❌ | ❌ | ❌ |
| Open Tickets | ✅ | ❌ → shows "Dept Tickets" | ❌ → shows "Team Tickets" | ✅ |
| Overdue Tickets | ✅ | ✅ | ✅ | ❌ |
| Pending Leave | ✅ | ✅ | ❌ | ❌ |
| Team Size | ❌ | ✅ (dept count) | ❌ | ❌ |
| Team Online | ❌ | ❌ | ✅ | ❌ |
| In Progress | ❌ | ❌ | ❌ | ✅ |
| In Review | ❌ | ❌ | ✅ | ✅ |
| Done This Week | ❌ | ❌ | ❌ | ✅ |

**Findings:**
- EMPLOYEE/INTERN: "High Priority Tickets" CommandCard uses `metrics.overdue ?? 0` — BUT for EMPLOYEE, `metrics.overdue` is undefined (their metrics are `open, inProgress, inReview, doneThisWeek`). Card always shows **0**. 🔴 Bug #5
- "Active Projects" CommandCard uses `metrics.activeProjects ?? 0` — `activeProjects` is NOT included in any role's metric response from `getMetrics()`. Always shows **0** for all roles. 🔴 Bug #6

### 2B. Critical Alerts

| Alert Type | SA | ADMIN | MGR | TL | EMP | INTERN |
|-----------|-----|-------|-----|-----|-----|--------|
| Overdue ticket alert | ✅ (scoped) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Review pending alert | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Leave pending alert | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| SLA Risk Banner | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |

### 2C. Announcement Broadcast Panel

**Bug #7 — Severity Mismatch (Always "No active broadcasts today"):**  
The `AnnouncementBroadcast` component looks for `alert.type === 'urgent' || alert.severity === 'urgent'` to find the first urgent alert.  
But `DashboardService.getCriticalAlerts()` sets severity values: `'red'`, `'purple'`, `'amber'` — never `'urgent'`.  
Result: `firstUrgentAlert` is always `null`, and the broadcast title is always "No active broadcasts today" **even when there are overdue ticket or leave alerts**.  
Correct fix: check `alert.severity === 'red'` as the urgent condition.

---

## PART 3 — ACTIVITY FEED VISIBILITY MATRIX

### 3A. RecentActivityFeed (Dashboard) — What Each Role Sees

The `RecentActivityFeed` component calls `GET /events?limit=15`.  
`EventsController` enforces: **non-admins always get only their own events** (`actorId = user.id`).

| Role | What feed shows | What it SHOULD show |
|------|----------------|-------------------|
| SUPER_ADMIN | All org events ✅ | All org events |
| ADMIN | All org events ✅ | All org events |
| MANAGER | Own events only 🔴 | Team's events (dept-scoped) |
| TEAM_LEAD | Own events only 🔴 | Direct reports' events |
| EMPLOYEE | Own events only ✅ | Own events |
| INTERN | Own events only ✅ | Own events |

**Bug #1: Activity feed not department-scoped for MANAGER/TEAM_LEAD.** The `DashboardService.getActivityFeed()` method EXISTS and correctly scopes by managed departments, but it is NOT used by the dashboard or `/events` endpoint for non-admin managers.

### 3B. Activity Event Types in Feed

| Event | Shown in feed | Clickable | Links to |
|-------|--------------|-----------|---------|
| TICKET_CREATED | ✅ | ✅ | `/tickets/{id}` |
| TICKET_STARTED | ✅ | ✅ | `/tickets/{id}` |
| TICKET_SUBMITTED_FOR_REVIEW | ✅ | ✅ | `/tickets/{id}` |
| TICKET_DONE | ✅ | ✅ | `/tickets/{id}` |
| TICKET_DELETED | ✅ | ❌ | No link (entity deleted) |
| TICKET_ASSIGNED | ✅ | ✅ | `/tickets/{id}` |
| TICKET_UPDATED | ❌ | — | Not in ACTION_LABELS |
| TICKET_STATUS_CHANGED | ❌ | — | Not in ACTION_LABELS |
| TICKET_CLOSED | ❌ | — | Not in ACTION_LABELS |
| TICKET_REOPENED | ❌ | — | Not in ACTION_LABELS |
| COMMENT_ADDED | ❌ | — | Not in ACTION_LABELS |
| ATTACHMENT_UPLOADED | ❌ | — | Not in ACTION_LABELS |
| LEAVE_REQUESTED | ✅ | ✅ | `/leave` |
| LEAVE_APPROVED | ✅ | ✅ | `/leave` |
| LEAVE_REJECTED | ✅ | ✅ | `/leave` |
| LEAVE_CANCELLED | ❌ | — | Not in ACTION_LABELS |
| PROJECT_CREATED | ❌ | — | Not in ACTION_LABELS |
| USER_LOGIN | ✅ | ❌ | No entity URL for User |
| WORKDAY_STARTED | ✅ | ❌ | `/workday` (route doesn't exist) |
| WORKDAY_ENDED | ✅ | ❌ | `/workday` (route doesn't exist) |
| BREAK_STARTED | ✅ | ❌ | `/workday` (route doesn't exist) |
| SETTINGS_UPDATED | ❌ | — | Not in ACTION_LABELS |
| USER_CREATED | ❌ | — | Not in ACTION_LABELS |
| USER_ROLE_CHANGED | ❌ | — | Not in ACTION_LABELS |
| EXPORT_PERFORMED | ❌ | — | Not in ACTION_LABELS |

**Finding:** Many new OperationalAction enum values added in P1-B are NOT mapped in either `EventsController.ACTION_DESCRIPTIONS` or `RecentActivityFeed.ACTION_LABELS`. They will display as raw action names like "ticket updated" (via fallback `.replace(/_/g, ' ').toLowerCase()`). Not broken, but inelegant.

**Finding:** Events that link to `/workday` — this frontend route does not exist. Clicking these events navigates to a 404.

### 3C. Activity Log Page (`/admin/activity`)

- Accessible to TEAM_LEAD and above
- Filters: Today, This Week, Last 7 Days — **"This Week" and "Last 7 Days" are identical** (both set `from` to 7 days ago) 🟡 Bug #8
- `/events` endpoint for TEAM_LEAD/MANAGER: shows only own events
- Page subtitle for MANAGER+ says "Operational event timeline for your team" — **false promise** 🟡 Bug #1 (same root cause)
- Only admins can filter by user via `?userId=` param — not exposed in UI

---

## PART 4 — WORKDAY / LOGIN BEHAVIOR FINDINGS

### 4A. Login vs Start Work — What Actually Happens

**CORRECTLY SEPARATED:**

| Action | DB Status | User.currentStatus | Attendance Event |
|--------|-----------|-------------------|-----------------|
| Login | WorkSession: LOGGED_IN | LOGGED_IN | `LOGIN` |
| Start Work | WorkSession: WORKING | WORKING | `START_WORK` |
| End Break / Resume | WorkSession: WORKING | WORKING | `BREAK_END` / `RESUME_WORK` |
| Take Break | WorkSession: ON_BREAK | ON_BREAK | `BREAK_START` |
| End Day | WorkSession: LOGGED_OUT | LOGGED_OUT | `LOGOUT` |
| Idle 20+ min | WorkSession: IDLE | IDLE | `IDLE_DETECTED` |
| Logout (app) | No DB change ❌ | Unchanged ❌ | None ❌ |

**WorkdayBar UI correctly shows** four distinct states: OFFLINE (not started), LOGGED_IN (yellow — "workday not started"), WORKING (green), ON_BREAK (orange), IDLE (yellow), LOGGED_OUT (gray), ON_LEAVE (blue).

### 4B. Critical Workday Gap — Logout Does NOT End Workday

**Bug #2 (Medium — Business Rule Violation):**  
`logout()` in `auth.store.ts` does:
```typescript
localStorage.removeItem('apex_token');
set({ user: null, token: null, isAuthenticated: false });
```
**No API call to `/workday/end`.** If a user clicks Logout without clicking "End Day" first, their WorkSession remains WORKING or LOGGED_IN status indefinitely.

**Expected product rule**: Login ≠ Start Work (correctly implemented). But Logout should also NOT silently abandon an active session. Either:
- Option A: On logout, auto-call `/workday/end` if session is active
- Option B: Show a confirmation modal: "Your workday is still active. End workday before logging out?"

### 4C. Midnight Reset Does Not Write logoutAt

**Bug #3 (Low-Medium — Data Integrity):**  
`SchedulerService.setLeaveStatuses()` at 00:01 runs:
```typescript
await this.prisma.user.updateMany({ where: {...}, data: { currentStatus: 'OFFLINE' } });
```
This resets `user.currentStatus` to OFFLINE but does **NOT** update the WorkSession:
- `WorkSession.status` remains WORKING/LOGGED_IN (never LOGGED_OUT)
- `WorkSession.logoutAt` remains null
- `WorkSession.totalWorkMinutes` remains as calculated from `startWorkAt` to whenever it was last calculated (not end of day)

Any work time report run on the next day will show sessions with null `logoutAt` and potentially incorrect `totalWorkMinutes`.

**Expected:** Midnight should close open sessions: set `logoutAt = 23:59`, `status = LOGGED_OUT`, calculate final `totalWorkMinutes`, and add an `AUTO_CLOSE` attendance event.

### 4D. Auto-Logout Behavior

| Scenario | What happens | Expected |
|----------|-------------|---------|
| User idle 2+ hours (between 9am-8pm) | Status → OFFLINE, WorkSession → LOGGED_OUT ✅ | Correct |
| User idle outside 9am-8pm | Nothing (cron skips) ✅ | Correct |
| User closes browser tab (no idle report) | Session stays WORKING indefinitely until midnight | Gap — needs stale-session detection |
| User ends break, browser crashes | Session stays ON_BREAK until midnight | Acceptable |

### 4E. Auto-End Reminder

At 18:30 Mon-Sat, `workdayEndReminder()` cron sends push notification to WORKING/ON_BREAK/IDLE users.  
**Correct.** Does NOT auto-close — user must manually end day. This is the right behavior.

### 4F. Can Managers See Who Hasn't Ended Day?

**Bug #4 (Medium — Visibility Gap):**  
The Team → Live Status view shows real-time `workStatus` per team member. However:
- TEAM_LEAD cannot see Live Status tab — `canSeeStatus = ['MANAGER', 'ADMIN', 'SUPER_ADMIN']` **excludes TEAM_LEAD** 🔴
- The live status does show who is WORKING, ON_BREAK, LOGGED_IN (not started) — but does NOT highlight "not ended day" as a specific alert state
- No dashboard warning for managers about unclosed sessions at end of day

### 4G. Should Logout and End Day Be Separate?

**Answer (business rule, not a bug):** YES — they are correctly separate by design. But the UI needs to:
1. Warn users before logout if workday is still active
2. TEAM_LEAD should see Live Status to know who hasn't ended day

---

## PART 5 — ROLE-BY-ROLE DASHBOARD EXPERIENCE

### SUPER_ADMIN
**Working correctly:**
- Sees global active users, open tickets, overdue, pending leave on KPI strip
- SLA risk banner appears when there are at-risk tickets
- Critical alerts panel shows overdue/review/leave alerts
- Team page shows Company Directory + Live Status tabs
- Activity feed shows all org activity ✅

**Issues:**
- "Active Projects" CommandCard always shows 0 (Bug #6)
- "High Priority Tickets" CommandCard shows overdue count — mislabeled (Bug #5)
- Announcement Broadcast always says "No active broadcasts" (Bug #7)
- SUPER_ADMIN in `team_lead` mode loses Analytics, Users, Departments nav — correct but mode switch is subtle

### ADMIN
**Working correctly:**
- Same dashboard KPIs as SUPER_ADMIN
- Leave Management: "Needs Action" tab default ✅
- Users & Roles and Departments in sidebar ✅

**Issues:**
- Same CommandCard bugs as SUPER_ADMIN
- Activity feed shows all org events ✅

### MANAGER
**Working correctly:**
- Dashboard: Dept Tickets, Overdue, Pending Leave, Team Size KPIs
- "Needs Action" tab on Leave page default ✅
- Analytics page accessible ✅
- Team page: My Team + Live Status tabs ✅
- Leave approvals with hierarchy check ✅

**Issues:**
- Activity feed (dashboard + Activity Log page) only shows OWN events, not dept/team events 🔴 Bug #1
- "Active Projects" always 0 🔴 Bug #6

### TEAM_LEAD
**Working correctly:**
- Dashboard: Team Tickets, Overdue, Pending Reviews, Team Online KPIs
- Team page shows own dept members + directory ✅
- Can approve leave ✅
- SLA risk banner ✅

**Issues:**
- Live Status tab HIDDEN from TEAM_LEAD despite being the primary workday visibility tool 🔴 Bug #4 (partial)
- Activity feed only shows own events, not team events 🔴 Bug #1
- Activity Log page shows only own events but page says "team timeline" 🔴

### EMPLOYEE
**Working correctly:**
- Dashboard: Open, In Progress, In Review, Done This Week KPIs
- Workday bar shows correct LOGGED_IN / WORKING states ✅
- Can apply leave, see own leave ✅
- Tickets scoped to owned/assigned ✅

**Issues:**
- "High Priority Tickets" CommandCard = 0 always (Bug #5)
- "Active Projects" = 0 always (Bug #6)
- "In Review" CommandCard shows tickets user can see in REVIEW state — this may include OTHER people's tickets depending on scope (minor)
- Employee can apply leave without submitting reason (form only makes reason optional client-side; server also doesn't enforce it as required — minor)

### INTERN
**Working correctly:**
- Same as EMPLOYEE — tickets, leave, projects, kanban visible
- No Team or Analytics links ✅
- No admin access ✅

**Issues:**
- Same CommandCard 0-value bugs
- INTERN has Calendar link in sidebar — this is fine if calendar shows own upcoming items
- No differentiated empty state messaging to guide interns on what to do first

---

## PART 6 — UI CONFUSION LIST

### 6A. Labels / Terminology

| Location | Current Label | Issue | Recommended |
|----------|-------------|-------|-------------|
| Dashboard CommandCard | "High Priority Tickets" | Shows `overdue` count, not high priority count | "Overdue Tickets" |
| Dashboard CommandCard | "Active Projects" | Always shows 0 | Fix data mapping |
| Announcement Broadcast | "No active broadcasts today" | Shown even when there ARE critical alerts | Fix severity mapping |
| Activity Log page | "Operational event timeline for your team" | For MANAGER/TL, shows only own events | "Your activity timeline" or fix data |
| Activity Log filter | "This Week" and "Last 7 Days" | Both set same 7-day window | Remove duplicate; add "Last 30 Days" |
| WorkdayBar | "Not started" | OFFLINE status shown as "Not started" — correct | ✅ |
| WorkdayBar | "Logged in - workday not started" | Yellow bar on LOGGED_IN — good UX signal ✅ | ✅ |
| Leave page tab | "Needs Action" | Shows for MANAGER+ — clear ✅ | ✅ |
| Team Request button | "Add" → "Requested" | Pending request UI state disappears on page reload — only tracked in React state | Save to localStorage or backend-query on mount |

### 6B. Buttons That Appear But Do Nothing / Have Wrong Behavior

| Location | Button/Action | Issue |
|----------|-------------|-------|
| Activity feed items (Workday events) | Click → navigate to `/workday` | Route `/workday` does not exist — 404 |
| Dashboard "Open Operations Directory" button | Opens QuickActionPalette | Works, but QuickActionPalette in layout (Alt+K) and in dashboard page use different prop interfaces (`isOpen` vs `open`, `actions` vs internal). One may fail silently. |
| Team page "Add" button | Creates pending request | Request is lost on page reload (tracked in React state only, not persisted) |
| Team request notification to manager | Manager gets notification | Notification message hardcodes "AI & R&D team" regardless of team |

### 6C. Pages with Empty Data Despite Backend Having Data

| Page | Condition | Issue |
|------|---------|-------|
| Dashboard "Active Projects" card | Any role | Always 0 — metrics don't include `activeProjects` |
| Dashboard "High Priority Tickets" | EMPLOYEE/INTERN | Always 0 — wrong metric field used |
| Activity Log | MANAGER/TEAM_LEAD | Only shows own events despite UI implying team scope |
| RecentActivityFeed | MANAGER/TEAM_LEAD | Only own events |

### 6D. Role Actions Visible to Wrong People

| Location | Issue |
|----------|-------|
| Leave page approve/reject buttons | Frontend uses `ROLE_LEVEL` hierarchy check to show/hide buttons. This is a client-side copy of server logic. A mismatch could show buttons that fail server-side. Low risk but violates single source of truth. |
| Analytics page URL `/analytics` | No route guard — EMPLOYEE/INTERN can navigate to analytics by typing the URL. Server data is scoped correctly, but page renders and shows data from their scope. Minor. |
| Admin Activity Log URL `/admin/activity` | EMPLOYEE can navigate to this URL. Server scopes to own events, so data is safe. But page is labeled "Workday Activity Log" with no role gate. |

### 6E. Missing Helper Text / Empty States

| Location | Missing |
|----------|---------|
| WorkdayBar OFFLINE state | Subtitle says "Click to begin your workday" ✅ — good |
| Dashboard EMPLOYEE with no tickets | Shows 0-value KPI cards with no context — no "Get started: create your first ticket" guidance |
| Projects empty state | ✅ Has good empty state |
| Team page (TL/EMP) no team members | Shows "No team members in {dept} yet" ✅ |
| Leave INTERN "All Requests" tab | Shows all leave in org — INTERN probably shouldn't see everyone's leave |

### 6F. Stale Counts / Refresh Issues

| Data | Refresh interval | Risk |
|------|----------------|------|
| Home summary (KPI strip, alerts) | 60s | Low |
| SLA risk banner | 120s | Low |
| WorkdayBar | 60s + window focus | Low — live elapsed recalculates locally |
| Workday Team (Live Status) | 30s | Low |
| Notifications unread count | WS push | Good ✅ |
| RecentActivityFeed | 30s stale | Could miss events |

### 6G. Inconsistent Status Labels

| Status | Workday Bar Label | Team Live Status Label | User.currentStatus value |
|--------|-------------------|----------------------|--------------------------|
| LOGGED_IN | "Logged in - workday not started" | "Logged in" | LOGGED_IN |
| WORKING | "Working · Xh Xm active" | "Working" | WORKING |
| ON_BREAK | "On Break · X min" | "On Break" | ON_BREAK |
| IDLE | "Idle" | "Idle" | IDLE |
| LOGGED_OUT | "Workday ended" | "Ended day" | LOGGED_OUT |
| OFFLINE | "Not started" | "Not started" | OFFLINE |
| ON_LEAVE | "On approved leave today" | "On Leave" | ON_LEAVE |

**Finding:** All status labels are consistent across views. ✅

---

## PART 7 — BROKEN VISIBLE WORKFLOWS

### BRK-001: Team Request Feature Not Persistent
**Symptom:** User clicks "Add" on a team member in the directory. UI shows "Requested" (green). Page reload resets to "Add".  
**Root cause:** `requestedIds` stored in React `useState` only — no backend read on mount.  
**Impact:** TEAM_LEAD/EMPLOYEE think request is pending; on reload they see it's gone.

### BRK-002: Workday Events Link to Non-Existent Route
**Symptom:** Clicking a WORKDAY_STARTED or BREAK_STARTED activity item navigates to `/workday` — returns 404.  
**Root cause:** `EventsController.getEntityUrl()` maps `WorkdaySession` to `/workday` — this route doesn't exist in the Next.js frontend.  
**Fix:** Remove entity URL for workday events OR create a `/workday` redirect to `/dashboard` (where WorkdayBar lives).

### BRK-003: Announcement Broadcast Always "No active broadcasts"
**Symptom:** Even with 3 active critical alerts (overdue tickets + leave pending), the Announcement Broadcast component shows "No active broadcasts today".  
**Root cause:** Severity mismatch (see Bug #7 in Part 2C).

### BRK-004: Active Projects CommandCard Always 0
**Symptom:** "Active Projects" card on dashboard shows 0 for all roles.  
**Root cause:** `metrics.activeProjects` is not in the `getMetrics()` response for any role. Only `getOverview()` (unused by dashboard) returns `activeProjects`.  
**Fix:** Add `activeProjects: await this.prisma.project.count({ where: { status: 'ACTIVE' } })` to `getMetrics()` response for all roles.

### BRK-005: High Priority Tickets Card Shows 0 for EMPLOYEE
**Symptom:** EMPLOYEE dashboard shows "High Priority Tickets: 0".  
**Root cause:** Card uses `metrics.overdue ?? 0` but EMPLOYEE metrics don't include `overdue`.  
**Fix:** For EMPLOYEE role, change this card to show "In Review" or remove it.

---

## PART 8 — BACKEND WORKS BUT UI UNCLEAR

### BCK-001: `DashboardService.getActivityFeed()` Is Fully Department-Scoped But Unused
The service correctly scopes activity by department for non-admins. It exists, it's correct, but no endpoint or frontend component calls it in the right way for managers. The `/events` endpoint is used instead, which has no department scoping for non-admins.

### BCK-002: Activity Logs Have Rich Metadata But UI Shows Simple Text
`operational_logs` records include `metadata` (e.g., `{ oldStatus, newStatus }` for status changes, `{ ticketId, filename }` for uploads). UI shows "completed a ticket" — the ticketId in metadata is never surfaced in the feed.

### BCK-003: Workday Session Has Full Break Log But Dashboard Doesn't Show It
`WorkSession` includes complete breakLog array with types and durations. WorkdayBar shows counts/totals but no detail. Managers viewing Live Status see break count + total minutes but not break types. This data exists and could be useful for HR review.

### BCK-004: Leave Balance Service Exists But Entitlement Not Shown in Leave Page
`LeaveBalanceService` calculates remaining leave entitlements. The leave page shows only request lists. There's no visible remaining balance ("You have 8 annual leave days remaining"). Users can't easily see how much leave they have left before applying.

### BCK-005: `getTeam()` Returns Full Session Data (Work Minutes, Break Count) But Team Page Shows "—" for unclosed sessions
Team Live Status shows `workMinutesToday: session?.totalWorkMinutes ?? 0`. For an actively WORKING user, `totalWorkMinutes` is null (only set on endWork). The backend `getToday()` calculates `elapsedWorkMinutes` for this case, but `getTeam()` uses `totalWorkMinutes` directly — so live working users show "—" minutes. 🟡

### BCK-006: `getUpcomingEvents()` Returns Leave Starts for Managers — But Workers Can't See Upcoming Team Leave
The upcoming events section on the dashboard correctly shows upcoming approved leave for the manager's scope. But an EMPLOYEE cannot see if their colleague is going on leave (which might affect project handoffs). This is a privacy decision — document it.

### BCK-007: Settings Page Has Full System Configuration But No Change Tracking UI
`SETTINGS_UPDATED` audit event is wired. Settings changes are logged. But there's no history/changelog visible in the settings UI to show what changed and when.

---

## PART 9 — UI SHOWS FEATURE BUT BACKEND IS MISSING OR INCOMPLETE

### UI-MISS-001: Team Request Backend Hardcodes "AI & R&D team"
`TeamService.sendTeamRequest()` hardcodes:
```typescript
`...to be added to the AI & R&D team.${reasonText}`
```
The actual team/department of the requester is available but not used. Notification shows wrong department name for all other departments.

### UI-MISS-002: QuickActionPalette Prop Interface Inconsistency
Layout uses: `<QuickActionPalette isOpen={paletteOpen} onClose={...} actions={paletteActions} />`  
Dashboard uses: `<QuickActionPalette open={paletteOpen} onClose={...} onSelectAction={...} />`  
These are different prop shapes. One of these will silently not open or not close correctly.

### UI-MISS-003: `/workday` Route Does Not Exist
The `EventsController` generates entity URLs mapping `WorkdaySession` → `/workday`. No such page exists in the frontend routing. Should either be `/dashboard` (where WorkdayBar is) or a dedicated workday history page.

### UI-MISS-004: "Calendar" Page Scope Unclear
`/calendar` is in BASE_NAV for all roles. The calendar page pulls ticket due dates and approved leave. It's unclear if INTERN sees all org leave/tickets or just their own. No QA source to verify — recommend verifying the calendar data scope for INTERN.

### UI-MISS-005: Analytics Page Has No Role Guard
`/analytics` has no frontend role guard. Any user who types the URL navigates there. Analytics data is correctly scoped by role server-side, so no data leak, but an EMPLOYEE seeing analytics UI with their own scoped data may be confusing.

---

## PART 10 — TOP 25 BUSINESS RULE QUESTIONS REQUIRING OWNER DECISION

1. **When a user logs out without ending their day, what should happen?**  
   Option A: Auto-end workday on logout. Option B: Warn with modal. Option C: Leave open until midnight.

2. **Should TEAM_LEAD be able to see Live Status of their team?**  
   Currently hidden. All indicators suggest TL should see it.

3. **Should the activity feed for MANAGER show their team's activity or only their own?**  
   Current: own only. Expected (per the brief): team/dept scoped.

4. **What is the intended behavior when a work session is never closed?**  
   Midnight reset marks user OFFLINE but doesn't close the WorkSession. Is that a reportable error?

5. **Should MANAGER see their own leave requests in the "Needs Action" tab or a separate "My Requests" tab?**  
   Currently both tabs exist and MANAGER defaults to "Needs Action". Their own requests appear under "My Requests" tab only.

6. **Should INTERN see all leave requests in the "All Requests" tab?**  
   Currently INTERN sees all org leave. Recommendation: scope to own department only for INTERN.

7. **What does "Team Size" metric represent for MANAGER?**  
   Uses `user.count({ where: { departmentId: manager.departmentId } })` — single dept only. If manager manages multiple depts via `managerDeptAccess`, this undercounts.

8. **Should TEAM_LEAD see team analytics (simple dept summary) or only global analytics available to MANAGER+?**  
   Currently TL has no analytics access.

9. **What happens when a leave request is approved for a day that has already passed?**  
   No validation preventing retroactive approvals. Is this intentional?

10. **Should EMPLOYEE be able to see a colleague's profile/workday history?**  
    Currently `canViewUser()` restricts this. EMPLOYEE can only view their own. Is this correct?

11. **Who can create tickets on behalf of others?**  
    Any role can create a ticket. The `reporterId` is set to the creator. Is an INTERN allowed to create tickets for a MANAGER?

12. **What should INTERN's "All Requests" leave tab show — all org or only own department?**  
    See question 6 above.

13. **Should the "Active Today" KPI for ADMIN/SA count LOGGED_IN status as "active"?**  
    Currently it counts `WORKING + ON_BREAK + LOGGED_IN`. A user who logged in at 9am but never started work is shown as "active".

14. **Should logout automatically trigger an attendance event log?**  
    Currently no `LOGOUT` attendance event is created on app logout — only on `endWork()`. The `WORKDAY_ENDED` event is only fired when user clicks "End Day".

15. **Is the 18:30 workday end reminder the authoritative end-of-day signal, or should there be a hard cutoff?**  
    Currently it's a notification only. No auto-close at any specific time.

16. **Should the activity feed show project events (PROJECT_CREATED, etc.)?**  
    P1-B wired all project events to audit logs, but they're not in the feed's ACTION_LABELS map. Is this deliberate?

17. **Who can export the ticket CSV?**  
    Any authenticated user. Should export be restricted to MANAGER+ or remain open?

18. **What should happen if a user submits two leave requests that overlap?**  
    No overlap validation in `leave.service.ts`. Duplicate overlapping requests can be submitted and approved.

19. **Should the "In Review" ticket count on the EMPLOYEE dashboard show ALL tickets they can see in review, or just tickets they created/are assigned to?**  
    Backend uses `buildTicketWhereForUser` which is already scoped — this is correct. But UI label says "pending review" implying their own work, which is accurate.

20. **What is the intended use case for the SUPER_ADMIN's `team_lead` mode?**  
    In TL mode, SA loses Analytics, Users, Departments, and Activity Log from sidebar. Is this a deliberate "focus mode" or a debugging artifact?

21. **Should ticket reassignment (changing assignee) be a distinct activity vs. ticket update?**  
    Currently `TICKET_ASSIGNED` fires on explicit assign action, but `TICKET_UPDATED` fires on any update including reassignment via the update endpoint. Double events possible.

22. **What constitutes a "stale" open WorkSession that should be auto-closed?**  
    Currently: 2 hours of IDLE → auto-logout. But a session left WORKING or LOGGED_IN overnight is never auto-closed.

23. **Should EMPLOYEE be able to cancel their own leave request?**  
    `PATCH /leave/:id/cancel` exists and is available to all authenticated users. The frontend "Apply Leave" modal has no cancel button for existing requests.

24. **Is the team member "Add" request a real workflow or informational?**  
    Currently sends a notification to a hardcoded manager email. No approval/rejection flow visible in the manager's UI for team requests.

25. **Should the dashboard "Upcoming Events" include non-approved leave requests?**  
    Currently only shows APPROVED leave starts. Should PENDING requests appear with a warning icon?

---

## PART 11 — RECOMMENDED FIXES BY PRIORITY

### P1-C Critical UX / Business Rule Fixes (This Sprint — Zero New Features)

| # | Fix | Files | Effort |
|---|-----|-------|--------|
| FIX-01 | TEAM_LEAD can see Live Status tab: add `TEAM_LEAD` to `canSeeStatus` in `team/page.tsx` | `frontend/app/(dashboard)/(operations)/team/page.tsx` | XS |
| FIX-02 | Announcement Broadcast severity mapping: check `severity === 'red'` not `=== 'urgent'` in `dashboard/page.tsx` | `frontend/app/(dashboard)/(core)/dashboard/page.tsx` | XS |
| FIX-03 | Fix "High Priority Tickets" card for EMPLOYEE: use correct metric or replace card | `frontend/app/(dashboard)/(core)/dashboard/page.tsx` | XS |
| FIX-04 | Activity Log page: change subtitle to "Your activity timeline" for non-admin; restore team view by using `DashboardService.getActivityFeed()` endpoint properly | `frontend/app/(dashboard)/admin/activity/page.tsx` | S |
| FIX-05 | Remove duplicate "Last 7 Days" filter option from Activity Log | `frontend/app/(dashboard)/admin/activity/page.tsx` | XS |
| FIX-06 | Add `activeProjects` to all `getMetrics()` role branches | `backend/src/modules/platform/dashboard/dashboard.service.ts` | XS |
| FIX-07 | Fix `/workday` dead link — map `WorkdaySession` entity URL to `/dashboard` | `backend/src/modules/platform/events/events.controller.ts` | XS |
| FIX-08 | Fix Team Request notification to use actual requester department name | `backend/src/modules/operations/team/team.service.ts` | XS |

### P2 Usability Improvements

| # | Fix | Description |
|---|-----|-------------|
| P2-01 | Warn before logout if workday active | Show modal: "Your workday is still running. End workday before logging out?" |
| P2-02 | Midnight auto-close open sessions | Write `logoutAt = 23:59:59`, `totalWorkMinutes` calculation, `AUTO_CLOSE` attendance event |
| P2-03 | Activity feed: expose `DashboardService.getActivityFeed()` via new `/home/activity` endpoint scoped by dept for managers | Wire correctly for MANAGER/TL |
| P2-04 | Show leave balance remaining in Leave page | "8 annual days remaining" banner using `LeaveBalanceService` |
| P2-05 | Live working time in Team Live Status | Use `elapsedWorkMinutes` logic instead of `totalWorkMinutes` for active WORKING sessions |
| P2-06 | Add ACTION_LABELS for new P1-B events | `TICKET_UPDATED`, `TICKET_CLOSED`, `COMMENT_ADDED`, `SETTINGS_UPDATED`, `PROJECT_CREATED`, etc. |
| P2-07 | Persist team requests (fetch on mount) | Store requested state in query cache or show from notifications |
| P2-08 | Leave overlap validation | Reject overlapping leave requests server-side |
| P2-09 | INTERN leave tab scoped to own dept | Hide "All Requests" for INTERN or scope to same-dept only |
| P2-10 | Manager team size metric uses all managed depts | Fix `getMetrics(MANAGER)` to count users across all `managerDeptAccess` departments |
| P2-11 | QuickActionPalette prop unification | Standardize `isOpen`/`open` prop across both usages |

### P3 Polish

| # | Fix | Description |
|---|-----|-------------|
| P3-01 | Dashboard empty state for EMPLOYEE with no tickets | "Welcome! Get started by creating your first ticket" |
| P3-02 | Rich activity feed items (show ticketId from metadata) | "Alice completed TKT-0042" instead of "Alice completed a ticket" |
| P3-03 | Settings change history in settings UI | Show last-modified-by using existing audit log data |
| P3-04 | Dedicated workday history page (`/workday`) | Shows sessions, breaks, daily summary — fixes the dead link too |
| P3-05 | TL Analytics lite view | Simple dept-level ticket trend chart for TEAM_LEAD |
| P3-06 | "In Review" link from dashboard for EMPLOYEE → filters correctly | Currently links to `/tickets?status=REVIEW` — ensure filter applies to scoped view |
| P3-07 | Cancel leave from leave page | "Cancel" button on own PENDING/APPROVED leave requests |
| P3-08 | Activity Log user filter for MANAGER+ | Let MANAGER/TL filter activity by team member name |

---

## SUMMARY TABLE — BUGS BY SEVERITY

| ID | Severity | Location | Description | Effort |
|----|---------|---------|-------------|--------|
| Bug #1 | 🔴 High | Activity feed, EventsController | MANAGER/TL see only own events | M |
| Bug #2 | 🟠 Medium | auth.store.ts, logout flow | Logout doesn't end active workday session | S |
| Bug #3 | 🟠 Medium | scheduler.service.ts | Midnight reset doesn't close WorkSession (no logoutAt) | S |
| Bug #4 | 🟠 Medium | team/page.tsx | TEAM_LEAD cannot see Live Status tab | XS |
| Bug #5 | 🟡 Low | dashboard/page.tsx | "High Priority" card always 0 for EMPLOYEE | XS |
| Bug #6 | 🟡 Low | dashboard.service.ts + page.tsx | "Active Projects" always 0 | XS |
| Bug #7 | 🟡 Low | dashboard/page.tsx | Announcement Broadcast always "No broadcasts" | XS |
| Bug #8 | 🟡 Low | admin/activity/page.tsx | Duplicate filter options (Week = Last 7 Days) | XS |
| Bug #9 | 🟡 Low | events.controller.ts | `/workday` entity URL leads to 404 | XS |
| Bug #10 | 🟡 Low | team.service.ts | Team request hardcodes "AI & R&D team" | XS |
| Bug #11 | 🟡 Low | WorkSession tracking | Live team shows "—" minutes for active workers | S |
| Bug #12 | ℹ️ Info | Admin/Activity page | All new P1-B OperationalActions not mapped in feed | M |

---

## VERDICT

**BUSINESS RULES QA COMPLETE**

All findings documented. No P0/P1 architecture violations. 12 bugs found (1 high, 3 medium, 8 low-to-info). 8 critical fixes recommended for immediate P1-C delivery. Remaining items deferred to P2/P3.
