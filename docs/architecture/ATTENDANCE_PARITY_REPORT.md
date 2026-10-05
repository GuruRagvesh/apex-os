# Attendance Parity Report

**Branch** `refactor/attendance-canonical-archive-delete` · **Base** `origin/main` `1453d6a`
**Date** 2026-10-01

Every behavioural difference between the old attendance surfaces and the canonical
reporting service, classified. The requirement is **zero unexplained regressions**.

---

## 0. What this report can and cannot establish

**Established here:** every difference derivable from the code, each traced to the
commit and the line that causes it, with the test that pins the new behaviour.

**Not established here:** a row-by-row comparison of old versus new output over a real
date range. That needs a database, and this session has no credential for one — local
PostgreSQL requires a password, there is no `.pgpass`, and `DATABASE_URL` is unset. The
operator query set for that comparison is in §6.

No difference below is speculative; each is read off the diff.

---

## 1. Summary

| Classification | Count |
|---|---|
| EXPECTED_CORRECTION | 9 |
| OLD_BUG | 5 |
| REGRESSION | **0** |
| UNRESOLVED | 2 |

The two UNRESOLVED items are both "needs a database to confirm", not "we do not know
what the code does".

---

## 2. EXPECTED_CORRECTION

Deliberate changes where the new answer is the intended one.

### C1 — Presence rounding unified on `Math.round`
`d85bc62`

The console computed the presence span with `Math.floor`; the payroll path used
`Math.round`. For any span carrying seconds the two differed by up to a minute, so HR and
Finance could see different numbers for the same day.

Standardised on `round`, because that is the figure of record — any finalized month was
computed with it. **The console moves by at most 1 minute per day; payroll is unchanged.**

### C2 — Required minutes resolved per employee-day
`a9fad37`

Was a hardcoded `540` in the payroll register and an inline
`shift ?? policy ?? 540` in the evaluator. Now resolved from each stored row's own
`attendancePolicyId` / `shiftPolicyId`, through one resolver.

**Any employee not on a 540-minute requirement now sees their own figure.** Rows whose
policy cannot be resolved report `UNRESOLVED` instead of 540.

### C3 — An unprovable requirement is no longer a pass
`699873c`, `f54ce3e`

A day whose requirement cannot be established reports `Cannot determine` rather than
being measured against an assumed 540. Previously such a day was silently compared to the
default and could read as complete.

### C4 — Lateness requires a proven threshold
`699873c`, `a9fad37`

Was `LATE_AFTER = '10:30:00'` hardcoded in the console — the Team-Lead entry window
applied to every employee. Now the applicable `ShiftPolicy.startTime` with its
`graceMinutes`, and **no claim at all** when no shift resolves.

**Effect:** an employee on a 09:30 shift arriving at 10:00 was "on time" in the Monthly
Register and late to the evaluator. They now read late in both. Employees with no
resolvable shift change from "on time" to `—`.

### C5 — Former employees appear in historical months
`b86374f`

`runEvaluation` filtered on `{ isActive: true }`. Eligibility is now decided per
employee-date from the employment window.

**Effect:** backfilling a past month now includes anybody employed on those dates.
Previously they were silently absent from it.

### C6 — Missing employment metadata is reported, not skipped
`b86374f`, `f54ce3e`

A user with no joining date was silently dropped. It now reports
`employmentUnresolved` on a run and `Employment not verified` on a row.

### C7 — Four statuses replace a single implied absence
`f54ce3e`

`Calendar not confirmed`, `Not yet joined`, `Employment not verified` and
`Not in extract` are new. Days that would previously have fallen through to an absence
— or to a blank — now say which kind of uncertainty they are.

### C8 — One download, two sheets
`a9fad37`

Four sheets across two builders (`Report`, `Payroll Summary`, `Daily Register`,
`Monthly Register`) become two: `<Month> Daily Attendance` and
`Employee Monthly Summary`.

### C9 — Monthly summary derives from the daily rows
`f54ce3e`

The two stacks computed monthly figures separately from the daily ones. The summary is
now an aggregation of the exact rows the daily sheet shows, keyed on `userId`.

---

## 3. OLD_BUG

Defects in the previous behaviour, fixed here.

### B1 — A policy auto-close was shown as the employee's punch out
`f54ce3e` · test: *"A POLICY AUTO-CLOSE NEVER BECOMES THE EMPLOYEE PUNCH OUT"*

A session the scheduler closed at 20:00 could be displayed as a departure the employee
never recorded, and a presence span measured from it. The auto-close now supports
`Present` and `Hours Worked`, leaves presence unresolved, and says so in Remarks.

### B2 — The same employee name merged two people
`f54ce3e` · test: *"TWO EMPLOYEES WITH THE SAME NAME DO NOT MERGE"*

