# Finalized-month immutability, and the company late cutoff

Two product decisions, recorded because both replaced an earlier mechanism and
the reasoning is spread across several files. Anyone who finds a comment that
contradicts this document should trust the code and fix the comment.

---

## 1. The late cutoff is one company value

**Decision.** 10:30 is the company-wide attendance late cutoff. It is resolved
centrally from configuration. Lateness is **not** derived from each employee's
shift start time, and 10:30 is not hardcoded in any frontend component.

### What it replaced

`arrivalThreshold` came from `shift?.startTime`, with `shift.graceMinutes` added
on top. Two people arriving at the same moment could get different verdicts:

| Employee | Shift start | Arrives | Old rule | New rule |
|---|---|---|---|---|
| A | 09:00 | 10:45 | Late by 01:45 | Late by 00:15 |
| B | 11:00 | 10:45 | **On time** | Late by 00:15 |

### Why the previous comment argued the other way

The code carried a comment refusing to fall back to a company default, because
that was "how the console's hardcoded 10:30 came to be applied to everybody."
That conflated two different faults. The console's defect was that 10:30 was
**hardcoded in a service**; it was not that the value was company-wide.
Company-wide is what the company means by late. The fix for hardcoding is one
resolved, configurable value — not per-employee thresholds, which were a
different rule nobody asked for.

### Where it lives

| Thing | Location |
|---|---|
| Fallback constant | `COMPANY_LATE_CUTOFF_FALLBACK` in `attendance-primitives.ts` |
| Setting key | `attendance.lateCutoff`, one `AppSetting` row |
| Resolver | `resolveLateCutoff()`, same file |
| Applied | `attendance-report.service.ts`, once per report, above the employee loop |
| Reported | `MonthReport.metadata.lateCutoff` — `{ clock, source }` |

**Not a column on `AttendancePolicy`.** Policies are versioned and several are
active at once (one series per shift pattern, each with V1/V2/V3), so a cutoff
stored there can disagree with itself and "which active policy's 10:30 is the
company's 10:30" has no answer. A single keyed setting cannot hold two values,
which is the property a company-wide figure needs. It also avoids a migration,
so the cutoff is changeable without a deploy.

**Grace is zero against this cutoff.** 10:30 already *is* the grace — the half
hour past a 10:00 shift, spent. Adding `shift.graceMinutes` on top would move
some employees to 11:00 and reintroduce the per-person variation this removes.

### Three states, kept apart

| Setting | `source` | Meaning |
|---|---|---|
| absent | `SYSTEM_FALLBACK` | Ordinary. Nothing configured, use 10:30. |
| `"09:45"` | `CONFIGURED` | Use it. |
| `42`, `""`, `"25:00"` | `INVALID_CONFIGURED_VALUE` | Mistake. Use 10:30 **and say so.** |

A mistyped setting does not throw: that would fail the whole month's report for
56 people over one configuration row, and lateness is a display state, not a
reason to refuse to show attendance. Nor does it pass silently, which would hide
the typo until somebody noticed everyone's lateness had moved.

---

## 2. Finalization is the seal

**Decision.** Once a month is `FINALIZED`, normal evaluators, regularization
approval and other mutation paths must not silently alter it. A privileged
HR/Admin must explicitly `REOPEN` the month, with a stated reason, before
historical attendance can change. It must then be finalized again before Finance
handoff. No hashes, no fingerprints.

### Why this was needed: a guard whose foundation was deleted

The settlement rule previously let a reviewed correction (`INDIVIDUAL_REVIEW`)
rewrite a `FINALIZED` month. **That was not careless.** It rested on a specific
compensating control, named in the comment at the time: `send()` re-rendered the
month and refused to deliver a report whose data no longer matched a fingerprint
captured at finalization. A corrected-but-unsent month therefore could not reach
Finance stale, so permitting the correction was the better trade — it let HR
repair a month without a separate reopen workflow.

That fingerprint was removed by explicit product decision (`aa11700`). Nothing
downstream noticed a post-finalization change any more. Leaving the settlement
rule untouched would have left corrections permitted in a finalized month with
nothing to catch them — **the one combination the old design never had.**

The guard did not break. The thing it depended on was deleted from underneath
it. That is the failure mode worth remembering: removing a control can
invalidate the justification for a permission somewhere else entirely.

### The rule now

`settlementBlocking()` is written as an **allow-list** of what a reviewed
correction may pass:

