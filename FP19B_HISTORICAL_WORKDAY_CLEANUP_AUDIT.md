# FP-19B Historical Workday Cleanup Audit

## Phase 1: Audit Schema and Data Flow

**1. What fields identify WorkSession start?**
`loginAt` and `startWorkAt`. The `date` field represents the company date of the session.

**2. What fields identify WorkSession end?**
`logoutAt`.

**3. How are BreakLogs linked?**
Through the `workSessionId` field on the `BreakLog` model, relating to `WorkSession.id`.

**4. What fields indicate auto-close?**
`autoClosed` (Boolean) and `autoClosedAt` (DateTime) on the `WorkSession` model.

**5. What fields indicate closure reason?**
`closureReason` (String) on the `WorkSession` model.

**6. Where does dashboard recent session data come from?**
It comes from `WorkdayService.getHistory(userId)`, which is fetched via `workdayApi.getHistory`.

**7. Is Recent Sessions currently rendering raw sessions or daily grouped summaries?**
The backend `getHistory` method already groups sessions into daily summaries by `companyDate`. The frontend renders these daily summaries.

**8. Which records are causing duplicate days?**
The frontend is calculating the display date ("Today", "Jun 3") based on local time conversion of `firstStartTime` instead of strictly using the `companyDate` string. If a user starts a session late at night (company date A) and another session in the morning (company date B), both `firstStartTime` values might fall on the same local date, resulting in multiple "Today" rows.

**9. Which records are causing impossible totals?**
Old, unclosed sessions where `logoutAt` is null but the session date is far in the past. When these are eventually closed, or if their durations are calculated based on current time, the elapsed time can exceed 16 hours. Additionally, previously manually closed sessions with incorrect timestamps can have `totalWorkMinutes` > 960.

**10. Can these records be repaired with existing fields?**
Yes. For open sessions, we can set `logoutAt` to the expected auto-close time, set `autoClosed = true`, update `closureReason`, and calculate the correct `totalWorkMinutes`. No new fields are required.

**11. Is a DB migration required? Prefer no.**
No database migration is required. Existing schema fields are sufficient for the repair.
