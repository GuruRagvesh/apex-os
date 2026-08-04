# Historical Fix Programs

Apex OS has been stabilised through a series of code-named work programs. Each
program's reports are grouped here by its prefix, so a program's full history
(audit → plan → implementation → verification) stays together and traceable.

## Why prefix beats subject

A report named `FP18E_POLICY_AUTO_STOP_REPORT.md` is about attendance, but it
lives in [`fp18/`](fp18/) rather than `../features/attendance/`. Program history
is only useful if a program can be read end-to-end. The per-feature current view
lives in [`../features/FEATURE_REGISTRY.md`](../features/FEATURE_REGISTRY.md)
instead.

## Programs

| Folder | Program |
| --- | --- |
| [`p0/`](p0/) | P0 — architecture freeze and baseline. |
| [`p1/`](p1/) | P1A–P1D — reconciliation and implementation phases. |
| [`fp10/`](fp10/) | FP10 — missing-feature closure. |
| [`fp11/`](fp11/) | FP11 — storage, email, OTP delivery pipeline. |
| [`fp12/`](fp12/) | FP12 — recurring ticket scheduler. |
| [`fp13/`](fp13/) | FP13 — ticket lifecycle, timer ledger, review/rework, permissions. |
| [`fp14/`](fp14/) | FP14 — projects V2 foundation. |
| [`fp15/`](fp15/) | FP15 — employee hierarchy approvals. |
| [`fp16/`](fp16/) | FP16 — workday time policy, rework clocks and ratings. |
| [`fp18/`](fp18/) | FP18 — production smoke, workday runtime, ticket timers, notification monitoring, policy auto-stop. |
| [`fp19/`](fp19/) | FP19 — historical workday cleanup, smoke tests, attachment review. |
| [`fp20/`](fp20/) | FP20 — attendance/TVA fixes, historical repair (FP20C), dashboard clock. |
| [`phase-x/`](phase-x/) | PHASE_X — baseline, implementation, verification. |
| [`phase-y/`](phase-y/) | PHASE_Y — baseline. |
| [`phase-omega/`](phase-omega/) | PHASE_OMEGA — operational UX. |
| [`tva/`](tva/) | TVA — time/value authority audits across modules. |

## Note

These are historical records. They are not edited to correct outdated claims —
if a program's conclusion no longer holds, the current position belongs in the
feature registry or a new document, not in a rewrite of the original.

Generated repair evidence produced by these programs (exports, rollback data,
dry-run output) is not stored here — see
[`../archive/generated-artifacts/`](../archive/generated-artifacts/).
