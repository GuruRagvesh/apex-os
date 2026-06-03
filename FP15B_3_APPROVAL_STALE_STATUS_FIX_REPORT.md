# FP-15B.3 APPROVAL STALE STATUS FIX REPORT

## 1. Overview
The issue described involved requests lingering in the `/admin/approvals` UI as "Pending Approvals" despite having been processed (`APPROVED` or `REJECTED`) previously. Trying to click "Approve" on these stale UI items caused a backend conflict, returning "Cannot approve request in status APPROVED". Additionally, legacy field keys like `primaryManager` were still surfaced in the UI instead of human-readable labels.

## 2. Backend Checks & Fixes
- **Endpoint Analzyed:** `listPendingApprovals` within `backend/src/modules/core/users/change-requests.service.ts`.
- **Query Structure:** The endpoint uses Prisma's `findMany` query with an explicit condition: `status: { in: ['PENDING_TL_APPROVAL', 'PENDING_MANAGER_APPROVAL', 'PENDING_ADMIN_APPROVAL'] }`. The backend was strictly filtering out `APPROVED`, `REJECTED`, and `CANCELLED` statuses correctly.
- **Unit Testing Addition:** Added a specific test block (`listPendingApprovals`) to `test/unit/users.change-requests.spec.ts` guaranteeing that only pending statuses are actively requested from the Prisma engine, excluding the terminal statuses.

## 3. Frontend Defensive Fixes
- **Stale Cache Handling:** The actual culprit was the frontend React Query caching and network delay, compounded by a lack of a defensive check on the current element's status if stale state bled through.
- **Defensive Rendering:** If the cache somehow resolves an `APPROVED` or `REJECTED` item in the list, the UI now defensively hides the "Approve/Reject" action buttons and displays a static badge ("Approved" or "Rejected") in their place.
- **Optimized Toast Messaging:** Replaced raw `alert` dialogues with polished `react-hot-toast` notifications. If the backend throws an error indicating the request is already approved/processed (handling concurrency/stale-cache exceptions cleanly), the user now receives a friendly toast ("This request has already been processed.") and the list refetches seamlessly without breaking the UI flow.
- **Button Debouncing & Disabling:** The Approve button dynamically leverages `approveMutation.isPending && approveMutation.variables === req.id` to lock execution and visibly indicate "Processing..." state, stopping double-clicks.

## 4. Legacy Field Display Mapping
- **UI Mapping Correction:** Updated the mapping array in `page.tsx`. `primaryManager` is mapped explicitly to `Department Manager` inside the UI presentation to handle backwards compatibility for existing legacy tickets smoothly without rendering raw system keys.
