# FP20C_REPAIR_POLICY_DECISION

## Overview
This document outlines the final, proposed rules for how historical Workday data anomalies will be handled during the repair phase.

## Policy Rules per Category
### WS_01: Logout Before Start
- **Classification:** `EXCLUDE_FROM_REPORTING`
- **Records Affected:** 7
- **Rule:** Flag record as INVALID_TIME_BOUNDS. Do not delete, but exclude from all analytics and SLA queries.

### WS_02: Missing Start With Logout (Login Only)
- **Classification:** `DO_NOT_TOUCH`
- **Records Affected:** 43
- **Rule:** These contribute 0 productive minutes. Leave as audit logs for system access.

### WS_03: Active / Open Sessions (Missing Logout)
- **Classification:** `AUTO_REPAIR`
- **Records Affected:** 38
- **Rule:** Missing logout where a clear same-day company cutoff applies and no conflicting next session exists. Set logoutAt to company policy cutoff. Set status to AUTO_CLOSED.

### WS_04: Stale Open Sessions (>12h)
- **Classification:** `AUTO_REPAIR`
- **Records Affected:** 9
- **Rule:** Stale open session where policy cutoff is deterministic and no overlapping valid session exists. Set logoutAt to policy cutoff.

### WS_05: Excessive Work Duration (>10h)
- **Classification:** `MANUAL_REVIEW`
- **Records Affected:** 55
- **Rule:** Flag for manager timesheet review. User might have genuinely worked overtime.

### WS_06: Extreme Work Duration (>16h)
- **Classification:** `MANUAL_REVIEW`
- **Records Affected:** 51
- **Rule:** Extreme duration alone does not prove the correct logout time. It may be valid overtime, stale open session, overlapping session, or missing end-day. Do not mutate these blindly.

### WS_07: Excessive Break Duration (>4h)
- **Classification:** `MANUAL_REVIEW`
- **Records Affected:** 7
- **Rule:** Flag for manager review. Too ambiguous to automatically dock pay or auto-logout.

### WS_08: Duplicate Active Sessions
- **Classification:** `MANUAL_REVIEW`
- **Records Affected:** 32
- **Rule:** Cannot safely merge. Export to CSV for manual timesheet correction.

### WS_09: Overlapping Session Windows
- **Classification:** `EXCLUDE_FROM_REPORTING`
- **Records Affected:** 234
- **Rule:** Mark as OVERLAPPING_CONFLICT. Exclude from productive time calculations to prevent double-counting.

### WS_10: Terminal Status Without Logout Timestamp
- **Classification:** `AUTO_REPAIR`
- **Records Affected:** 0
- **Rule:** Set logoutAt = updatedAt. Since status is already terminal, we sync the time bound.

### WS_11: AutoClosed Sessions Missing autoClosedAt
- **Classification:** `AUTO_REPAIR`
- **Records Affected:** 0
- **Rule:** Set autoClosedAt = updatedAt. Ensures SLA/Analytics filters do not crash on null timestamps.

### WS_12: Invalid Parent Continuation Session
- **Classification:** `AUTO_REPAIR`
- **Records Affected:** 0
- **Rule:** Set continuationOfSessionId = null. Treat as standalone session.

### BL_01: Break Without End Time
- **Classification:** `AUTO_REPAIR`
- **Records Affected:** 2
- **Rule:** Open break inside already closed parent session. Close break at parent logoutAt.

### BL_02: Excessive Break (>4h)
- **Classification:** `MANUAL_REVIEW`
- **Records Affected:** 9
- **Rule:** Same as WS_07. Flag for manager review.

### BL_03: Break End Before Start
- **Classification:** `EXCLUDE_FROM_REPORTING`
- **Records Affected:** 0
- **Rule:** Flag record as INVALID_TIME_BOUNDS. Do not delete, but exclude from analytics.

### BL_04: Break Outside Parent Session Window
- **Classification:** `AUTO_REPAIR`
- **Records Affected:** 39
- **Rule:** Clamp break to parent bounds only if parent session bounds are valid and non-overlapping.

### BL_05: Orphaned Break (Invalid/Missing Parent Session)
- **Classification:** `EXCLUDE_FROM_REPORTING`
- **Records Affected:** 0
- **Rule:** Flag as ORPHAN. Exclude from calculations.

## Dry-Run Repair Impact Summary

| Classification | Affected Records | Action Definition |
|---|---|---|
| `AUTO_REPAIR` | 88 rows | Will be deterministically mutated via Prisma update. |
| `MANUAL_REVIEW` | 154 rows | Will be flagged and exported to CSV for management. |
| `EXCLUDE_FROM_REPORTING` | 241 rows | Will be flagged as invalid via metadata/status without deletion. |
| `DO_NOT_TOUCH` | 43 rows | Will be ignored completely during repair script execution. |
