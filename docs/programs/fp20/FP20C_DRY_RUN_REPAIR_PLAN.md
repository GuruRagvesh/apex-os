# FP20C_DRY_RUN_REPAIR_PLAN

## Auto-Repair Execution Plan

This dry-run outlines the specific mutations that will occur on the database.

### WS_03 - Active / Open Sessions (Missing Logout)
- **Action:** Missing logout where a clear same-day company cutoff applies and no conflicting next session exists. Set logoutAt to company policy cutoff. Set status to AUTO_CLOSED.
- **Target Records:** 38
- **Rollback Plan:** Take DB snapshot before execution.

### WS_04 - Stale Open Sessions (>12h)
- **Action:** Stale open session where policy cutoff is deterministic and no overlapping valid session exists. Set logoutAt to policy cutoff.
- **Target Records:** 9
- **Rollback Plan:** Take DB snapshot before execution.

### BL_01 - Break Without End Time
- **Action:** Open break inside already closed parent session. Close break at parent logoutAt.
- **Target Records:** 2
- **Rollback Plan:** Take DB snapshot before execution.

### BL_04 - Break Outside Parent Session Window
- **Action:** Clamp break to parent bounds only if parent session bounds are valid and non-overlapping.
- **Target Records:** 39
- **Rollback Plan:** Take DB snapshot before execution.

## Dry-Run Repair Impact Summary

| Classification | Affected Records | Action Definition |
|---|---|---|
| `AUTO_REPAIR` | 88 rows | Will be deterministically mutated via Prisma update. |
| `MANUAL_REVIEW` | 154 rows | Will be flagged and exported to CSV for management. |
| `EXCLUDE_FROM_REPORTING` | 241 rows | Will be flagged as invalid via metadata/status without deletion. |
| `DO_NOT_TOUCH` | 43 rows | Will be ignored completely during repair script execution. |
