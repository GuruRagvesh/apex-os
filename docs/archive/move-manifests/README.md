# Move Manifests

Records of bulk documentation reorganisations. Each manifest maps every
original path to its new path so nothing becomes unfindable after a move.

## Manifests

| File | Date | Operation |
| --- | --- | --- |
| [`compartmentalization-2026-08-04.csv`](compartmentalization-2026-08-04.csv) | 2026-08-04 | Root documentation compartmentalization |

---

## compartmentalization-2026-08-04

**Date:** 2026-08-04
**Source branch:** `chore/repo-compartmentalization-audit`
**Base commit:** `d3f0490` (`origin/main`)
**Safety tag:** `pre-compartmentalization-20260804-d3f0490` (local)
**Rows:** 281 — 278 moves, 2 renames-with-move, 1 deletion

### What happened

The repository had 268 tracked files at its root, 253 of them Markdown reports.
They were moved into `docs/` compartments. Afterwards the root holds 7 tracked
files.

**No runtime code was moved.** Nothing under `backend/src/`, `backend/prisma/`,
`backend/scripts/`, `backend/test/`, `frontend/app/`, `frontend/components/`,
`frontend/hooks/`, `frontend/lib/`, `frontend/modules/`, `frontend/store/`,
`frontend/styles/`, `frontend/public/`, or `e2e/` was touched. `package.json`,
`package-lock.json`, `render.yaml`, and `.gitignore` were not modified. The only
`backend/` changes were relocations of Markdown documentation.

### Classification rules

Applied in strict priority order — first match wins:

1. **Historical program prefix** — `P0_`, `P1A`–`P1D`, `FP10`–`FP20`, `FP-20B`,
   `PHASE_X_`, `PHASE_Y_`, `PHASE_OMEGA_`, `TVA_` → `docs/programs/<program>/`.
   This deliberately outranks subject: a program's reports stay together so its
   history reads end-to-end.
2. **Feature subject** — attendance/workday, auth/OTP/login/password,
   dashboard/analytics/reporting, leave, notifications, projects,
   teams/hierarchy, tickets/kanban/SLA/timer/blocked, user-profile/employee,
   sales-crm → `docs/features/<domain>/`.
3. **Security** — security, permission, access-policy, role-visibility,
   role-based, audit-integrity → `docs/security/`.
4. **Operations** — backup/restore/disaster-recovery, deploy/rollout/handover,
   stabilization/remaining-issue/priority-board/fix-pack,
   health-check/monitoring/runtime-errors, production/live → `docs/operations/`.
5. **QA** — E2E, smoke, QA, verification, accessibility, responsive, UX →
   `docs/qa/`.
6. **Audits and matrices** — audit, matrix, inventory, connectivity,
   reconciliation, classification, status → `docs/audits/`.
7. **Product** — roadmap, feature-status, pending-work, known-limitations,
   deferred-features, module-readiness, execution-os, product →
   `docs/product/`.
8. **Fallback** — anything not confidently classifiable →
   `docs/archive/legacy-reports/`. Ten files landed here. They were **not**
   assigned a guessed domain.

### Renames

Only two, both explicitly approved:

| From | To |
| --- | --- |
| `project Features.txt` | `docs/product/legacy/legacy-feature-list.md` |
| `FP-20B_IMPLEMENTATION_MAP.md` | `docs/programs/fp20/FP20B_IMPLEMENTATION_MAP.md` |

All other filenames were preserved exactly.

### Deletion

One file: `FP13_1A_TICKET_STATE_GUARDRAILS_REPORT.md`. Confirmed 0 bytes and
confirmed unreferenced (`git grep` across all tracked files returned no
references). Recoverable from history and from the safety tag.

### Sensitive artifacts

Ten generated artifacts were reviewed for emails, phone numbers, tokens,
passwords, database URLs, and raw production record identifiers. Detection was
count-based — **no sensitive values were printed during the review**.

- **Six** were found to contain production identifiers or an email address and
  were moved to `docs/archive/generated-artifacts/restricted/`, unmodified. See
  that folder's README.
- **Four** showed no sensitive content and were moved to
  `docs/archive/generated-artifacts/`.

Nothing was sanitised, edited, or deleted.

### Finding a file's old path

History is preserved — every move used `git mv`.

```bash
# Full history of a file across the move
git log --follow docs/programs/fp18/FP18E_POLICY_AUTO_STOP_REPORT.md

# The state of the repository immediately before compartmentalization
git show pre-compartmentalization-20260804-d3f0490

# Look up a specific original path
grep '^"FP18E' docs/archive/move-manifests/compartmentalization-2026-08-04.csv
```

### Columns

| Column | Meaning |
| --- | --- |
| `OriginalPath` | Path before the move. |
| `NewPath` | Path after the move. Empty for deletions. |
| `Action` | `MOVE`, `RENAME+MOVE`, or `DELETE`. |
| `Category` | Classification bucket that decided the destination. |
| `Reason` | Which rule matched. |
| `SensitiveReview` | Outcome of the sensitive-content review. |
| `Notes` | Anything else worth recording. |
