# APEX OS PENDING WORK REGISTER

This register tracks all features, improvements, and manual corrections that were intentionally deferred to prioritize the stability of the core Apex OS delivery.

## Deferred Delivery Checklist

| Item | Classification | Description |
|---|---|---|
| **Historical workday manual review records** | P1 should fix soon | Existing legacy workday sessions that were corrupted prior to FP-19 repairs must be reviewed and processed via the FP-19B standalone script/repair path. |
| **Manual live acceptance** | P1 should fix soon | A comprehensive manual UI validation using the Handover Readiness checklist is required on the production/staging instances. |
| **Dashboard Action Center cleanup** | P2 post-delivery improvement | Enhancements to the action center (cleaning up stale tasks, better layout grouping) are pending. |
| **SLA notification engine** | P2 post-delivery improvement | Advanced SLA breach notifications and custom threshold alerting engines are currently deferred. |
| **Workday correction/audit screen** | P2 post-delivery improvement | A dedicated UI for administrators to manually edit and audit specific work sessions is required for long-term operability. |
| **Activity feed cleanup** | P2 post-delivery improvement | Visual and performance improvements to the recent activity feed are scheduled for future polish. |
| **Individual timing overrides** | P2 post-delivery improvement | Support for customized, employee-specific scheduling and ticket timer overrides. |
| **CRM module** | P3 future feature | The entirely new CRM expansion package remains unbuilt. |
| **HRMS expansion** | P3 future feature | Deep HRMS extensions (beyond basic Leave logic) are deferred to a future milestone. |
| **AI features** | P3 future feature | Automated AI summarization, predictions, or ticket suggestions are out of scope for current core stabilization. |

### Classification Guide
- **P0 delivery blocker**: Prevents daily operation or corrupts data. (None currently active)
- **P1 should fix soon**: Major workflow gap or data cleanup task that limits system utility.
- **P2 post-delivery improvement**: Confusing UI, incomplete feature, or missing optimization.
- **P3 future feature**: Completely new architectural expansions.
