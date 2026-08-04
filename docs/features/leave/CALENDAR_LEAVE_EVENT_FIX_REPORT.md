# Calendar Leave Event Fix Report

Date: 2026-05-28
Status: COMPLETE

## Issue

The Calendar page requested approved leave data from:

```txt
GET /leave?status=APPROVED&limit=100
```

The backend response shape is:

```ts
{ items, total, page, limit, totalPages }
```

But the Calendar frontend was reading:

```ts
leaveData.leaves
```

That made approved leave events disappear silently.

## Files Checked

- `frontend/app/(dashboard)/calendar/page.tsx`
- `frontend/lib/api.ts`
- `backend/src/modules/operations/leave/leave.controller.ts`
- `backend/src/modules/operations/leave/leave.service.ts`

Backend confirmation:

- `LeaveController.findAll` delegates to `LeaveService.findAll`.
- `LeaveService.findAll` returns `{ items, total, page, limit, totalPages }`.
- No backend change was required.

## Fix Applied

Updated Calendar leave event mapping to use:

```ts
const approvedLeaves: any[] = leaveData?.items ?? [];
```

Also added leave-query error handling so ticket calendar events can still render if approved leave loading fails.

## Behavior Confirmed

- Approved leave events now read from the correct `items` key.
- Leave event click target remains `/leave`.
- Ticket scheduled events still render from `scheduledStartAt`.
- Ticket due-date events still render from `dueDate`.
- No fake leave/calendar events were added.
- No external calendar sync was added.
- Backend leave response shape was preserved.

## Verification

| Check | Result |
| --- | --- |
| Search confirms no remaining `leaveData.leaves` usage in Calendar | PASS |
| Frontend production build | PASS |
| Backend touched | No |
| Backend tests required | No |
| Local approved leave record available for live visual check | No existing approved leave found |

Build command:

```txt
npm.cmd run build
```

Result: PASS.

## Notes

The local database currently has no `APPROVED` leave request, so I did not create or alter HR data for this small frontend bug fix. The rendering code now consumes the backend's actual `items` response key, so approved leave records returned by the API will be converted into Calendar events.
