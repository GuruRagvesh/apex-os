# FP18E Policy Auto Stop Audit

## 1. What shape does getWorkdayPolicy() return?
It returns a JSON object configured in `settings.service.ts`:
```json
{
  "timezone": "Asia/Kolkata",
  "minimumWorkdayMinutes": 540,
  "employeeTiming": { "start": "09:30", "end": "18:30", "flexible": false },
  "tlTiming": { "entryStart": "09:30", "entryEnd": "10:30", "exitStart": "18:30", "exitEnd": "19:30", "minimumWorkdayMinutes": 540 },
  "managerTiming": { "flexible": true },
  "autoClose": true
}
```

## 2. Where is autoClose enabled/disabled stored?
Inside the `workday_policy.autoClose` boolean.

## 3. Which role-specific timing fields exist?
* `employeeTiming.end` (e.g., `"18:30"`) applies to EMPLOYEE and INTERN roles.
* `tlTiming.exitEnd` (e.g., `"19:30"`) applies to TEAM_LEAD role.
* `managerTiming.flexible` applies to MANAGER, ADMIN, SUPER_ADMIN roles.

## 4. How does system identify user role for WorkSession?
`WorkSession` contains `userId`. A lookup to the `User` table (including `role`) is required to determine if they are `EMPLOYEE`, `TEAM_LEAD`, or `MANAGER`.

## 5. Which sessions are currently auto-closed at midnight?
The `scheduler.service.ts` currently loops over active sessions and closes them if `sessionCompanyDateStr < currentCompanyDateStr` (stale previous-day sessions).

## 6. How are current-day sessions protected?
In `scheduler.service.ts`, there is an explicit guard:
```typescript
if (sessionCompanyDateStr >= currentCompanyDateStr) {
  continue; // It's from today, skip auto-close
}
```

## 7. Where should policy-based same-day auto-stop run?
It should run in `scheduler.service.ts`, perhaps as a new block within `autoCloseMidnightSessions` (or a dedicated `policyAutoStopSessions` method called concurrently), targeting sessions where `sessionCompanyDateStr == currentCompanyDateStr`.

## 8. How will active ticket logs be paused?
By calling `ticketLedger.pauseActiveLogsForUser({ userId: session.userId, pauseReason: 'POLICY_AUTO_STOP', endedAt: now })`.

## 9. How will notifications be sent?
Using `notificationEventService.sendNotification(userId, ...)` explicitly sending a `WARNING` notification.

## 10. What fields are needed in API/UI to show policy auto-stopped status?
We will use existing fields:
* `status: 'AUTO_CLOSED'` or `'LOGGED_OUT'` (we will use `AUTO_CLOSED` to trigger the front-end to say it was auto-closed, or perhaps `LOGGED_OUT` + `autoClosed: true`).
* `autoClosed: true`
* `closureReason: 'POLICY_AUTO_STOP'`
