# P1-C REMAINING RISKS
**Phase:** P1-C Enterprise Hardening  
**Date:** 2026-05-27  
**Classification:** Known — Accepted for Now / Deferred to P2

---

## RISK-001: JWT Stale Role After Role Change
**Severity:** Low  
**Description:** When an admin changes a user's role, the user's existing JWT still contains the old role claim until the token expires. The frontend role-based UI gates will show the old role's capabilities.  
**Mitigation in Place:** Server-side `AccessPolicyService` checks role from DB on every request — the JWT role is used by frontend UI gating only.  
**Resolution (P2):** Force re-login on role change via a short-lived token or add a role-version claim checked against DB.

---

## RISK-002: ParseUUIDPipe Not Applied to All Controllers
**Severity:** Low  
**Description:** `roles.controller.ts`, `departments.controller.ts`, `users.controller.ts`, `task-types.controller.ts` still use bare `@Param('id')` without `ParseUUIDPipe`.  
**Mitigation in Place:** These endpoints have admin-only `RolesGuard` as a secondary defense. Non-UUID IDs return Prisma-level null (not an error).  
**Resolution (P2):** Apply `ParseUUIDPipe` to remaining controllers.

---

## RISK-003: Frontend Leave Approval Hierarchy Duplicated
**Severity:** Low  
**Description:** `leave/page.tsx` contains a `ROLE_LEVEL` map to determine whether to show approve/reject buttons. This duplicates server-side `LeaveAccessService` logic.  
**Mitigation in Place:** Server enforces the actual access check — the frontend hierarchy is for UI visibility only. A mismatch would show a button that fails server-side, which is caught by the error handler.  
**Resolution (P2):** Backend should return a `canApprove` flag per leave item in the API response.

---

## RISK-004: Socket.io Reconnect Does Not Invalidate Notification Cache
**Severity:** Low  
**Description:** If a user's WebSocket disconnects and reconnects, any notifications received during the disconnect window won't invalidate the TanStack Query `['notifications']` cache.  
**Mitigation in Place:** Notifications are persisted in DB — they appear on next page load/navigation.  
**Resolution (P2):** Add `socket.on('reconnect', () => queryClient.invalidateQueries(['notifications']))` in the notifications hook.

---

## RISK-005: SLA Risk Endpoint Performance at Scale
**Severity:** Medium  
**Description:** `getSlaRiskCategories()` loads all open tickets and calls `getTicketTimingState()` per ticket. At 10,000+ open tickets this will be slow (>500ms).  
**Mitigation in Place:** `TicketTimingService.getSlaConfig()` is cached (60s TTL) — no per-ticket DB round trip. At current scale (<1,000 tickets), response time is acceptable.  
**Resolution (P2):** Cache the SLA risk snapshot in Redis, refresh on ticket status changes or every 5 minutes.

---

## RISK-006: User Document Upload MIME Filter Missing
**Severity:** Low  
**Description:** `POST /users/:id/documents` (HR document upload) has no MIME type filter or file size limit.  
**Mitigation in Place:** Access is admin-only (or self-upload). Cloudinary provides independent virus scanning for some account tiers.  
**Resolution (P2):** Apply same MIME allowlist and 10 MB size limit as ticket attachments.

---

## RISK-007: Audit Log Retention Policy Not Set
**Severity:** Informational  
**Description:** `operational_logs` table has no TTL or archival policy. At 100 events/day, 1 year = ~36,500 rows — acceptable. At enterprise scale (10,000 events/day), logs grow to 3.65M rows/year.  
**Resolution (P2):** Implement rolling 90-day archival cron job.

---

## RISK-008: Accessibility Gaps
**Severity:** Medium (compliance risk)  
**Description:** As documented in `ACCESSIBILITY_AND_RESPONSIVE_REPORT.md`:
- No modal focus trap
- No Escape-to-close on modals
- No skip navigation link
- Icon-only buttons lack `aria-label`
- Loading spinners lack `role="status"`
- Form inputs missing HTML `required` attribute

**Resolution (P2):** Full WCAG 2.1 AA compliance pass.

---

## RISK-009: No Refresh Token / Short-Lived JWT
**Severity:** Medium (for high-security deployments)  
**Description:** Default JWT expiry is 7 days. A stolen JWT is valid for the full duration with no revocation mechanism.  
**Resolution (P3):** Implement refresh token rotation with short-lived access tokens (1h).

---

## RISK-010: No HTTPS Enforcement at App Level
**Severity:** Medium (infrastructure risk)  
**Description:** The NestJS app does not enforce HTTPS redirect. This must be handled at the infrastructure level (reverse proxy, load balancer).  
**Resolution:** Document in deployment guide (already in `DEPLOYMENT_READINESS_REPORT.md`) — terminate TLS at Nginx/Render/Vercel, not in app.

---

## Risk Summary by Priority

| Risk | Severity | Resolution Sprint |
|------|----------|-----------------|
| RISK-005: SLA perf at scale | Medium | P2 |
| RISK-008: Accessibility gaps | Medium | P2 |
| RISK-009: Refresh token | Medium | P3 |
| RISK-010: HTTPS enforcement | Medium | Infrastructure |
| RISK-001: Stale JWT role | Low | P2 |
| RISK-002: Missing ParseUUIDPipe | Low | P2 |
| RISK-003: Frontend hierarchy | Low | P2 |
| RISK-004: Socket reconnect | Low | P2 |
| RISK-006: Doc upload MIME | Low | P2 |
| RISK-007: Audit retention | Informational | P2 |
