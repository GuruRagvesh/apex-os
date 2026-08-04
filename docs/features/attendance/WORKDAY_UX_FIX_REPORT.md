# Workday UX Fix Report
**Phase:** UX Fix 5 — Workday Visibility and History UX
**Date:** 2026-05-28
**Status:** COMPLETE

---

## Objective

Make workday state clearly understandable for employees, team leads, and managers — show what is happening now, how long, what to do next, and surface history without adding a new backend or changing any protected services.

---

## Audit Findings

Before any changes:

| Area | Finding |
|------|---------|
| WorkdayBar: Logout warning | ✅ Already in TopBar and Sidebar — `window.confirm` shown when WORKING/ON_BREAK/IDLE |
| WorkdayBar: LOGGED_IN message | ⚠ "Logged in - workday not started" — true but no context for user |
| WorkdayBar: Break timer | ❌ `breakMins` computed once at render time — not a live timer |
| WorkdayBar: Stale session | ❌ If session is from a previous day and never closed, WorkdayBar shows it as still "Working" with no warning |
| WorkdayBar: End Day vs Logout | ✅ Separate buttons; EndDayModal clearly says "End Workday"; logout warning mentions End Day |
| Team Live Status: Start time | ❌ No "Started At" column — couldn't see when members began their session |
| Team Live Status: Stale sessions | ❌ No visual indicator when a member's active session is from a previous day |
| Team Live Status: Empty state | ⚠ Generic "No team members found" — unhelpful when members just haven't started yet |
| Workday History | ❌ `GET /workday/history/:userId` endpoint exists and `workdayApi.getHistory()` is in api.ts, but no UI uses it anywhere |

---

## Fixes Applied

### FIX-1 — WorkdayBar: Live Break Timer
**File:** `frontend/components/workday/WorkdayBar.tsx`

**Problem:** The ON_BREAK state computed `breakMins` as a static expression at render time — the minute count never updated while the break was ongoing.

**Fix:** Added `breakElapsed` state variable + `useEffect` with `setInterval(calc, 10000)` for ON_BREAK status:
```typescript
useEffect(() => {
  if (status !== 'ON_BREAK') { setBreakElapsed(0); return; }
  const openBreak = breakLogs.find((b: any) => !b.endAt);
  if (!openBreak?.startAt) { setBreakElapsed(0); return; }
  const calc = () => {
    setBreakElapsed(Math.floor((Date.now() - new Date(openBreak.startAt).getTime()) / 60000));
  };
  calc();
  const t = setInterval(calc, 10000);
  return () => clearInterval(t);
}, [status, breakLogs]);
```

ON_BREAK render now shows:
- Break type label (formatted: "Lunch Break", "Tea Break", etc.)
- Live elapsed: "12 min so far" (updates every 10s)
- Planned duration if set: "30 min planned"
- Work context: "2h 15m worked today"

---

### FIX-2 — WorkdayBar: Stale Session Detection
**File:** `frontend/components/workday/WorkdayBar.tsx`

**Problem:** If a user left the app without ending their workday, the next morning WorkdayBar would render the WORKING/ON_BREAK/IDLE state from the previous session, with no indication it was stale. The user would be confused.

**Fix:** Added stale detection before all other state renders:
```typescript
const today = new Date().toDateString();
const sessionDate = startWorkAt ? new Date(startWorkAt).toDateString() : null;
const isStaleSession =
  !!session &&
  !['LOGGED_OUT', 'OFFLINE', 'ON_LEAVE'].includes(status) &&
  sessionDate !== null &&
  sessionDate !== today;
```

When stale, renders a prominent amber warning banner:
> **Workday from Wed, May 27 was never closed**
> Your previous session is still open. End it now to keep your records accurate.
> [End Session] button → opens EndDayModal

---

### FIX-3 — WorkdayBar: Improved LOGGED_IN State
**File:** `frontend/components/workday/WorkdayBar.tsx`

**Before:** "Logged in - workday not started" (single line, no context)

**After:**
```
Ready to start
You're logged in — no work time is being tracked yet
```
Users now understand the consequence: time tracking is paused until they hit Start Work.

---

### FIX-4 — Team Live Status: Start Time Column
**File:** `frontend/app/(dashboard)/(operations)/team/page.tsx`

**Problem:** Managers and TLs could see work duration but not when each member started — "1h 45m worked" is meaningless without knowing if they started at 9am or just now.

**Fix:** Added `Started` column displaying `todaySession?.startWorkAt` in `HH:MM` format:
```typescript
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
```

Column shows "9:15 AM" for active sessions, "—" for offline/not-started members.

---

### FIX-5 — Team Live Status: Stale Session Warning Rows
**File:** `frontend/app/(dashboard)/(operations)/team/page.tsx`

**Problem:** No way to see if a team member's "WORKING" status was from a previous day that never ended.

