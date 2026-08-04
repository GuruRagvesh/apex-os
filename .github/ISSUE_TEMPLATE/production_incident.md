---
name: Production incident
about: Something is broken in production right now
title: '[INCIDENT] '
labels: 'type:bug, risk:high, status:production'
assignees: ''
---

> Fill in what you know now. Do not wait until you have all of it.

## Environment

- [ ] Production
- [ ] Staging

## Affected users

<!-- Who and roughly how many. Which roles or departments. -->

## First observed

<!-- Time and timezone. How it was noticed — user report, alert, log. -->

## Current impact

- [ ] Users cannot log in
- [ ] Attendance is being recorded incorrectly
- [ ] Ticket data is incorrect or inaccessible
- [ ] Leave data is incorrect
- [ ] Data is being written incorrectly (ongoing corruption)
- [ ] Degraded but usable
- [ ] Other:

## Recent deploy

<!-- What was deployed most recently, and when. Merge commit SHA if known.
     Does the timing line up with first observation? -->

## Logs and evidence

<!-- Backend logs, health check output, console errors, request IDs.
     Do not paste credentials, tokens, connection strings, or personal data. -->

## Reproduction

<!-- Can it be reproduced on demand? Exact steps if so. -->

## Containment

<!-- What has already been done to limit the impact. -->

## Rollback decision

- [ ] Rolled back — to:
- [ ] Rolling forward with a fix
- [ ] No action yet — reason:

<!-- Rolling back a deploy that included a Prisma migration is not a plain
     revert. State explicitly whether a migration is involved. -->

## Data-integrity concern

<!-- Is stored data now wrong? Attendance totals, break logs, ticket timers,
     leave balances? Does anything need repair after the immediate fix?
     If yes, that repair is its own approved task — do not run repair scripts
     as part of incident response without explicit approval. -->

## Follow-up

- [ ] Root cause identified
- [ ] Fix merged
- [ ] Staging validation added
- [ ] Data repair required (separate approved task)
- [ ] Post-incident note added to `docs/operations/production/`
