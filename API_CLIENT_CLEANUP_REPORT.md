# API Client Cleanup Report

## Summary of Changes

We have successfully migrated the fragile raw `fetch()` calls in the frontend codebase to use centralized API wrappers, improving consistency, error handling, and authorization header management. 

### 1. `frontend/lib/api.ts`
- **Updated `usersApi.uploadDocument`**: Converted to use the `axios` instance (`api.post`) with `FormData` to handle file uploads properly, bringing it in line with `usersApi.uploadPhoto`.
- **Added `eventsApi`**: Introduced `eventsApi.getAll(params)` to handle fetching the activity feed events.
- **Added `dashboardApi.getHomeSummary()`**: Created a dedicated endpoint wrapper for `/home/summary`.
- **Preserved `fetchAttachmentBlob` and `exportCsv`**: Left as raw `fetch` calls since they rely on extracting blob objects for direct file download, which is simpler and less fragile with raw `fetch` handling.

### 2. `frontend/components/home/RecentActivityFeed.tsx`
- **Previous**: Raw fetch to `/events?limit=15` with manual `localStorage` token parsing.
- **New**: `eventsApi.getAll({ limit: 15 })`
- **Benefit**: Reuses central axios interceptor for auth injection and error mapping (401 triggers logout, etc.).

### 3. `frontend/app/(dashboard)/calendar/page.tsx`
- **Previous**: Custom `apiFetch` helper wrapping raw `fetch` to get `/tickets` and `/leave` data.
- **New**: Removed `apiFetch` completely. Imported and used `ticketsApi.getAll({ limit: 200 })` and `leaveApi.getAll({ status: 'APPROVED', limit: 100 })`.
- **Benefit**: Typesafe data returning, centralized token interceptor, and standard error handling.

### 4. `frontend/app/(dashboard)/admin/activity/page.tsx`
- **Previous**: Raw fetch to `/events?{params}` wrapping manual parameter serialization string via `URLSearchParams`.
- **New**: Converted `buildParams()` to return a structured parameter object rather than a URL string, and passed it to `eventsApi.getAll(params)`.
- **Benefit**: Robust parameter serialization through Axios and centralized token handling.

### 5. `frontend/app/(dashboard)/(core)/dashboard/page.tsx`
- **Previous**: Raw fetch to `/home/summary`.
- **New**: Used `dashboardApi.getHomeSummary()`.
- **Benefit**: Removes another location of manual `localStorage.getItem('apex_token')` execution on every load.

## Verification
- Dashboard compiles and works with React Query using the axios wrappers.
- Calendar data queries use the existing `ticketsApi` and `leaveApi` calls.
- Recent Activity Feed uses `eventsApi`.
- Authentication handling works implicitly via `api.interceptors.request.use` inside `lib/api.ts`.
- Frontend build passes validation.

**Status:** API CLIENT CLEANUP COMPLETE
