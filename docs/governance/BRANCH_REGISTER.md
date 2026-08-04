# Branch Register

**Status:** Point-in-time
**Date:** 2026-08-04
**Recorded from:** `git branch -a -vv`, `git branch -r --merged/--no-merged` against
`origin/main` and `origin/staging`, after `git fetch origin --prune`.

**No branch was deleted, renamed, merged, or rebased to produce this register.**

---

## Register

| Branch | Local/Remote | Tip | Merged into `main` | Merged into `staging` | Purpose (inferred) | Recommended action | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `main` | Both | `d3f0490` | — | **No** | Production | Keep. Protected. | High |
| `staging` | Both | `d9e9453` | **No** | — | Staging integration | Keep. Needs reconstruction — see note below. | High |
| `chore/repo-compartmentalization-audit` | Local only | `4f61b20` | No | No | This repository cleanup | Keep until merged, then delete | High |
| `feat/attendance-v2-unified-card` | Both | `43a2010` | **No** | No | Attendance Phase 2A unified card | **PROTECTED — do not touch.** Active work. | High |
| `fix/workday-transactional-finalizer` | Both | `6cf9b65` | **Yes** | No | Workday transactional finalizer (PR #11) | Deletion candidate — merged via `d3f0490` | High |
| `fix/workday-resume-autoclose-consent` | Both | `35a1aeb` | **Yes** | No | Workday auto-close consent (PR #9) | Deletion candidate — verify first | Medium |
| `feat/sales-crm-leads-backend-foundation` | Remote | `3d3dcd8` | **Yes** | No | Sales CRM leads backend (PR #7) | Deletion candidate — verify first | Medium |
| `feat/sales-crm-leads-live` | Remote | `2b0f983` | **Yes** | No | Sales CRM leads live behind flag (PR #8) | Deletion candidate — verify first | Medium |
| `fix/query-approval-scope` | Remote | `74a6038` | **Yes** | No | Query approval visibility scope (PR #10) | Deletion candidate — verify first | Medium |
| `phase-b1-approval-schema-safety` | Remote | `2b9d370` | **Yes** | **Yes** | Pending-approval UI for task creation | Deletion candidate — verify first | Medium |
| `stabilize/apex-os-core` | Remote | `439ee07` | **Yes** | **Yes** | Core stabilization — ticket ID collision fix | Deletion candidate — verify first | Medium |

---

## Notes

### `staging` has diverged from `main`

`staging` is **not** merged into `main` and `main` is **not** merged into
`staging`. The two branches share a merge base at `ca04899`.

- `main..staging` — 2 commits, both HRMS attendance capture work
  (`925c445`, `d9e9453`).
- `staging..main` — 19 commits, including the Sales CRM work, the query-approval
  fix, the workday auto-close consent fix, and the transactional finalizer.

`staging` is therefore substantially behind production and cannot currently be
used to validate a change against something resembling `main`. Reconstructing it
is a separate, medium-risk operation: preserve the current branch behind a
backup tag, build a fresh candidate from `main`, reapply the two HRMS commits
additively, verify, and only then replace it — with explicit approval.

### On deletion candidates

"Merged into `main`" is a necessary but not sufficient condition for deletion.
A branch may be merged and still hold context worth keeping, or may have been
merged in a form that was later reverted. **No branch on this list should be
deleted on the strength of this register alone** — confirm the specific merge
commit and that the work is present on `main` first.

### Protected

`feat/attendance-v2-unified-card` is active, unmerged work. It must not be
rebased, merged, deleted, or included in repository-cleanup operations.
