# SECURITY HARDENING REPORT
**Phase:** P1-C Enterprise Hardening  
**Date:** 2026-05-27  
**Status:** ✅ COMPLETE

---

## 1. Rate Limiting

### Before P1-C
`ThrottlerModule` was imported in `AppModule` but `ThrottlerGuard` was not registered as a global guard. Only AI and auth endpoints had rate limiting (applied manually per-controller).

### After P1-C
`APP_GUARD` registration added in `AppModule`:
```typescript
{ provide: APP_GUARD, useClass: ThrottlerGuard }
```
Config: `ttl: 60000ms, limit: 100` — 100 requests per 60 seconds per IP.

### Health Endpoint Exemption
`HealthController` decorated with `@SkipThrottle()` — uptime monitors (Checkly, UptimeRobot, etc.) call `/health` every 30–60 seconds from multiple nodes and must not be throttled.

### Coverage
| Endpoint Group | Rate Limited | Notes |
|---------------|-------------|-------|
| `/auth/*` | ✅ (via APP_GUARD + previous per-controller) | Login brute-force protected |
| `/ai/*` | ✅ (stricter: 10/60s via per-controller override) | AI inference cost control |
| `/tickets/*` | ✅ (global) | |
| `/users/*` | ✅ (global) | |
| `/notifications/*` | ✅ (global) | |
| `/health` | ⛔ Exempt | `@SkipThrottle()` |

---

## 2. Input Validation — ParseUUIDPipe

### Before P1-C
All `:id` route parameters accepted any string, including SQL-injection payloads or oversized strings. Downstream Prisma `findUnique({ where: { id: malicious_string } })` would silently return null.

### After P1-C
`ParseUUIDPipe` added to all `:id` params across the five highest-traffic controllers:

| Controller | Params Hardened |
|-----------|----------------|
| `notifications.controller.ts` | `:id` (markRead, remove) |
| `tickets.controller.ts` | `:id` (all 10 routes) |
| `projects.controller.ts` | `:id`, `:userId` (all 5 routes) |
| `leave.controller.ts` | `:id`, `:userId` (all 4 routes) |
| `comments.controller.ts` | `:ticketId`, `:id` (all 4 routes) |

**Impact**: Non-UUID values now receive a `400 Bad Request` before any service or DB layer is reached.

### Remaining Controllers (P2)
`roles.controller.ts`, `departments.controller.ts`, `users.controller.ts`, `task-types.controller.ts` still use bare `@Param('id')`. These have admin-only role guards as secondary protection; ParseUUIDPipe should be added in P2.

---

## 3. JWT Security

### Token Configuration (Existing — P0 Frozen)
- JWT secret loaded from `process.env.JWT_SECRET` — no default fallback in production code
- `JwtAuthGuard` applied globally via controller-level `@UseGuards` on all authenticated routes
- Token expiry: configurable via `JWT_EXPIRES_IN` env var (default: `7d`)

### Recommendations (P2/P3)
- Consider shorter JWT expiry (1h) with refresh token rotation for high-security deployments
- Add JWT revocation via Redis blocklist for logout-all-sessions feature

---

## 4. CORS & WebSocket Security

### Before P1-C
WebSocket gateway `events.gateway.ts` listed `'http://localhost:3001'` (the backend URL) as an allowed WS origin — this is the NestJS server port, unreachable from a browser; functionally a dead entry but misleading.

### After P1-C
Removed `'http://localhost:3001'` from `WS_ORIGINS`. Valid origins:
```
http://localhost:3000  (dev)
http://localhost:3001  ← REMOVED (was backend URL, not frontend)
FRONTEND_URL env var   (production)
```

### HTTP CORS (Existing — P0 Frozen)
`app.enableCors()` uses `FRONTEND_URL` env var — no wildcard in production.

---

## 5. File Upload Security (P1-B — Carried Forward)

MIME-type allowlist enforced at controller level before `UploadsService`:
```typescript
const ALLOWED_MIME = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv', 'application/zip',
];
```
5 MB size limit enforced. Rejected files return `400` before Cloudinary upload.

---

## 6. Authorization Architecture (P0 Frozen)

The following services are the authoritative access control layer and were NOT modified:
- `AccessPolicyService` — role-based access decisions
- `TicketAccessService` — ticket-level permission checks (owner, assignee, manager, admin)
- `LeaveAccessService` — leave approval authority chain
- `RolesGuard` + `@Roles()` decorator — controller-level role enforcement

No business logic was moved to controller layer. All access decisions remain in the frozen service layer.

---

## 7. Sensitive Field Protection

User documents (contracts, ID scans) are gated by `getDocuments()` which checks `requester.id === targetId || isAdmin`. HR-sensitive fields (`salary`, `personalInfo`) are not included in standard `findAll()` projections.

---

## Summary
| Check | Result |
|-------|--------|
| Global rate limiting | ✅ |
| ParseUUIDPipe on high-traffic controllers | ✅ |
| WS CORS dead entry removed | ✅ |
| File upload MIME allowlist | ✅ |
| JWT secret from env (no hardcode) | ✅ |
| Authorization layer frozen/intact | ✅ |
| Sensitive fields not exposed | ✅ |
