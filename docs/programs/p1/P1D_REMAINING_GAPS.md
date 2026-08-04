# P1-D Remaining Gaps

Status: NO BLOCKING P1-D GAPS
Date: 2026-05-27

## Non-Blocking Follow-Ups

1. Legacy attachment URLs
   - Current API responses no longer expose stored attachment URLs.
   - New Cloudinary uploads use authenticated storage references.
   - If production users copied old public Cloudinary URLs before this fix, those external copies cannot be revoked by application code alone. A provider-level migration/rotation should be scheduled if historical ticket attachments contain sensitive data.

2. Lint hygiene
   - Backend and frontend lint pass, but both report warnings.
   - Most warnings are broad existing no-unused-vars / hook dependency / image warnings outside the P1-D surface.
   - These should be cleaned in a dedicated hygiene pass, not as part of P1-D operational closure.

3. Manual browser smoke
   - Build and automated tests pass.
   - A live browser pass through attachment preview/download and SMTP test send should be done against the deployed/staging SMTP and storage credentials.

4. Dashboard/project scope centralization
   - Dashboard project counts now use the same business rules as the current project service.
   - There is still no separate protected `ProjectAccessService`; creating one would be a future architecture cleanup and was intentionally not introduced in P1-D.

## Intentionally Deferred

- AI agents or orchestration
- Broadcast engine
- Standalone task system
- Workflow engine
- CRM features
- External calendar sync
- UI redesign
- WebSocket rewrite
- Mobile app

## Current Safety Position

- P1-D critical operational risks are closed in code.
- No production build/test blocker remains.
- Remaining items are operational hardening or hygiene, not P1-D blockers.
