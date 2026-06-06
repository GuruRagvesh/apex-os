# FP19X.8 UNDER REVIEW + ATTACHMENTS AUDIT

## Phase 2: Backend Permissions Audit
1. **Which endpoint submits ticket to REVIEW?**
   `PATCH /api/tickets/:id/status` handled in `tickets.controller.ts` calling `tickets.service.ts` -> `updateStatus`.
2. **Which endpoint uploads attachment?**
   `POST /api/tickets/:id/attachments` handled in `tickets.controller.ts`.
3. **Which guard checks attachment upload permission?**
   `tickets.controller.ts` explicitly calls `this.ticketsService.assertCanUploadAttachment(user, ticket)` which delegates to `ticketAccess.assertCanUploadAttachment`.
4. **Which guard checks submit-to-review permission?**
   `updateStatus` explicitly calls `this.ticketAccess.assertCanTransitionTicket(user, existing, data.status)`.
5. **Is the assigned employee allowed?**
   Yes, `assertCanUploadAttachment` passes for participants. `assertCanTransitionTicket` allows participants to transition `IN_PROGRESS -> REVIEW`.
6. **Is self-assigned employee allowed?**
   Yes, same as assigned employee logic.
7. **Are employees blocked by department/scope mismatch?**
   No, participants are explicitly short-circuited and allowed before scope restrictions are applied.
8. **Are attachments linked to ticketId correctly?**
   Yes, via `ticket.id` mapping in `uploadAttachment`.
9. **Are file size/mime restrictions causing silent failures?**
   **YES.** Multer's `fileFilter` throws a raw `new Error(...)`, which NestJS translates into a generic `500 Internal Server Error` instead of a clear `400 Bad Request`.
10. **Does backend return readable errors?**
    Not for mime restrictions due to the raw `Error`. Other permission errors throw standard 403 `ForbiddenException`s with clear messages.

## Phase 3: Frontend Button and Upload Flow
1. **Is the Under Review button condition correct?**
   Yes, it relies on the `REVIEW` step in `steps.map` and checks `canEdit` (which resolves to `true` for `isParticipant`).
2. **Does it require wrong status or wrong role?**
   No, it correctly requires `canEdit` and `isNext`.
3. **Does it accidentally hide for employees?**
   No, it correctly shows.
4. **Does it require attachments before review? If yes, is this intended?**
   Yes, clicking `REVIEW` intercepts the status call and triggers `setShowPocModal(true)`.
5. **Does file upload send FormData correctly?**
   Yes, it uses `FormData`.
6. **Does API client set multipart headers correctly?**
   **NO. ROOT CAUSE DETECTED.**
   In `frontend/lib/api.ts` line 164, `ticketsApi.uploadAttachment` sets `headers: { 'Content-Type': 'multipart/form-data' }`. By overriding this manually, Axios strips the dynamically generated `boundary=...` field. The backend cannot parse the multipart data, causing silent failures or `Multipart: Boundary not found` 500 errors.
7. **Does upload mutation show errors?**
   It uses `toast.error(e?.message)`, but due to the boundary error / 500 error, it was unreadable.
8. **Does submit-to-review mutation show errors?**
   Yes, `onError` toast is configured.
9. **Does page refetch ticket after upload?**
   Yes, `qc.invalidateQueries({ queryKey: ['ticket', id] });`
10. **Does page refetch ticket after status change?**
    Yes.
11. **Are buttons disabled only while pending, not permanently?**
    Yes, `disabled={!canClick}` uses `!updateStatus.isPending && !pocUploading`.

## Summary of Root Causes
1. **Frontend**: Axios configuration overrides the Content-Type header and strips the multipart boundary, completely breaking all attachment uploads from the frontend.
2. **Backend**: Multer's `fileFilter` uses a generic `Error` object rather than a `BadRequestException`, turning what should be a readable 400 validation error into a 500 crash.
