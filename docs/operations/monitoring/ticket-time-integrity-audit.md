# Ticket timer integrity audit

A read-only report of ticket timer records that contradict the Phase 1 timer
rules. It finds problems; it never fixes them. The Phase 2D1 cleanup
(`npm run ticket-time:cleanup`) is a separate tool with its own approval gate;
see [`../deployment/TICKET_TIMER_GUARDRAIL_RELEASE.md`](../deployment/TICKET_TIMER_GUARDRAIL_RELEASE.md).

## What it is allowed to touch

Only the dedicated local integration database:

- `DATABASE_URL` must be set explicitly. The audit never reads `backend/.env`.
- Host must be loopback (`127.0.0.1`, `localhost`, `::1`).
- Database name must be exactly `apex_os_attendance_integration`.
- Anything matching `render.com`, `amazonaws.com`, `prod`, `production`,
  `staging`, `neon.tech` or `supabase` is refused before connecting.
- After connecting, the **server** must report that same database, a loopback
  address, and a read-only transaction. Otherwise it stops.

There is **no production override**. Running it against staging or production
is a separate, future change that needs explicit owner approval.

## Why it cannot write

All queries run in one transaction declared `READ ONLY` before the first
`SELECT`, so PostgreSQL itself rejects any write. The module has no
`INSERT`/`UPDATE`/`DELETE`/DDL, and `--apply`, `--fix` and `--repair` are
rejected. The PostgreSQL test suite fingerprints every table the audit reads
before and after a run and requires them to be identical.

## Running it locally

Against the throwaway PostgreSQL 18 cluster on port 55432 (see
`backend/test/integration-pg/README.md`):

```bash
DATABASE_URL="postgresql://apex_test@127.0.0.1:55432/apex_os_attendance_integration?schema=public" npm run ticket-time:audit --workspace backend
```

Options:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--json` | off | Machine-readable report, stable ordering, for before/after comparison |
| `--stale-hours=N` | 12 | Flag active logs running longer than N hours |
| `--sample=N` | 20 (max 200) | Example rows per check; `0` prints counts only |
| `--now=ISO` | current time | Fix the audit clock (reproducible reports) |

Exit codes: `0` CLEAN, `2` VIOLATIONS_FOUND, `1` refused or failed.

## What it checks

Every check covers ASSIGNEE (employee) timer rows unless noted.

| Code | Invariant violated |
| --- | --- |
| `DUPLICATE_ACTIVE_ASSIGNEE_LOGS` | More than one active log for one user |
| `ACTIVE_LOG_TICKET_NOT_IN_PROGRESS` | Active log on any ticket that is not IN_PROGRESS |
| `ACTIVE_LOG_ON_OPEN_REVIEW_DONE_CLOSED` | Active log on OPEN, REVIEW, DONE or CLOSED |
| `ACTIVE_LOG_ON_BLOCKED_TICKET` | Active log on a blocked ticket |
| `ACTIVE_LOG_USER_NOT_WORKING` | Active log while the user is on break, idle, logged out, or has no open WORKING session |
| `ACTIVE_LOG_WITH_INVALID_WORK_SESSION` | Active log with no linked WorkSession, or linked to one that belongs to another user, is closed (`logoutAt` set, `LOGGED_OUT` or `AUTO_CLOSED`), or has been superseded by a later-dated session of the same user |
| `ACTIVE_LOG_NOT_PRIMARY_ASSIGNEE` | Active log owned by someone other than the primary assignee |
| `ACTIVE_LOG_ON_UNASSIGNED_TICKET` | Active log on a ticket with no primary assignee |
| `ACTIVE_LOG_OLDER_THAN_THRESHOLD` | Active log running longer than `--stale-hours`. A warning only: the Phase 2D1 cleanup never closes a timer for age alone |
| `CLOSED_LOG_MISSING_DURATION` | Closed log (any owner) without `durationSeconds` |
| `OPEN_LOG_WITH_DURATION` | Open log (any owner) with a `durationSeconds` |
| `NEGATIVE_DURATION_OR_INVERTED_RANGE` | Negative duration, or `endedAt` before `startedAt` (any owner) |
| `OVERLAPPING_ASSIGNEE_RANGES` | Two productive ranges of the same user overlap |
| `ACTIVE_REWORK_LOG_WITHOUT_OPEN_CYCLE` | Active REWORK log with no open rework cycle |
| `WORK_LOG_INSIDE_REWORK_CYCLE` | Productive (`countsAsWork`) WORK-stage log that starts inside a rework cycle; zero-length, non-productive markers are ignored |
| `REWORK_CYCLE_MULTIPLE_ACTIVE_SEGMENTS` | Open rework cycle with more than one active segment |
| `DUPLICATE_ACTIVE_TIMED_LOGS` | (Phase 4) More than one active timed log for one user across employee (ASSIGNEE) and reviewer (REVIEWER) clocks |
| `ACTIVE_REVIEWER_LOG_TICKET_NOT_IN_REVIEW` | (Phase 4) Active reviewer clock on a ticket that is not in REVIEW |
| `ACTIVE_REVIEWER_LOG_WITHOUT_OPEN_REVIEW_CYCLE` | (Phase 4) Active reviewer clock on a ticket with no open (undecided) review cycle |
| `ACTIVE_REVIEWER_LOG_USER_NOT_WORKING` | (Phase 4) Active reviewer clock while the reviewer is on break, idle, logged out, or has no open WORKING session |
| `ACTIVE_REVIEWER_LOG_WITH_INVALID_WORK_SESSION` | (Phase 4) Active reviewer clock with a missing, foreign, closed or superseded work session |
| `REVIEWER_LOG_WRONG_STAGE` | (Phase 4) A REVIEWER log whose stage is not REVIEW (reviewer time must never look like employee work) |
| `OVERLAPPING_TIMED_RANGES` | (Phase 4) A productive reviewer range overlaps another productive timed range of the same user |
| `EMPLOYEE_WORK_CONTRADICTS_STATE` | Ticket would show `activeClock = EMPLOYEE_WORK` although its status, block, assignee or worker state forbids it (one row per ticket) |

One corruption often breaks several rules. For example, an active log on an
OPEN ticket appears under `ACTIVE_LOG_TICKET_NOT_IN_PROGRESS`,
`ACTIVE_LOG_ON_OPEN_REVIEW_DONE_CLOSED` and `EMPLOYEE_WORK_CONTRADICTS_STATE`.

## What the report contains

- The database name, server address, port and PostgreSQL version. It never
  contains credentials.
- The audit timestamp and the options used.
- Rows checked: time logs, active ASSIGNEE logs, and the tickets and users that
  have one.
- A count for each check, with bounded samples. Samples show log, user, cycle or
  ticket ids and ticket keys only. They never contain names, emails, photos or
  other personal data.
- `result`: `CLEAN` or `VIOLATIONS_FOUND`.

## Future production use (not enabled)

Running this against production needs, in order:

1. Explicit owner approval.
2. A code change, reviewed separately, that adds a production read-only mode.
3. Confirmation of the production database identity.
4. A fresh, verified backup.

Only then can the report be run and reviewed. Any repair is the Phase 2D1
cleanup tool, under its own approval.
