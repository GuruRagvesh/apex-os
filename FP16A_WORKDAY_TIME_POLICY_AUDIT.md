# FP-16A WORKDAY TIME POLICY + TIMEZONE + AUTO DAY CLOSE + LIVE STATUS FIX AUDIT

## 1. Where is workday start created?
Workday start is created in `backend/src/modules/platform/workday/workday.service.ts` inside the `startWork` method via a Prisma `upsert` on the `WorkSession` model.

## 2. Is it created on login or manual start?
It is created upon manual start (the `startWork` method). Although `loginAt` is set during this process, the session formally moves to `WORKING` status when the user triggers the action.

## 3. What time is stored in DB?
The start time is stored as `new Date()` (current time). The workday date boundary (`date` field) is stored as `new Date().setHours(0,0,0,0)`. 

## 4. Is DB storing UTC?
Yes, Prisma and the database store `DateTime` fields in UTC. However, `new Date().setHours(0,0,0,0)` produces the server's local midnight time represented in UTC, which means the date boundary is heavily dependent on the server's timezone configuration.

## 5. What timezone is displayed in frontend?
The frontend displays time based on the user's local browser timezone using standard JS `toLocaleTimeString()`. 

## 6. Is frontend converting incorrectly?
Yes, because the requirement specifies that all workday/ticket/break times should be displayed in the **Company Timezone** (default: `Asia/Kolkata`), not the viewer's local timezone.

## 7. Is server timezone affecting date boundaries?
Yes. The date grouping logic uses `getTodayDate()` which falls back to the local server timezone, leading to potential session overlap across dates if the server is not set to the company timezone.

## 8. Where are breaks stored?
Breaks are stored in the `BreakLog` model within `schema.prisma`.

## 9. Are break reasons stored?
The `BreakLog` model currently has `breakType` and `note` fields, but it lacks a formal `reason` string and `source` enum/string (e.g., MANUAL_BREAK, LOGOUT_AWAY, AUTO_CLOSE) required by the business rules.

## 10. Are logout/away durations stored?
Currently, if a user logs out, the session is updated with a `logoutAt` timestamp. However, it does not explicitly create a `BreakLog` for the away duration, which is required by the new rules to render "Logout/Away" in the break display.

## 11. Is there an existing scheduler for daily/recurring jobs?
Yes, `backend/src/modules/platform/scheduler/scheduler.service.ts` manages cron jobs.

## 12. Does auto-close exist already?
Yes, but it is flawed. `setLeaveStatuses` runs at 00:01 and auto-closes yesterday's unclosed sessions to 23:59:59. It does not properly stop active ticket timers, nor does it log a `AUTO_MIDNIGHT_CLOSE` reason. It also relies on the server's local midnight.

## 13. What company timing settings exist?
There is a generic `AppSetting` model (key-value JSON store). We can use this to store the global `workday_policy` JSON.

## 14. What individual timing fields exist?
None currently exist. We must create a `UserWorkdayPolicyOverride` model in the schema to support individual future-ready overrides.

## 15. Where is live user status shown?
Live user status is fetched via `workday.service.ts` -> `getTeam` and rendered in the frontend under `frontend/app/(dashboard)/(operations)/team/page.tsx` (`LiveStatusView` component).
