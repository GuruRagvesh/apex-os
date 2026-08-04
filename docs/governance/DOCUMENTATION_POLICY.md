# Documentation Policy

**Status:** Canonical
**Date:** 2026-08-04

This policy exists because the repository accumulated 253 Markdown reports at
its root. The code was not the problem; the documentation sprawl was.

## Where documents belong

| Document type | Location |
| --- | --- |
| Feature documentation | `docs/features/<domain>/` |
| Historical fix-program report | `docs/programs/<program>/` |
| Deployment / operational runbook | `docs/operations/` |
| QA evidence and test plans | `docs/qa/` |
| Security findings | `docs/security/` |
| System / runtime / connectivity audits | `docs/audits/` |
| Architecture and decisions | `docs/architecture/` |
| Product roadmaps and status | `docs/product/` |
| Process and workflow | `docs/governance/` |
| Generated repair output | `docs/archive/generated-artifacts/` |
| Superseded or unclassifiable | `docs/archive/` |

## Hard rules

1. **No new feature report at the repository root.** The root contains only
   operational repository entry files: `README.md`, `.gitignore`,
   `package.json`, `package-lock.json`, `render.yaml`, and root executable
   utilities pending their own audit.
2. **Program prefix beats subject.** A report named `FP18E_POLICY_AUTO_STOP_*`
   is attendance-related but belongs in `docs/programs/fp18/`, so the program
   reads end-to-end. The current per-feature view lives in the feature registry.
3. **Never name a file** `final`, `final-new`, `copy`, `copy-2`, `backup`,
   `old`, `test-final`, `latest-working`, or any variant. Git history is the
   versioning mechanism.
4. **Never commit** credentials, tokens, connection strings, raw production
   rows, or personal identifiers. Generated exports that contain them go to
   `docs/archive/generated-artifacts/restricted/` and are not sanitised in
   place.

## Required header on every new report

```
Status:       Canonical | Point-in-time | Superseded
Date:         YYYY-MM-DD
Scope:        what this covers
Environment:  LOCAL | STAGING | PRODUCTION | MIXED | N/A
Branch:       branch name
Commit:       short SHA
Owner:        person responsible
```

## Canonical vs point-in-time

- A **canonical** document describes current intended state and says so. There
  should be exactly one canonical document per subject.
- A **point-in-time** document is dated evidence — an audit, a verification run,
  a program report. It is never edited to make its conclusions look correct in
  hindsight.
- A **superseded** document links forward to its replacement. The replacement
  does not delete or rewrite it.

## Do not

- Do not rewrite historical reports to correct outdated claims. Write a new
  document and supersede the old one.
- Do not merge two documents' contents during a reorganisation.
- Do not delete generated repair evidence — it is the record of what changed in
  production data and how it could be rolled back.
