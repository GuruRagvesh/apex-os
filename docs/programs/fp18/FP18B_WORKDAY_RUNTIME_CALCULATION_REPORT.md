# FP18B WORKDAY RUNTIME CALCULATION REPORT

## Audit Findings

**1. Which fields represent WorkSession start time?**
- `loginAt` represents the initial session creation timestamp (e.g. system login).
- `startWorkAt` represents when the user explicitly clicks "Start Work". This is the actual start time for tracking work minutes.

**2. Which fields represent WorkSession end time?**
- `logoutAt` represents the final closure time of the session (either manual End Day or system auto-close).

**3. How is totalLoggedMinutes calculated?**
- In the current implementation, `totalLoggedMinutes` is a field on the `WorkSession` model but it is **not** actively calculated or updated by the backend logic in `endWork()` or any scheduler task. It remains 0.

**4. How is totalBreakMinutes calculated?**
- The system sums the `durationMinutes` of all closed breaks in `session.breakLogs`.
- If there is an active (open) break, its duration is calculated dynamically as `(now - openBreak.startAt)` and added to the sum.
- When `endWork()` runs, any open break is formally closed and its final duration is saved.

**5. How is totalWorkMinutes / elapsedWorkMinutes calculated?**
- For closed sessions, the saved `totalWorkMinutes` field is used.
- For active sessions, it is computed dynamically: `(now - startWorkAt) - totalBreakMinutes` (where `totalBreakMinutes` dynamically includes any active break duration).

**6. How are multiple same-day sessions aggregated?**
- `WorkdayService.getToday()` and `WorkdayService.getTeam()` iterate over all sessions matching the current date for a user.
- They sum `totalWorkMinutes` and `totalBreakMinutes` across all sessions.
- This ensures that if a user has an auto-closed session and a resumed session on the same day, the frontend displays the aggregate total correctly.

**7. How is firstStartTime selected?**
- The system iterates over all daily sessions in ascending chronological order (`orderBy: { createdAt: 'asc' }`) and assigns `firstStartTime` to the `startWorkAt` of the very first session that has a value.

**8. How is latest/current end time selected?**
- The system assigns `currentEndTime` to the `logoutAt` of the last session in the array. If the last session does not have a `logoutAt` (i.e., it is currently active), `currentEndTime` is set to `now`.

**9. How is active break detected?**
- By searching the session's `breakLogs` array for an entry where `endAt` is `null`.

**10. How is company timezone applied?**
- `TimezoneUtil.getCompanyTodayDate(timezone)` is used. It takes the current UTC time, applies the timezone offset (e.g., `Asia/Kolkata`), zeroes out the hours/minutes/seconds to midnight in that local timezone, and converts it back to a UTC `Date` object that perfectly represents the start of the local day.

**11. How is today’s company date boundary calculated?**
- Using `date-fns-tz`'s `formatInTimeZone` combined with string parsing to construct the midnight UTC boundary relative to the company's timezone string.

**12. Does Team page use the same calculation as WorkdayBar?**
- Yes, `WorkdayBar` calls `GET /workday/today` (`WorkdayService.getToday()`) and the Team page calls `GET /workday/team` (`WorkdayService.getTeam()`). Both perform the exact same loop-based aggregation logic over multiple sessions. (Note: The logic is duplicated in the backend).

**13. Does Dashboard use the same calculation or old single-session logic?**
- **BUG**: The Dashboard uses **single-session logic**. `DashboardService.getWorkdayStatus()` currently only fetches `findFirst({ orderBy: { createdAt: 'desc' } })` and returns that one session, ignoring any prior auto-closed sessions from the same day. This will lead to inconsistent totals between the Dashboard and the WorkdayBar/Team page.
