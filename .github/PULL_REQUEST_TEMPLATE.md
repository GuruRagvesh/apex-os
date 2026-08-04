## Summary

<!-- What this change does, in one or two sentences. -->

## Scope

<!-- What this PR covers, and explicitly what it does not. One concern per PR. -->

## Files changed

<!-- Paste `git diff --stat origin/main...HEAD` or summarise by area. -->

## Risk classification

- [ ] LOW — documentation, non-runtime, or fully isolated
- [ ] MEDIUM — runtime behaviour change, reversible
- [ ] HIGH — attendance / authentication / schema / SLA / payroll-adjacent

## Change surface

| Area | Changed? | Notes |
| --- | --- | --- |
| Frontend | yes / no | |
| Backend | yes / no | |
| Prisma schema | yes / no | |
| Migration included | yes / no | |
| Deployment config | yes / no | |

## Feature flag

<!-- Flag name and default, or "none". New risky behaviour should ship dark. -->

## Tests

<!-- Which tests were added or updated, and what they actually assert. -->

## Build and test evidence

<!-- Paste real command output, not a claim. If a suite has pre-existing
     failures, state the baseline comparison. -->

- Backend build:
- Frontend build:
- Test suite:
- Pre-existing failures (unchanged by this PR):

## Staging validation

<!-- Required for attendance, auth, schema, and SLA changes. If this was NOT
     validated on staging, say so explicitly and say why. -->

## Production impact

<!-- What a real user will notice after deploy. "None" is a valid answer if
     true — say why it is true. -->

## Rollback

<!-- One line: how to undo this. -->

## Screenshots

<!-- Required for UI changes. Before and after. -->

## Confirmation

- [ ] This PR contains **no unrelated changes**
- [ ] No credentials, tokens, connection strings, or production data are included
- [ ] No seed, reset, or repair script was run against production
- [ ] Documentation for this change is in `docs/`, not at the repository root
