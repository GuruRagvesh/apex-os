# Audits

Point-in-time audits and matrices that are not tied to a single fix program or
a single feature.

## Belongs here

| Folder | Scope |
| --- | --- |
| [`system/`](system/) | Whole-system audits, feature matrices, reconciliation trackers. |
| [`runtime/`](runtime/) | Deployed-runtime audits and runtime fix plans. |
| [`connectivity/`](connectivity/) | Feature connectivity and connection matrices. |
| [`historical/`](historical/) | Forensic and historical-data audits. |

## Does not belong here

- Program-prefixed audits → [`../programs/`](../programs/)
- Unambiguously feature-scoped audits → [`../features/<domain>/`](../features/)
- Security audits → [`../security/audits/`](../security/audits/)

## Note

Every document here is dated evidence, not current state. Where an audit's
findings are still open, they should be reflected in
[`../features/FEATURE_REGISTRY.md`](../features/FEATURE_REGISTRY.md) under
"Known issues" so the current view stays in one place.
