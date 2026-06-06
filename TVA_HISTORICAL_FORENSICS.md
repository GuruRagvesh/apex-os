# TVA_HISTORICAL_FORENSICS.md

Date: 2026-06-06
Mode: Read-only forensic audit
Data Source: configured production database via Prisma read-only queries. Credentials are not included.

## Summary

Production workday history is not clean. The database contains impossible or suspicious workday records. This is a trust risk independent of whether the current code is improved.

Total work sessions checked: 192.

Total break logs checked: 162.

## Anomaly Report

### ANOMALY-001

Type: Negative durations

Description: Work sessions with negative `totalWorkMinutes` or `totalBreakMinutes`.

Count: 0

Severity: Low

Auto Repairable: Not needed

Recommended Action: None.

### ANOMALY-002

Type: Logout before start

Description: Work sessions where `logoutAt < startWorkAt`.

Count: 7

Severity: Critical

Auto Repairable: No, requires review of intended end time.

Recommended Action: Manually inspect affected rows and repair using attendance event context.

### ANOMALY-003

Type: Missing start with logout

Description: Work sessions with `startWorkAt IS NULL` and `logoutAt IS NOT NULL`.

Count: 43

Severity: High

Auto Repairable: Maybe. These may represent login-only sessions or corrupted work sessions; do not auto-repair without deciding whether `LOGGED_IN` sessions are attendance.

Recommended Action: Classify as login-only vs workday sessions before repair.

### ANOMALY-004

Type: Missing end times

Description: Work sessions where `logoutAt IS NULL`.

Count: 33

Severity: High

Auto Repairable: Partial.

Recommended Action: Close only stale/invalid sessions after validating active users and current workday.

### ANOMALY-005

Type: Stale open sessions

Description: Open sessions where `startWorkAt` is older than 12 hours.

Count: 9

Severity: Critical

Auto Repairable: Partial.

Recommended Action: Review and close with company policy cutoff if clearly stale.

### ANOMALY-006

Type: Excessive durations over 16 hours

Description: Work sessions with `totalWorkMinutes > 960`.

Count: 51

Severity: Critical

Auto Repairable: No, not safely without policy/user context.

Recommended Action: Manual repair script with dry-run and row-by-row classification.

### ANOMALY-007

Type: Excessive durations over 10 hours

Description: Work sessions with `totalWorkMinutes > 600`.

Count: 55

Severity: High

Auto Repairable: No.

Recommended Action: Review alongside >16h anomalies; do not cap blindly.

### ANOMALY-008

Type: Excessive total break duration

Description: Work sessions with `totalBreakMinutes > 240`.

Count: 7

Severity: High

Auto Repairable: Maybe.

Recommended Action: Compare against break logs and close open breaks if needed.

### ANOMALY-009

Type: Open break logs

Description: Break logs with `endAt IS NULL`.

Count: 7

Severity: High

Auto Repairable: Partial.

Recommended Action: Close if parent session is closed or stale; otherwise leave active current break alone.

### ANOMALY-010

Type: Excessive break logs

Description: Break logs with `durationMinutes > 240`.

Count: 9

Severity: High

Auto Repairable: Maybe.

Recommended Action: Validate against parent session and attendance events.

### ANOMALY-011

Type: Duplicate active sessions

Description: User/day groups with more than one open session.

Count: 0

Severity: Low

Auto Repairable: Not needed.

Recommended Action: None.

### ANOMALY-012

Type: Overlapping sessions

Description: Pairs of sessions for the same user whose start/end windows overlap.

Count: 186

Severity: Critical

Auto Repairable: No.

Recommended Action: Review whether login-only sessions and continuation sessions are being treated as overlapping work sessions. This may indicate model semantics are mixed, not just bad data.

### ANOMALY-013

Type: Break outside or invalid parent session

Description: Break logs outside parent session window or with invalid start/end order.

Count: 39

Severity: Critical

Auto Repairable: No.

Recommended Action: Repair only after deciding parent session authority and cutoff policy.

### ANOMALY-014

Type: Terminal status missing logout

Description: Sessions with `logoutAt IS NULL` and status `LOGGED_OUT` or `AUTO_CLOSED`.

Count: 0

Severity: Low

Auto Repairable: Not needed.

Recommended Action: None.

## Interpretation

The biggest data risk is not negative values. It is inconsistent timelines:

- logout before start;
- open stale sessions;
- excessive stored durations;
- overlapping session windows;
- breaks outside session boundaries.

This confirms Apex OS cannot treat historical workday totals as fully trustworthy until a dedicated repair pass is performed.

