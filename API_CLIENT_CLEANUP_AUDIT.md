# API Client Cleanup Audit

## 1. frontend/lib/api.ts
- **Endpoint**: `/users/${id}/documents`
- **Auth handling**: Manual local storage retrieval and header injection.
- **Response unwrap**: Manual `res.ok` check and `res.json()`.
- **Error handling**: Throws standard Error on failure.
- **API Wrapper Exists**: No, it's inside `usersApi.uploadDocument`.
- **Risk**: Low.
- **Recommended Action**: Refactor to use `api.post` and `FormData` like `uploadPhoto`. Keep Blob/download endpoints (`fetchAttachmentBlob`, `exportCsv`) as raw fetches since Blob downloads are simpler with raw fetch.

## 2. frontend/components/home/RecentActivityFeed.tsx
- **Endpoint**: `/events?limit=15`
- **Auth handling**: Manual local storage token retrieval.
- **Response unwrap**: `!res.ok` returns empty array, else `res.json()`.
- **Error handling**: Silently returns `[]` on error.
- **API Wrapper Exists**: No.
- **Risk**: Low.
- **Recommended Action**: Add `eventsApi.getAll(params)` to `lib/api.ts` and use it. Handle errors gracefully inside `react-query`.

## 3. frontend/app/(dashboard)/calendar/page.tsx
- **Endpoint**: `/tickets?limit=200` and `/leave?status=APPROVED&limit=100` via `apiFetch`.
- **Auth handling**: Manual token extraction.
- **Response unwrap**: Manual `res.ok` check returning `null`, then `res.json()`.
- **Error handling**: Throws error if leave data fails, ticket silently handled via optional chaining.
- **API Wrapper Exists**: Yes (`ticketsApi.getAll`, `leaveApi.getAll`).
- **Risk**: Low.
- **Recommended Action**: Remove `apiFetch`. Replace with `ticketsApi.getAll({ limit: 200 })` and `leaveApi.getAll({ status: 'APPROVED', limit: 100 })`.

## 4. frontend/app/(dashboard)/admin/activity/page.tsx
- **Endpoint**: `/events?{params}`
- **Auth handling**: Manual local storage token retrieval.
- **Response unwrap**: `!res.ok` returns `[]`, else `res.json()`.
- **Error handling**: Silently returns `[]` on error.
- **API Wrapper Exists**: No.
- **Risk**: Low.
- **Recommended Action**: Use the newly created `eventsApi.getAll(params)` from `lib/api.ts`.

## 5. frontend/app/(dashboard)/(core)/dashboard/page.tsx
- **Endpoint**: `/home/summary`
- **Auth handling**: Manual local storage token retrieval.
- **Response unwrap**: Manual `!res.ok` check throwing Error, else `res.json()`.
- **Error handling**: Throws error which `react-query` catches.
- **API Wrapper Exists**: No.
- **Risk**: Low.
- **Recommended Action**: Add `dashboardApi.getHomeSummary()` to `lib/api.ts` and replace the raw fetch.
