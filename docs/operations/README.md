# Operations Documentation

Running Apex OS in real environments: deploying it, keeping it healthy,
recovering it, and stabilising it.

## Belongs here

| Folder | Scope |
| --- | --- |
| [`backup-recovery/`](backup-recovery/) | Backup setup, backup verification, restore health, disaster-recovery SOP. |
| [`deployment/`](deployment/) | Deployment readiness, rollout, handover, delivery blockers. |
| [`production/`](production/) | Production-environment reports and live verification. |
| [`stabilization/`](stabilization/) | Stabilisation programmes, priority boards, remaining-issue registers, fix packs. |
| [`monitoring/`](monitoring/) | Health checks, monitoring inventories, runtime error registers. |

## Does not belong here

- QA test evidence → [`../qa/`](../qa/)
- Security findings → [`../security/`](../security/)
- Program-prefixed historical reports → [`../programs/`](../programs/)

## Safety note

Several documents here describe destructive or production-touching procedures.
They are documentation only. Executing any backup, restore, repair, seed or
migration procedure requires its own explicit approval — see
[`../governance/GIT_WORKFLOW.md`](../governance/GIT_WORKFLOW.md).
