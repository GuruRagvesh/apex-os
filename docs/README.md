# Apex OS Documentation

Documentation root for Apex OS. This replaces the previous pattern of tracking
hundreds of project reports at the repository root.

Established on branch `chore/repo-compartmentalization-audit`, base commit
`d3f0490`, 2026-08-04.

## What lives where

| Folder | Contents |
| --- | --- |
| [`product/`](product/) | Roadmaps, feature-status boards, legacy product lists. |
| [`architecture/`](architecture/) | System and data architecture, including [`REPOSITORY_MAP.md`](architecture/REPOSITORY_MAP.md). |
| [`features/`](features/) | Per-domain feature documentation. Canonical index: [`FEATURE_REGISTRY.md`](features/FEATURE_REGISTRY.md). |
| [`operations/`](operations/) | Deployment, production, backup/recovery, stabilization, monitoring. |
| [`qa/`](qa/) | End-to-end, smoke, accessibility, and verification evidence. |
| [`security/`](security/) | Security audits and permission-model documentation. |
| [`programs/`](programs/) | Historical, code-named fix programs (P0, P1, FP10–FP20, PHASE_*, TVA). |
| [`audits/`](audits/) | System, runtime, connectivity, and historical audits. |
| [`governance/`](governance/) | Git workflow, documentation policy, branch register. |
| [`archive/`](archive/) | Superseded reports, generated artifacts, move manifests. |

## Canonical documents

- [`features/FEATURE_REGISTRY.md`](features/FEATURE_REGISTRY.md) — the authoritative
  map of every feature to its frontend paths, backend paths, database models,
  API endpoints, status, and risk.
- [`architecture/REPOSITORY_MAP.md`](architecture/REPOSITORY_MAP.md) — what each
  top-level directory holds and why runtime code was not moved.
- [`governance/DOCUMENTATION_POLICY.md`](governance/DOCUMENTATION_POLICY.md) —
  where new documents belong and what every report must contain.
- [`governance/GIT_WORKFLOW.md`](governance/GIT_WORKFLOW.md) — branch model and
  merge requirements.

## Ground rules

- No new feature report at the repository root. See the documentation policy.
- Documentation moves are separate commits from any runtime, schema, or
  deployment change.
- Historical reports are preserved, not rewritten. If a report is outdated, it
  is superseded by a new document that links back to it — the original is not
  edited to make it look correct in hindsight.
- Original paths for every moved file are recorded in
  [`archive/move-manifests/`](archive/move-manifests/).