The console's register aggregated per employee row without a `userId` guarantee. The
summary now keys on `userId`.

### B3 — Lateness could be derived from status
`f54ce3e`

Late was treated as a status in places rather than an independent quantity. An employee
is now `Present` **and** `Late by 00:07`.

### B4 — `sessions[0].startWorkAt` hid a real arrival
`2bafaac` on the RC branch; the same defect exists here and is **not yet fixed on this
branch** — see U2.

### B5 — A pending correction could read as applied
`f54ce3e` · test: *"A PENDING REGULARIZATION DOES NOT ALTER THE FACTS"*

`Manual Correction / Regularization` now distinguishes `Pending — not applied`,
`Invalid — not applied`, `Manual recovery` and `Applied`, and a pending request changes
no figure on the row.

---

## 4. REGRESSION

**None.**

Every surface that changed is covered by a behavioural test, and the full suite is green
at 124 suites / 2825 tests with TypeScript clean. Mutation testing was run against each
new pure module and every mutant was killed:

| Module | Mutants |
|---|---|
| `shared/attendance-primitives.ts` | 22/22 |
| `canonical/attendance-report.ts` | 20/20 |
| `runEvaluation` eligibility | 7/7 |

Three of those mutants survived their first run and each exposed a real weakness in my
own tests rather than in the code — a fixture with 1 late day and 1 absent day (so
swapping them gave the same answer), a self-contradictory contract assertion, and a
prisma double that ignored the `where` clause it was supposed to be testing. All three
are fixed and recorded in the commit messages.

---

## 5. UNRESOLVED

### U1 — No row-by-row comparison against real data
Needs a database. §6 has the queries. **Blocks the "zero unexplained regressions"
conclusion from being data-backed rather than code-backed.**

### U2 — The evaluator still reads `sessions[0]?.startWorkAt`
`daily-attendance-evaluator.service.ts` resolves the punch-in fallback positionally. If
the earliest-created session of a day has a null `startWorkAt` — which an `ON_LEAVE`
session created at 00:01 ordinarily does — the chain falls through to null and the day
records worked minutes with no arrival.

Fixed on the RC branch (`2bafaac`) and **not carried here**, because that fix belongs with
the evaluator migration (audit §8 step 2) rather than bolted onto the reporting work. The
canonical report reads stored rows, so it inherits whatever the evaluator wrote; it does
not introduce the defect and cannot mask it.

---

## 6. The operator comparison, for when a database is available

Read-only. Run against a restored copy, never production.

```sql
-- Rows where the canonical late threshold would differ from the old hardcoded
-- 10:30. These are the employees C4 changes.
SELECT s."startTime", count(*) AS employee_days
FROM   daily_attendance d
JOIN   shift_policies s ON s.id = d."shiftPolicyId"
WHERE  d.date BETWEEN '2026-09-01' AND '2026-09-30'
  AND  s."startTime" <> '10:30'
GROUP  BY s."startTime"
ORDER  BY employee_days DESC;

-- Rows where the requirement was never 540. These are the employees C2 changes.
SELECT coalesce(s."minimumWorkingMinutes", p."minimumWorkingMinutes") AS required,
       count(*) AS employee_days
FROM   daily_attendance d
LEFT   JOIN shift_policies s      ON s.id = d."shiftPolicyId"
LEFT   JOIN attendance_policies p ON p.id = d."attendancePolicyId"
WHERE  d.date BETWEEN '2026-09-01' AND '2026-09-30'
GROUP  BY 1 ORDER BY employee_days DESC;

-- Days whose presence span carries seconds: the only rows C1 can move.
SELECT count(*) AS rows_affected_by_rounding
FROM   daily_attendance
WHERE  date BETWEEN '2026-09-01' AND '2026-09-30'
  AND  "punchInAt" IS NOT NULL AND "punchOutAt" IS NOT NULL
  AND  extract(epoch FROM ("punchOutAt" - "punchInAt"))::bigint % 60 <> 0;

-- Employees C5 adds to a September backfill: employed in September, inactive now.
SELECT u.id, u."employeeId", u.name, u."lastWorkingDate"::date
FROM   users u
WHERE  u."isActive" = false
  AND  u."joiningDate" <= '2026-09-30'
  AND  (u."lastWorkingDate" IS NULL OR u."lastWorkingDate" >= '2026-09-01');

-- Rows C6 will now report instead of silently skipping.
SELECT count(*) AS employees_without_joining_date
FROM   users WHERE "joiningDate" IS NULL;
```

Record each result against C1–C9 above. A count of zero means that correction changes
nothing in this month; a non-zero count is the expected, explained delta.
