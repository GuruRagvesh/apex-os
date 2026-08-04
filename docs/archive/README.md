# Archive

Material that is preserved but is not current documentation.

## Contents

| Folder | Scope |
| --- | --- |
| [`legacy-reports/`](legacy-reports/) | Reports that could not be confidently classified into a domain. Not a dumping ground — items here are expected to be reclassified as their subject becomes clear. |
| [`generated-artifacts/`](generated-artifacts/) | Machine-generated repair evidence: dry-run output, rollback data, exports, status snapshots. |
| [`generated-artifacts/restricted/`](generated-artifacts/restricted/) | Generated artifacts found to contain production identifiers or other sensitive values. See that folder's own README before opening or sharing anything in it. |
| [`move-manifests/`](move-manifests/) | Records of bulk documentation moves, mapping every original path to its new path. |

## Rules

- Nothing here is deleted as part of routine cleanup. Generated repair evidence
  in particular is retained because it is the record of what was changed in
  production data and how it could be rolled back.
- Nothing here is edited to correct or sanitise its content. If an artifact is
  sensitive, it is isolated and labelled — not rewritten.
- Files here are not authoritative. For current state see
  [`../features/FEATURE_REGISTRY.md`](../features/FEATURE_REGISTRY.md).

## Finding an old path

Every moved file's original location is recorded in
[`move-manifests/`](move-manifests/). Git history is preserved through
`git mv`, so `git log --follow <new-path>` shows a file's full history across
the move.
