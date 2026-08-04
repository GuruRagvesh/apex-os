# FP-19B HISTORICAL WORKDAY CLEANUP ISSUE REGISTER

## 1. Issue: Duplicate "Today" Rows in Recent Sessions
- **Cause:** Frontend calculated `isToday` based on `firstStartTime` rather than `companyDate`, causing two different company dates that fall on the same local date (due to late night shifts vs morning shifts) to both render as "Today".
- **Resolution:** Modified `workday.service.ts` to export `isToday` calculated strictly from `companyDate`, and updated `WorkdayHistoryStrip.tsx` to use this flag and parse `companyDate` securely without local timezone shifts.

## 2. Issue: Runaway Workday Totals (>16 Hours)
- **Cause:** Users failing to end sessions. When eventually closed manually or by system scripts the next day, the `totalWorkMinutes` accumulated massively.
- **Resolution:** Created repair script that flags these sessions as `MANUAL_REVIEW`. A future process must handle resetting their totals based on reasonable heuristics. Open past-date sessions are auto-closed at standard auto-close time.

## 3. Issue: Open Break Logs in Past Sessions
- **Cause:** System didn't automatically close break logs when the workday session was abandoned.
- **Resolution:** Repair script detects open break logs in past sessions and safely closes them at the same time the session is auto-closed.
