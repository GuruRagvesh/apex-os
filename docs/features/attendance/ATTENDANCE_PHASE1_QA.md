# Attendance Phase 1 — Staging QA Script

Manual staging verification for the unified Workday session finalizer
(`WorkdayService.finalizeWorkSession`, branch `fix/workday-transactional-finalizer`).
To be run once push/deploy to staging is separately approved. **Staging only —
never run the mutating steps below against production.** All verification
SELECTs are read-only and safe to run anywhere you have DB access.

Replace `<USER_ID>` with a real staging test user's `id`, `<SESSION_ID>` with
the WorkSession id returned/observed at each step.

## Prerequisites

- A staging user with no open WorkSession for today.
- `workday_policy` AppSetting configured with `autoClose: true` and a known
  `autoCloseTime` (e.g. `"23:59"`) and `timezone` (e.g. `"Asia/Kolkata"") —
  needed for Steps 6.
- A ticket assigned to the test user with an active (unpaused) time log, to
  exercise the ticket-timer-pause behavior in Steps 2 and 5.

## Step-by-step

### 1. Start Day
**Action:** `POST /workday/start` as the test user.
**Expected DB state:** one `work_sessions` row for today — `status = WORKING`,
`startWorkAt` and `loginAt` set to the action time, `logoutAt = NULL`.
```sql
SELECT id, date, "loginAt", "startWorkAt", "logoutAt", status,
       "totalWorkMinutes", "totalBreakMinutes", "autoClosed", "closureReason"
FROM work_sessions
WHERE "userId" = '<USER_ID>'
ORDER BY "createdAt" DESC LIMIT 1;
```

### 2. Break
**Action:** `POST /workday/break/start` with a non-MEETING type (e.g. `TEA`).
**Expected DB state:** new `break_logs` row, `startAt` = action time, `endAt = NULL`.
WorkSession `status` → `ON_BREAK`. The test user's active ticket time log gets
paused (`pauseReason = 'BREAK'`, `breakLogId` set to the new break's id).
```sql
SELECT id, "breakType", "startAt", "endAt", "durationMinutes"
FROM break_logs WHERE "workSessionId" = '<SESSION_ID>'
ORDER BY "startAt" DESC;

SELECT id, "ticketId", "startedAt", "endedAt", "pauseReason", "breakLogId"
FROM ticket_time_logs
WHERE "userId" = '<USER_ID>'
ORDER BY "updatedAt" DESC LIMIT 5;
```

### 3. Resume (end break)
**Action:** `POST /workday/break/end`.
**Expected DB state:** the open break's `endAt`/`durationMinutes` set —
`durationMinutes` must be a non-negative integer (Attendance Phase 1 fix:
`endBreak` now clamps this). WorkSession `status` → `WORKING`,
`totalBreakMinutes` incremented by that duration. The paused ticket log from
Step 2 resumes — a **new** `ticket_time_logs` row for the same ticket with
`endedAt IS NULL` (the original paused row stays closed; resume creates a
fresh log, it does not un-pause the old one).
```sql
-- re-run the break_logs SELECT from Step 2, confirm endAt is now populated
-- re-run the ticket_time_logs SELECT, confirm a new endedAt IS NULL row exists for the ticket
SELECT "totalBreakMinutes", status FROM work_sessions WHERE id = '<SESSION_ID>';
```

### 4. Meeting break
**Action:** `POST /workday/break/start` with `breakType = MEETING`, then
`POST /workday/break/end`.
**Expected DB state:** the MEETING break closes normally (`endAt`/
`durationMinutes` set), but `work_sessions.totalBreakMinutes` does **not**
increase — meeting time counts as work, not break, per the settled rule.
```sql
-- compare totalBreakMinutes before and after this step — must be unchanged
SELECT "totalBreakMinutes" FROM work_sessions WHERE id = '<SESSION_ID>';
```

### 5. Idle-timeout simulation
**Action:** Go idle (stop interacting) until the frontend fires
`POST /workday/idle` with `idleDuration >= 20`, which sets `currentStatus =
IDLE`. Then either wait for 2+ real hours of continued inactivity within the
scheduler's 9am–8pm active window, or use whatever staging-only mechanism the
team already has for backdating `lastActiveAt` on a **staging** user — do not
improvise a new one here. Wait for the next hourly `autoLogoutInactive` cron
tick after the 2-hour threshold passes.
**Expected DB state:** the IDLE session gets fully finalized — every open
break closed, `totalWorkMinutes`/`totalBreakMinutes` frozen, active ticket
logs paused (`pauseReason = 'AUTO_LOGOUT'`), `status = LOGGED_OUT` (not
`AUTO_CLOSED` — deliberately preserved from this path's existing semantics),
`closureReason = 'AUTO_LOGOUT_INACTIVE'`, `logoutAt` set. `users.currentStatus
= OFFLINE`.
```sql
SELECT status, "logoutAt", "closureReason", "totalWorkMinutes",
       "totalBreakMinutes", "autoClosed"
FROM work_sessions WHERE id = '<SESSION_ID>';

SELECT id FROM break_logs WHERE "workSessionId" = '<SESSION_ID>' AND "endAt" IS NULL;
-- must return 0 rows

SELECT id FROM ticket_time_logs WHERE "userId" = '<USER_ID>' AND "endedAt" IS NULL;
-- must return 0 rows

SELECT "currentStatus" FROM users WHERE id = '<USER_ID>';
```

### 6. Auto-close window (policy auto-stop / stale close)
**Action — same-day policy auto-stop:** with a fresh session still open past
the configured `autoCloseTime` and no activity for 20+ minutes (the grace
window), wait for the next 15-minute `autoCloseMidnightSessions` tick.
**Action — stale/midnight close:** leave a session open overnight; check the
next day after the cron has run.
**Expected DB state (either sub-case):** same shape as Step 5 — every open
break closed, totals frozen, ticket logs paused — but `status = AUTO_CLOSED`,
`autoClosed = true`, `autoClosedAt` set, and `closureReason` is
`'POLICY_AUTO_STOP'` (same-day) or `'AUTO_CLOSE'` (stale/retrospective). For
the stale case, `logoutAt` must equal the *previous* day's configured
`autoCloseTime`, not the moment the cron happened to run.
```sql
SELECT status, "logoutAt", "closureReason", "autoClosed", "autoClosedAt",
       "totalWorkMinutes", "totalBreakMinutes"
FROM work_sessions WHERE id = '<SESSION_ID>';
```

### 7. Re-login next morning
**Action:** `POST /workday/start` on the new calendar day.
**Expected DB state:** a **new** `work_sessions` row for the new date —
`continuationOfSessionId IS NULL` (that link is same-day-resume-only, not
cross-day). The previous day's session is untouched — still showing exactly
the terminal state written in Step 5 or 6, not overwritten.
```sql
SELECT id, date, "startWorkAt", "continuationOfSessionId"
FROM work_sessions WHERE "userId" = '<USER_ID>'
ORDER BY "createdAt" DESC LIMIT 2;
-- top row = today's new session (continuationOfSessionId NULL)
-- second row = yesterday's closed session, fields unchanged since Step 5/6
```

## Consolidated end-state check

Run after all 7 steps, across the full date range touched:
```sql
SELECT date, status, "logoutAt", "closureReason", "totalWorkMinutes",
       "totalBreakMinutes", "autoClosed"
FROM work_sessions
WHERE "userId" = '<USER_ID>'
ORDER BY date DESC, "createdAt" DESC;

SELECT id, "breakType", "startAt", "endAt", "durationMinutes"
FROM break_logs
WHERE "workSessionId" IN (
  SELECT id FROM work_sessions WHERE "userId" = '<USER_ID>'
)
ORDER BY "startAt";
-- every row must have endAt NOT NULL by end of script

SELECT "eventType", timestamp, source, metadata
FROM attendance_events
WHERE "userId" = '<USER_ID>'
ORDER BY timestamp;

SELECT action, metadata, timestamp
FROM operational_events
WHERE "actorId" = '<USER_ID>' AND "entityType" = 'WorkdaySession'
ORDER BY timestamp;
-- exactly one WORKDAY_ENDED-mapped entry per genuine closure event
-- (Steps 5, 6, and the manual endWork path if exercised) — no duplicates
-- even if a step's finalizer call happens to run twice
```
