# Governance

How work on Apex OS is organised, branched, reviewed, documented, and kept safe.

## Documents

| Document | Purpose |
| --- | --- |
| [`GIT_WORKFLOW.md`](GIT_WORKFLOW.md) | Branch model, naming, merge requirements, tagging. |
| [`DOCUMENTATION_POLICY.md`](DOCUMENTATION_POLICY.md) | Where documents belong and what every report must contain. |
| [`BRANCH_REGISTER.md`](BRANCH_REGISTER.md) | Every known branch, its merge status, and a recommended action. |
| `DESTRUCTIVE_OPERATION_POLICY.md` | Rules for destructive database and data operations. Moved here from `backend/`. |
| `DEVELOPMENT_SAFETY_RULES.md` | Day-to-day development safety rules. Moved here from `backend/`. |

## Belongs here

Process, policy, and workflow documentation that applies across the whole
repository rather than to one feature or environment.

## Does not belong here

- Operational runbooks for a specific environment → [`../operations/`](../operations/)
- Security findings → [`../security/`](../security/)
- Architecture rationale → [`../architecture/`](../architecture/)

## Standing constraints

Apex OS is a live system used by real employees, with attendance, tickets,
authentication, leave and payroll-adjacent data in production. Nothing in this
folder authorises pushing, merging, deploying, running migrations, or running
data-repair scripts. Those require explicit, per-action approval.
