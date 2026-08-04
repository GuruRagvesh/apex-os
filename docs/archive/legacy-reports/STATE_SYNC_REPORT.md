# STATE SYNC REPORT
**Phase:** P1-C Enterprise Hardening  
**Date:** 2026-05-27  
**Status:** ✅ REVIEWED — No regressions; patterns consistent

---

## 1. State Management Architecture

### Server State: TanStack Query
All API data is managed via TanStack Query (`@tanstack/react-query`). Query keys are scoped per resource:

| Resource | Query Key | Invalidation On Mutation |
|----------|-----------|------------------------|
| Tickets list | `['tickets']` | create, update, status change |
| Ticket detail | `['ticket', id]` | update, comment add, attachment |
| Projects | `['projects']` | create, update, delete |
| Leave | `['leave', tab]` | create, approve, reject, cancel |
| Leave stats | `['leave-stats']` | approve, reject |
| Users | `['users']` | create, update, deactivate |
| Notifications | `['notifications']` | markRead, markAllRead |
| SLA risk | `['sla-risk']` | refetchInterval: 120000ms |
| Departments | `['departments']` | create, update |
| Analytics | `['analytics', params]` | — |

### Client State: Zustand
`useAuthStore` holds authenticated user object:
- `user.id`, `user.role`, `user.name`, `user.email`, `user.departmentId`
- Hydrated from JWT on login; cleared on logout
- Role checks performed in UI with defensive fallbacks:
  ```typescript
  const roleName = (user?.role as any)?.name ?? user?.role ?? '';
  ```

---

## 2. Mutation Invalidation Patterns

All mutations follow the pattern:
```typescript
onSuccess: () => {
  qc.invalidateQueries({ queryKey: ['resource'] });
  // additional related invalidations
}
```

### Verified Mutation/Invalidation Pairs

| Mutation | Queries Invalidated |
|----------|-------------------|
| Create ticket | `['tickets']`, `['projects', id]` if projectId set |
| Update ticket status | `['tickets']`, `['ticket', id]` |
| Approve leave | `['leave']`, `['leave-stats']` |
| Reject leave | `['leave']`, `['leave-stats']` |
| Cancel leave | `['leave']`, `['leave-stats']` |
| Create project | `['projects']` |
| Mark notification read | `['notifications']` |
| Mark all read | `['notifications']` |

---

## 3. Real-Time Updates (WebSocket)

`NotificationEventService` emits to Socket.io gateway on events:
- `notification.created` → client receives push, triggers query invalidation via `useNotifications` hook
- `ticket.updated` → currently only notification-based; no direct ticket query invalidation from WS events (P2 improvement)

### WebSocket Connection Handling
The frontend `socket.io-client` connects on mount via the notifications hook. Reconnect logic is handled by Socket.io client library automatically.

**Fixed in P1-C**: Removed `http://localhost:3001` (backend port) from allowed WS origins in `events.gateway.ts`. The WS gateway was unreachable from browsers due to this incorrect entry.

---

## 4. Stale Time Configuration

| Query | staleTime | refetchInterval | Notes |
|-------|-----------|----------------|-------|
| SLA risk | 60s | 120s | Managers need near-real-time |
| Notifications | 0 (default) | — | WS push handles freshness |
| Tickets list | 0 (default) | — | |
| Leave stats | 0 (default) | — | |
| Departments | — | — | Rarely changes; no refetch |

---

## 5. Tab/Focus Refetch

TanStack Query refetchOnWindowFocus is enabled by default. This ensures stale data is refreshed when users switch browser tabs. No overrides were introduced that disable this behavior.

---

## 6. Optimistic Updates

No optimistic updates are used. All mutations wait for server confirmation before showing the updated state. This is the safer approach for an enterprise app and prevents ghost state on errors.

---

## 7. Auth State Edge Cases

### Token Expiry
JWTs expire per `JWT_EXPIRES_IN` env var. On expiry, the API returns 401. The axios interceptor in `lib/api.ts` catches 401 responses and calls `useAuthStore.getState().logout()`, redirecting to `/login`.

### Role Mismatch
Role is stored in Zustand on login. If an admin demotes a user's role, the JWT still contains the old role until the next login. This is documented in `P1C_REMAINING_RISKS.md` as acceptable (users are re-logged in after role changes in practice).

---

## Summary
| Check | Result |
|-------|--------|
| All mutations invalidate relevant queries | ✅ |
| WS CORS origin corrected | ✅ |
| No orphaned state after mutations | ✅ |
| Auth store role extraction defensive | ✅ |
| SLA risk auto-refreshes | ✅ |
