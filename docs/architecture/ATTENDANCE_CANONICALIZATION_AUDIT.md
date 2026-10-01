# Attendance Canonicalization Audit

**Branch** `refactor/attendance-canonical-archive-delete` · **Base** `3f0aee2` (origin/main, PR #63)
**Date** 2026-10-01 · **Method** read the repository; every claim below is grepped, not assumed.

This is the gating document for §18 (schema removal) and §15 (one reporting service). Nothing
is removed before it appears here with evidence.

---

## 0. Repository state

| | |
|---|---|
| Worktree | `C:/tmp/apex-canon`, created clean for this work |
| Base | `3f0aee2` — current `origin/main` |
| Migrations at base | 50, newest `20261001000000_one_active_assignee_timer` |
| Working tree | clean at start |

**Two pre-existing conditions were deliberately kept out of this branch:**

1. `C:/Projects/nexus-app` has **14 files staged in its index** from PR #57
   (`core/auth/*`, `core/users/*`, four specs, a runbook, `UsersScreen.tsx`) placed there by
   another session. Branching from that checkout would have carried them. This worktree was
   created from `origin/main` instead, so none of it is mixed in.
2. `C:/tmp/apex-rc` (`release/attendance-vnext-rc3`, `2bafaac`) holds uncommitted September
   payroll-export work. It is **not** merged here — see §6.

---

## 1. Attendance models

23 models carry attendance-related state. Field counts from `schema.prisma`:

| Model | Fields | Layer |
|---|---|---|
| `DailyAttendance` | 39 | **canonical outcome** |
| `AttendancePunchEvidence` | 35 | raw evidence (immutable) |
| `AttendanceImportBatch` / `Row` | 36 / 35 | import staging |
| `LeavePolicy` | 31 | versioned config |
| `AttendancePolicy` | 28 | versioned config |
| `LeaveRequest` | 27 | raw fact |
| `AttendanceRegularization` | 26 | raw correction request |
| `WorkSession` | 25 | raw evidence |
| `ShiftPolicy` | 22 | versioned config |
| `EmployeeAttendanceProfile` | 22 | assignment |
| `AttendanceEvent` | 19 | raw event stream |
| `HolidayCalendar` / `Holiday` / `WeeklyOffPolicy` | 17 / 8 / 11 | calendar facts |
| `AttendanceMonthClose` | 17 | lifecycle |
| `BreakLog` | 16 | raw evidence |
| `CompOffCredit` | 14 | derived entitlement |
| `AttendancePunchHandoff` / `PunchPhoto` / `AttendanceLocation` | 13 / 12 / 11 | supporting |
| `UserWorkdayPolicyOverride` | 17 | config override |
| `EmployeeDocument` / `EmployeeProfileChangeRequest` | 14 / 23 | HR records |

---

## 2. Field inventory — `DailyAttendance`

The canonical model, and the only place §18 found anything removable.

| Field | Meaning | Written by | Read by | Kind | In final console? | Decision |
|---|---|---|---|---|---|---|
| `id`, `userId`, `date` | identity | evaluator | everything | raw | yes (userId internal) | KEEP_CANONICAL |
| `status` | the official verdict | evaluator | console, reports, analytics, summary | derived→stored | yes | KEEP_CANONICAL |
| `punchInAt` / `punchOutAt` | effective punches | evaluator | console, reports, summary | derived→stored | yes | KEEP_CANONICAL |
| `workedMinutes` | workday engine total | evaluator | reports, console | **snapshot** | yes | KEEP_CANONICAL |
| `breakMinutes` | workday engine total | evaluator | reports, console | **snapshot** | yes | KEEP_CANONICAL |
| `lateMinutes` | arrival lateness | evaluator | analytics, reports | derived→stored | yes | KEEP_CANONICAL |
| `leaveDeducted` | deducted days (Float) | evaluator | payroll, Gate-4 audit | derived→stored | yes | KEEP_CANONICAL ⚠ |
| `lwpDeducted` | unpaid days (Float) | evaluator | payroll, Gate-4 audit | derived→stored | yes | KEEP_CANONICAL ⚠ |
| `calculationReason` | why this verdict | evaluator | 14 app refs incl. a `=== 'CONTEXT_BLOCKED'` branch | derived→stored | yes (as Remarks) | KEEP_CANONICAL |
| `locked` / `lockedAt` | month-close seal | payroll finalize | console, payroll | raw | no | KEEP_CANONICAL |
| **`policyVersion`** | **stringified copy of `attendancePolicyVersion`** | **evaluator only, 1 site** | **nothing** | **DUPLICATE** | **no** | **REMOVE** |
| `evaluationState` | CALCULATED / NEEDS_REVIEW / FINALIZED | evaluator | console, analytics, summary | derived→stored | yes | KEEP_CANONICAL |
| `evaluatorVersion` | `EVALUATOR_VERSION` | evaluator | console `:471` | provenance | no | KEEP_PROVENANCE |
| `resolverVersion` | `DAILY_CONTEXT_RESOLVER_VERSION` | context service | console `:470` | provenance | no | KEEP_PROVENANCE |
| `evaluatedAt` | when decided | evaluator | console | provenance | no | KEEP_PROVENANCE |
| `exceptionFlags` | named exceptions | evaluator | console, exceptions, reports | derived→stored | yes (Remarks) | KEEP_CANONICAL |
| `sourceFingerprint` | digest of source facts | evaluator | 21 app refs — re-eval short circuit | provenance | no | KEEP_PROVENANCE |
| `employeeProfileId` | profile in force | evaluator | 7 app refs | provenance | no | KEEP_PROVENANCE |
| `attendancePolicyId` / `Version` | policy in force | evaluator | **required-minutes resolution** | provenance | no | KEEP_PROVENANCE |
| `shiftPolicyId` / `Version` | shift in force | evaluator | **required-minutes resolution** | provenance | no | KEEP_PROVENANCE |
| `holidayCalendarId`, `weeklyOffPolicyId`, `holidayId`, `businessDayOverrideId` | calendar in force | evaluator | 6–15 app refs each | provenance | no | KEEP_PROVENANCE |
| `leaveRequestId` | leave that covered the day | evaluator | reports (leave type) | provenance | yes (Leave Type) | KEEP_PROVENANCE |
| `punchInEvidenceId` / `punchOutEvidenceId` | evidence behind the punches | evaluator | reports (punch source) | provenance | yes (Data Source) | KEEP_PROVENANCE |
| `workSessionIds` | sessions behind the totals | evaluator | reports, detail view | provenance | no | KEEP_PROVENANCE |
| `revision` | times corrected | regularization | console | provenance | no | KEEP_PROVENANCE |
| `lastRegularizationId` | governing correction | regularization | reports, console | provenance | yes (Manual Correction) | KEEP_PROVENANCE |
| `createdAt` / `updatedAt` | row audit | Prisma | — | raw | no | KEEP_CANONICAL |

⚠ `leaveDeducted` / `lwpDeducted` are `Float`. The VNext arithmetic is integer sixths. Converting
them is a **separate, migration-bearing decision** gated on the Gate-4 Float distribution verdict,
and is explicitly out of scope here.

### Why the snapshot fields stay

`workedMinutes`, `breakMinutes`, `lateMinutes`, `status`, `punchInAt/OutAt` are all derivable from
raw evidence — and deriving them at read time would be a **regression**, not a simplification.

A finalized month must display what was finalized. `GET /attendance/daily` already re-evaluates
history live, which is why a closed month can display differently from what Finance received. That
is a known open defect. Deriving the stored outcome everywhere would generalise that bug to every
surface.

**So §18's premise does not hold for the schema.** Exactly **one** column is removable
(`policyVersion`). The duplication the brief is after is real, but it lives in application logic.

---

## 3. Raw-evidence models — classified at model level

| Model | Kind | Decision | Note |
|---|---|---|---|
| `AttendancePunchEvidence` | immutable raw fact | KEEP_RAW | never rewritten; corrections are separate rows |
| `AttendancePunchPhoto` | immutable raw fact | KEEP_RAW | |
| `WorkSession` | raw fact | KEEP_RAW | only writer is `AttendanceAuthorityService` |
| `BreakLog` | raw fact | KEEP_RAW | no business date of its own; belongs to its session |
| `AttendanceEvent` | raw event stream | KEEP_RAW | timestamp only — needs TZ conversion to a company day |
| `AttendanceRegularization` | raw request + decision | KEEP_RAW | a request is **not** an approved correction (§13) |
| `LeaveRequest` | raw fact | KEEP_RAW | attendance honours it only at `APPROVED` **and** stage `COMPLETE` |
| `HolidayCalendar`, `Holiday`, `WeeklyOffPolicy` | calendar facts | KEEP_RAW | |
| `AttendancePolicy`, `ShiftPolicy`, `LeavePolicy` | versioned config | KEEP_CANONICAL | resolved by business date |
| `AttendanceMonthClose` | lifecycle | KEEP_CANONICAL | |
| `AttendanceImportBatch` / `Row` | staging | KEEP_RAW | classify→apply; superseded rows retained |
| `CompOffCredit` | derived entitlement | KEEP_CANONICAL | nothing sweeps expiry on a schedule |

No raw-evidence model is removable. Every one of them is needed to reconstruct or prove attendance.

---

## 4. The duplication that is actually there — application logic

This is the finding. Each item is a grep result, not a suspicion.

### 4.1 Two complete report + workbook stacks

| | Console stack | Payroll stack |
|---|---|---|
| Aggregation | `console/register-report.ts` | `reports/payroll-aggregation.ts` |
| Workbook | `console/register-workbook.ts` | `reports/payroll-workbook.ts` |
| ExcelJS import | yes | yes |
| Sheets | `Monthly Register` | `Report`, `Payroll Summary`, `Daily Register` |
| Entry point | `attendance-console.service.ts:861` | `payroll-report.service.ts:237` |

**Four sheets across two independent builders and two download endpoints.** The contract (§17)
is two sheets from one builder. This is the single largest piece of work in the brief.

### 4.2 Presence computed in four places

`presence = punch out − punch in` is implemented independently at:

| Site | Form |
|---|---|
| `reports/payroll-aggregation.ts:100` | `presenceMinutes()` — the only *named* function |
| `console/attendance-console.service.ts:445` | inline |
| `evaluation/daily-attendance-evaluator.service.ts:621` | inline |
| `evaluation/daily-attendance-evaluator.service.ts:996` | inline (half-day path) |
| `core/users/users.service.ts:1884` | inline, in the **users** module |

Five sites, one shared function, no shared import.

### 4.3 The "present" status set, twice

Byte-identical, two files, no shared import:

- `import/import-classify.ts:132` — `PRESENT_EQUIVALENT = new Set(['PRESENT','LATE','LATE_EXEMPTED'])`
- `reports/payroll-aggregation.ts:90` — `PRESENT_STATUSES = new Set(['PRESENT','LATE','LATE_EXEMPTED'])`

### 4.4 The late threshold, four sources

| Site | Value | Problem |
|---|---|---|
| `console/attendance-console.service.ts:50` | `LATE_AFTER = '10:30:00'` | **hardcoded; the Team-Lead window applied to everyone** |
| `settings.service.ts:42–43` | `employeeTiming.start '09:30'`, `tlTiming.entryEnd '10:30'` | second source of truth |
| `workday.service.ts:964–965, 1011, 1020` | own defaults + `expectedStart` | third |
| evaluator | policy/shift resolved by date | **the correct one** |

For an employee on a 09:30 shift, a 10:00 arrival is late to the evaluator and on time in the
console's Monthly Register column. §12 requires one resolver.

### 4.5 Required minutes, four sources

| Site | Form |
|---|---|
| `settings/attendance-policy-settings.ts:204` | `resolveRequiredPresence()` — **the shared resolver** |
| `evaluation/daily-attendance-evaluator.service.ts:602` | `context.shift?.min ?? policy?.min ?? 540` — **re-implements the same precedence inline** |
| `reports/payroll-report.service.ts:234` | `toRegisterRow(e, d, 540)` — hardcoded |
| `settings.service.ts:41` | `minimumWorkdayMinutes: 540` |

The evaluator duplicating `resolveRequiredPresence` is the worst of these: the two could diverge
and the evaluator is authoritative.

### 4.6 Backfill eligibility uses today's account state

`console/attendance-console.service.ts:910`:

```ts
const userWhere: any = { isActive: true };
```

Historical evaluation filters on **today's** active flag. Backfilling September now would create
official rows for current employees only and silently skip anyone who has left — permanently baking
the gap into the official record. §19 requires one date-based eligibility resolver shared by export,
scheduler and backfill.

---

## 5. Why the console shows a partial month

`processing/attendance-scheduler.service.ts:68` evaluates **one day — yesterday — and never
backfills**:

```ts
const businessDate = this.previousBusinessDate();
```

`DailyAttendance` coverage therefore equals the set of days the scheduler happened to run in
OFFICIAL mode. `mode()` returns `DISABLED` unless `automaticEvaluationEnabled` is true, and all
three `attendance_v2` flags default to **false**; in `SHADOW` it calls `evaluate()` rather than
`evaluateAndPersist`, deliberately writing nothing.

A bounded backfill path exists — `POST /attendance/console/evaluate` → `runEvaluation()`,
`MAX_RANGE_DAYS = 62`, `MAX_EVALUATION_UNITS = 2000` — and it calls `evaluateAndPersist` **directly,
bypassing `mode()`**, so the flags gate the scheduler, not the command. **It must not be run until
§4.6 is fixed.**

---

## 6. Relationship to the uncommitted payroll work

`C:/tmp/apex-rc` holds a September payroll-export patch (not committed, not merged here). Parts of
it are superseded and parts should be carried forward:

| Item | Status under this brief |
|---|---|
| 27-column Payroll Summary / 24-column Daily Register | **superseded** by the 19/26 contract (§5, §6) |
| 4-sheet workbook (`Report`/`Summary`/`Register`/`Exceptions`) | **superseded** by the 2-sheet contract (§17) |
| Employee inclusion by employment window + activity | **carry forward** — it is §19's answer for the export half |
| `requiredMinutes` resolved from stored policy provenance | **carry forward** — it is §11 |
| `reportFingerprint` frozen to a V1 key list | **carry forward** — without it any column change makes a finalized month refuse to send |
| Former-employee inclusion tests, 15 mutants | **carry forward** |

Carrying the three forward rather than re-deriving them avoids re-making decisions that are already
proven by mutation tests.

---

## 7. Decision summary

| Decision | Count | Items |
|---|---|---|
| REMOVE | **1** | `DailyAttendance.policyVersion` |
| KEEP_RAW | 12 models | all raw-evidence and calendar models |
| KEEP_CANONICAL | 13 fields + 4 models | the stored official outcome and versioned config |
| KEEP_PROVENANCE | 17 fields | the ids that prove which policy decided a day |
| DERIVE | 0 | nothing currently stored is safe to derive at read time — see §2 |
| DEPRECATE | 0 | — |

**The system gets smaller in code, not in schema.** Removing the five duplicate presence
implementations, two status sets, four late thresholds, four required-minutes sources and one of the
two workbook stacks is where the simplification is.

---

## 8. Sequenced plan

Ordered so each step is independently verifiable and nothing destructive runs early.

| # | Step | Gate |
|---|---|---|
| 1 | **Shared primitives** (§40): one `presenceMinutes`, one present-status set, one late resolver, one required-minutes resolver, one date-based eligibility resolver. Pure functions, mutation-tested. | tests |
| 2 | **Migrate every reader** to the primitives; delete the five inline presence copies, the duplicate status set, `LATE_AFTER`, the evaluator's inline required-minutes. | parity |
| 3 | **One reporting service** (§15) producing `DailyAttendanceReportRow` (26 cols) + `MonthlyAttendanceSummaryRow` (19 cols); monthly is an aggregation of daily, keyed on `userId`. | tests |
| 4 | **One workbook builder** (§17), two sheets; retire `register-workbook.ts`; console and export both consume step 3. | workbook tests |
| 5 | **Status semantics** (§7–§10): Absent only under all six conditions; auto-close never shown as punch-out; presence vs worked kept separate. | 24 tests from §33 |
| 6 | **Eligibility fix** (§19) in `runEvaluation`, sharing step 1's resolver. | tests |
| 7 | **Parity report** over a representative range → `ATTENDANCE_PARITY_REPORT.md`. | zero unexplained |
| 8 | **Migration A** — stop writing `policyVersion`. | staging |
| 9 | **Migration B** — drop the column. Generated, **not applied to production**. | staging + §38 |
| 10 | **Archive & Delete** (§20–§32) — separate subsystem; relation classification first. | §35 tests |

Steps 1–2 are prerequisites for everything else: building step 3 on top of five presence
implementations would make a sixth.
