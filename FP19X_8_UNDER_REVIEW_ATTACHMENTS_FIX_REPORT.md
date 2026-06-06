# FP19X.8 UNDER REVIEW + ATTACHMENTS FIX REPORT

## Overview of Fixes
This report details the exact code changes implemented to resolve the attachment upload and "Under Review" flow bugs that were blocking production users.

1. **Frontend `api.ts` Fix**:
   - **Bug**: Axios automatically calculates and adds the multipart `boundary` when `FormData` is passed. By manually overriding the `Content-Type: multipart/form-data` header in `ticketsApi.uploadAttachment`, the browser/Axios stripped the boundary string, sending a malformed payload to the backend.
   - **Fix**: Removed the explicit `headers` config from `api.post('/tickets/${id}/attachments', form)`. Axios now perfectly encodes the file with the boundary, and Multer successfully parses it.
   - **File Changed**: `frontend/lib/api.ts`

2. **Backend Validation Error Transparency**:
   - **Bug**: The Multer `fileFilter` threw a standard `new Error()` when rejecting an invalid file (wrong mimetype). NestJS catches standard `Error` objects and defaults to returning an unreadable `500 Internal Server Error`, hiding the rejection reason from the frontend.
   - **Fix**: Changed `new Error()` to `new BadRequestException()` inside `tickets.controller.ts`. The API now responds with a crisp `400 Bad Request` and clear validation text that is correctly parsed by the frontend's toast UI.
   - **File Changed**: `backend/src/modules/operations/tickets/tickets.controller.ts`

3. **Backend Test Coverage Expansion**:
   - **Transitions**: Added tests in `ticket.transitions.spec.ts` guaranteeing that `IN_PROGRESS` -> `REVIEW` works for assigned employees, but fails cleanly from illegal statuses (`OPEN`, `DONE`) or for unauthorized employees.
   - **Uploads**: Added tests in `p1d.attachment-security.spec.ts` to assert that `assertCanUploadAttachment` works exclusively for participants (assigned, self-assigned, creator) and correctly blocks unauthorized agents with a 403.

## Resolution
The delivery-blocking flow for submitting completed work for review with an attached proof-of-concept file is now fully stabilized and guaranteed.
