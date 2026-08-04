# QA Documentation

Test plans and test evidence.

## Belongs here

| Folder | Scope |
| --- | --- |
| [`e2e/`](e2e/) | End-to-end workflow test plans and browser-workflow reports. |
| [`smoke/`](smoke/) | Smoke-test matrices and production smoke validation. |
| [`accessibility/`](accessibility/) | Accessibility, responsive-layout, and UX-polish reports. |
| [`verification/`](verification/) | Manual QA checklists and general verification reports. |

## Does not belong here

- Program-prefixed verification reports (`FP13_*_VERIFICATION.md`, etc.) stay
  under [`../programs/`](../programs/) with their program. Program prefix has
  higher classification priority than subject.
- Runtime/system audits → [`../audits/`](../audits/)

## Note

Evidence here is dated. A passing report is evidence for the commit and
environment it names, not a standing guarantee. Test paths currently tracked in
the repository are listed per feature in
[`../features/FEATURE_REGISTRY.md`](../features/FEATURE_REGISTRY.md).