**Fix:** Added `checkStale()` helper and row-level warning indicators:
```typescript
function checkStale(member: any): boolean {
  if (!['WORKING', 'ON_BREAK', 'IDLE'].includes(member.workStatus)) return false;
  const startIso = member.todaySession?.startWorkAt;
  if (!startIso) return false;
  return new Date(startIso).toDateString() !== new Date().toDateString();
}
```

Stale rows get:
- Amber row background (`rgba(245,158,11,0.06)`)
- "⚠ Stale" badge pill next to the status label
- Amber hover background

When any stale sessions exist, a summary banner appears above the table:
> "2 members have a session from a previous day that was never closed — highlighted below"

---

### FIX-6 — Team Live Status: Improved Empty State
**File:** `frontend/app/(dashboard)/(operations)/team/page.tsx`

**Before:** "No team members found" (generic, implies missing data)

**After:**
```
No team members have started their workday yet
Members appear here once they log in and start their session
```
Clarifies this is a temporal state, not a configuration problem.

---

### FIX-7 — Workday History Strip
**Files:**
- `frontend/components/workday/WorkdayHistoryStrip.tsx` (new)
- `frontend/app/(dashboard)/(core)/dashboard/page.tsx` (import + render)

**Problem:** `GET /workday/history/:userId` exists, `workdayApi.getHistory(userId)` exists, but no UI surface showed it anywhere — employees had no visibility into their recent session history.

**Fix:** Created `WorkdayHistoryStrip` — a compact strip below the WorkdayBar on the dashboard. Shows last 7 work sessions:

| Column | Content |
|--------|---------|
| Day | "Today" / "Mon" / "Tue" etc. + date |
| Duration | "7h 30m worked" |
| Breaks | "2 breaks · 45m" |
| Status | "Complete" (green) / "Today" (indigo) / "Open" (gray) + "⚠ Not closed" badge if unclosed non-today session |

- Renders nothing when loading or no history yet (no empty state clutter)
- `staleTime: 120000` — doesn't hammer the API
- Unclosed non-today sessions get amber row background + "Not closed" badge

---

## Architecture Compliance

- ✅ No backend changes made
- ✅ No protected services touched (AccessPolicyService, TicketAccessService, etc.)
- ✅ `workdayApi.getHistory()` was already in `frontend/lib/api.ts` — no new API surface
- ✅ No fake/demo data
- ✅ No P2/P3 features
- ✅ Logout warning was already correctly implemented in TopBar and Sidebar — not duplicated
- ✅ End Day vs Logout distinction was already correctly implemented — not changed

---

## Verification

### TypeScript
- Frontend: **0 errors** (`npx tsc --noEmit`)

### Backend Tests
- **117/117 tests pass** (no backend changes)

### State Coverage

| State | WorkdayBar Behavior | Correct? |
|-------|---------------------|---------|
| OFFLINE | "Not started — Click to begin" + Start Work button | ✅ |
| LOGGED_IN | "Ready to start — no work time tracked yet" + Start Work | ✅ Improved |
| WORKING | Live elapsed timer + break count + start time | ✅ |
| ON_BREAK | Live break timer + break type + planned duration + work context | ✅ Improved |
| IDLE | Resume / Take Break / End Day buttons | ✅ |
| LOGGED_OUT | "Workday ended" + total work time | ✅ |
| ON_LEAVE | "On approved leave today" + leave type | ✅ |
| Stale (prev day) | Amber warning banner with "End Session" → EndDayModal | ✅ New |

### Team Live Status Coverage

| Feature | Status |
|---------|--------|
| Member name + status dot | ✅ |
| Status label + leave badge | ✅ |
| Start time column ("Started") | ✅ New |
| Work time today | ✅ |
| Break count + duration | ✅ |
| Department | ✅ |
| Stale row amber highlight | ✅ New |
| Stale summary banner | ✅ New |
| Meaningful empty state | ✅ Improved |

### History Strip

| Feature | Status |
|---------|--------|
| Shows last 7 sessions | ✅ |
| Day + date label | ✅ |
| Work duration | ✅ |
| Break count + duration | ✅ |
| Complete / Today / Open status badge | ✅ |
| "Not closed" amber badge for unclosed past sessions | ✅ |
| Hides when no history | ✅ |

---

## Files Modified

| File | Type | Change |
|------|------|--------|
| `frontend/components/workday/WorkdayBar.tsx` | Frontend | Live break timer, stale session detection, improved LOGGED_IN message |
| `frontend/components/workday/WorkdayHistoryStrip.tsx` | Frontend (new) | Compact 7-session history strip using existing `workdayApi.getHistory()` |
| `frontend/app/(dashboard)/(core)/dashboard/page.tsx` | Frontend | Import + render WorkdayHistoryStrip below WorkdayBar |
| `frontend/app/(dashboard)/(operations)/team/page.tsx` | Frontend | Start time column, stale row detection, improved empty state |
