# Restricted Generated Artifacts

> **Handle with care.** Every file in this folder was found to contain
> production-linked identifiers or other sensitive values during the 2026-08-04
> compartmentalization review.

## Why these are here

These are machine-generated outputs from historical data-repair programs. They
are retained because they are the record of what was inspected or changed in
production data — including rollback data. They are **not** deleted.

They were moved here, unmodified, with `git mv`. **No file in this folder has
been sanitised or edited.** Sanitising in place would destroy the fidelity of
the record.

## What was detected

Detection was pattern-based (counts only — no values were printed or logged
during the review):

| File | Finding |
| --- | --- |
| `FP20C_MANUAL_REVIEW_EXPORT.csv` | 122 data rows with `UserId` and `Date` columns — production user identifiers linked to attendance dates |
| `FP20C_ROLLBACK_DATA.json` | Production record identifiers |
| `FP20C_DRY_RUN_OUTPUT.md` | Production record identifiers |
| `FP20C_EXCLUDE_REPORTING_EXPORT.json` | Production record identifiers |
| `FP19B_HISTORICAL_WORKDAY_REPAIR_DRY_RUN_REPORT.md` | Large number of production record identifiers |
| `P1A_INTERRUPTED_CHANGES.patch` | Contains an email address |

No access tokens, passwords, or database connection strings were detected in
these files.

## Rules

1. **Do not share these outside the team.** Do not paste their contents into
   chat, issues, PRs, or external tools.
2. **Do not sanitise them in place.** If a redacted version is needed, create a
   separate, clearly-named derived file — leave the original intact.
3. **Do not delete them.** They are the rollback and audit record for
   production data changes.
4. **Do not copy them outside the repository** without an explicit decision
   about where the copy will live and who can reach it.

## If these should not be in Git at all

That is a legitimate position, and it is a separate decision from this
reorganisation. Removing them from history requires a history rewrite, which
requires its own approval and coordination — it is not something to do casually
on a shared repository. For now they are isolated and labelled.
