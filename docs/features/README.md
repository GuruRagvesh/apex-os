# Feature Documentation

One folder per product domain. Each folder holds the documentation for that
domain's behaviour, contracts, and known issues.

## Canonical index

[`FEATURE_REGISTRY.md`](FEATURE_REGISTRY.md) is the authoritative map from
feature → frontend paths, backend paths, database models, API endpoints,
status, environment, feature flag, risk, tests, and known issues. If a document
here disagrees with the registry, the registry is treated as current and the
document as point-in-time.

## Domains

| Folder | Scope |
| --- | --- |
| [`attendance/`](attendance/) | Workday lifecycle, breaks, meetings, attendance history, HRMS attendance workspace. |
| [`authentication/`](authentication/) | Login, JWT, password recovery, OTP. |
| [`dashboard/`](dashboard/) | Dashboard, analytics, reporting surfaces. |
| [`leave/`](leave/) | Leave application, approval, balance. |
| [`notifications/`](notifications/) | In-app and email notification delivery. |
| [`projects/`](projects/) | Projects and project stages. |
| [`sales-crm/`](sales-crm/) | Sales CRM workspace and leads. |
| [`teams/`](teams/) | Teams, reporting hierarchy, manager/TL surfaces. |
| [`tickets/`](tickets/) | Ticket lifecycle, timing/ledger, review and rework, SLA. Audits in [`tickets/audits/`](tickets/audits/). |
| [`users/`](users/) | User management and employee profiles. |

## Does not belong here

- Fix-program history — those stay under [`../programs/`](../programs/) by
  program prefix, even when the subject is a single feature.
- Generated repair output → [`../archive/generated-artifacts/`](../archive/generated-artifacts/)
