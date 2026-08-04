# NOTIFICATION RELIABILITY REPORT
**Phase:** P1-C Enterprise Hardening  
**Date:** 2026-05-27  
**Status:** ✅ REVIEWED

---

## 1. Notification Architecture

### Flow
```
Service event (ticket created, leave approved, etc.)
  → NotificationEventService.notify()
      → prisma.notification.create()     [persisted to DB]
      → socket.io emit to user room      [real-time push]
```

`NotificationEventService` is a **protected architectural service** (P0 frozen). It is the single entry point for all notification creation.

---

## 2. NotificationsController Hardening (P1-C)

`ParseUUIDPipe` applied to `:id` params:
```typescript
@Patch(':id/read')
markRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any)

@Delete(':id')
async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any)
```

Ownership check on delete:
```typescript
if (notification.userId !== user.id) throw new ForbiddenException('Cannot delete another user\'s notification');
```
This ensures users can only delete their own notifications — correct and unchanged.

---

## 3. Real-Time Delivery

### Socket.io Gateway
- Users join a room named by their userId on connect
- Notifications emitted to `user:${userId}` room
- CORS fixed: removed dead `http://localhost:3001` entry

### Reconnect Behavior
Socket.io client handles reconnect automatically with exponential backoff. On reconnect, the frontend should call `queryClient.invalidateQueries(['notifications'])` to catch any missed notifications.

**Gap (P2)**: The frontend reconnect handler does not invalidate the notifications query on reconnect. If a notification arrives while the socket was disconnected, the bell count will be stale until the next page load.

**Recommended fix (P2):**
```typescript
socket.on('reconnect', () => {
  queryClient.invalidateQueries({ queryKey: ['notifications'] });
});
```

---

## 4. Notification Persistence

All notifications are persisted to the `notifications` table before the socket emit. This means:
- Notifications survive WebSocket disconnections
- They appear in the notifications panel even if the real-time push was missed
- `unread-count` endpoint accurately reflects all unseen notifications

---

## 5. Notification Types Coverage

| Event | Notification Created |
|-------|---------------------|
| Ticket assigned to user | ✅ |
| Ticket status changed | ✅ |
| Ticket comment added | ✅ |
| Leave approved | ✅ |
| Leave rejected | ✅ |
| Ticket approaching SLA | ⚠️ Not implemented — P2 |

---

## 6. Unread Count Accuracy

`GET /notifications/unread-count` returns count of notifications where `isRead = false` and `userId = currentUser.id`. This is an indexed query and fast.

The frontend dashboard polls or is push-notified to update the bell badge count.

---

## 7. Rate Limiting on Notification Endpoints

With global ThrottlerGuard now applied (P1-C), notification endpoints are rate-limited at 100 req/60s per IP. This prevents notification spam polling.

---

## Summary
| Check | Result |
|-------|--------|
| ParseUUIDPipe on id params | ✅ (P1-C) |
| Ownership check on delete | ✅ |
| Persistence before socket emit | ✅ |
| WS CORS fixed | ✅ |
| Rate limiting applied | ✅ |
| Reconnect query invalidation | ⚠️ P2 |
| SLA approaching notification | ⚠️ P2 |