```ts
const PASSABLE_BY_REVIEW: SettlementReason[] = ['LOCKED_DAY', 'FINALIZED_DAY'];
return reasons.filter((reason) => !PASSABLE_BY_REVIEW.includes(reason));
```

Deliberately not a deny-list. A settlement reason added later now **refuses by
default** instead of being waved through by a filter that had never heard of it
— which is precisely how the old rule came to permit a correction the removed
fingerprint was supposed to catch.

| State | `BULK_IMPORT` | `INDIVIDUAL_REVIEW` |
|---|---|---|
| `LOCKED_DAY` | refused | **allowed** |
| `FINALIZED_DAY` | refused | **allowed** |
| `FINALIZED_MONTH` | refused | **refused** (changed) |
| `SENT_MONTH` | refused | refused |

Day-level states stay permissive for a reviewed correction: a finalized or
locked day inside a month that is still open is an operational state HR is
expected to revisit. Only the **month** seals history.

### The month states

`OPEN` → `REVIEWING` → `FINALIZED` → `SENT`, plus `REOPENED`.

`REOPENED` is **not** a step back to `OPEN`. `OPEN` is a month nobody has closed
yet; `REOPENED` is a month that *was* closed and was deliberately unsealed by a
named person for a stated reason. Collapsing them would erase the fact that a
finalized month had been reopened — the exact fact an audit of a corrected month
needs.

### `reopen(actor, month, reason)`

| Property | Behaviour |
|---|---|
| Authorization | HR / Admin / Super Admin |
| Reason | Required. Trimmed, floor of 10 characters |
| From | `FINALIZED` or `SENT` only |
| Refuses | `OPEN`, `REVIEWING`, `REOPENED` — already correctable; a no-op that wrote an audit record would make the trail claim something that did not happen |
| Writes | `status`, `reopenedById`, `reopenedAt`, `reopenReason`, `reopenCount` **+1** |
| Keeps | `finalizedById` / `finalizedAt` — never cleared |
| Attendance rows | **Touches none.** It unseals; it does not correct |
| Lock | Takes the month advisory lock, same as `finalize()` and the correction path |

**The length floor proves a reason was typed, not that it is a good one.** It
rejects a blank, whitespace and a one-word dismissal. It cannot tell a real
explanation from a plausible-length non-answer — "as discussed" is twelve
characters and passes — and no length rule could. The text is kept on the row
and in the audit event so a person can judge it.

**A `SENT` month is reopenable, deliberately.** A genuine error does not stop
being an error once it has been emailed. But Finance is already holding that
report, so the correction will make Apex OS disagree with a document somebody is
working from. The reopen records that it came from a settled state; **telling
Finance is a human step this cannot perform.**

### Why the Finance handoff needs no extra guard

`mayContactProvider()` already requires `FINALIZED` or `SENT`. A `REOPENED`
month is therefore unsendable with no new code: corrections must be followed by
an explicit re-finalization before anything reaches Finance. `finalize()`
refuses `FINALIZED` and `SENT` but not `REOPENED`, so the second finalization is
permitted by design — tested explicitly, since a reopen that could not be
followed by a re-finalization would strand the month as correctable forever and
never sendable.

### What this gives up compared to the fingerprint

The fingerprint could detect *any* divergence between what was approved and what
was about to be sent, including one introduced by a path nobody anticipated.
Business state only refuses the paths that check it. The checks live at the one
write — `reviseForApprovedCorrection()` — and in the importer, both under the
month lock, so a new writer that bypassed them would bypass the seal. That is a
real reduction in coverage, accepted as the cost of a protection a person can
read off the row.

---

## Verification

Both decisions are mutation-tested, not merely unit-tested: a passing test that
would also pass against the defect proves nothing, which is a failure this
codebase has hit repeatedly.

| Decision | Mutants | Result |
|---|---|---|
| Late cutoff | 7, including the exact previous per-shift rule and a per-row re-resolution | all killed |
| Finalized-month seal | 13, including restoring the old permission, treating `REOPENED` as sealed, dropping the lock, dropping the audit, and making a reopened month sendable | all killed |

## Migration status

`20261002140000_month_close_reopened` — **additive and UNAPPLIED.** One enum
value and four columns; nothing dropped, nothing narrowed, no existing row
changes meaning. It joins two other unapplied migrations; the schema and the
migration must deploy together.
