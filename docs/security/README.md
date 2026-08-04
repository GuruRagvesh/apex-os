# Security Documentation

Security posture, access control, and audit integrity.

## Belongs here

| Folder | Scope |
| --- | --- |
| [`audits/`](audits/) | Security hardening reports, audit-integrity reviews. |
| [`permissions/`](permissions/) | Role visibility, permission matrices, access-policy documentation. |

## Does not belong here

- Generated exports containing production identifiers →
  [`../archive/generated-artifacts/restricted/`](../archive/generated-artifacts/restricted/)
- Feature-level permission behaviour that is really product behaviour →
  [`../features/`](../features/)

## Handling rules

- Never commit credentials, tokens, connection strings, or raw production rows
  to this folder — or anywhere else in the repository.
- If a security document must reference production data, reference it by
  description, not by value.
- Findings that are still open should say so explicitly, with a date.
