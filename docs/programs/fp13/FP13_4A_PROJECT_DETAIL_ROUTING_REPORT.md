# FP-13.4A Project Detail Routing Recovery Report

## Root Cause Analysis
The "project could not be located" error occurred because the backend `ProjectsController` strictly enforced UUID format checking (`ParseUUIDPipe`) on the `:id` parameter for the `/projects/:id` endpoint. However, Prisma generates `CUID`s (which are standard strings, not UUIDs) and the `projects.service.ts` also intelligently supports fetching by standard string formats like `PRJ-XXX` via an OR clause. 

Because `ParseUUIDPipe` blocked any non-UUID string, the frontend's valid CUID request instantly triggered a 400 Bad Request error at the controller layer. The frontend masked this API error with a generic fallback component ("This project could not be located") rather than showing the real API rejection text.

## Resolution Details
### Backend Updates (`projects.controller.ts`)
- Removed `ParseUUIDPipe` from `@Param('id')` decorators for the following routes:
  - `GET /projects/:id` (`findOne`)
  - `PUT /projects/:id` (`update`)
  - `POST /projects/:id/members` (`addMember`)
  - `DELETE /projects/:id/members/:userId` (`removeMember`)
  - `DELETE /projects/:id` (`remove`)
- **Backend Route Behavior:** The routing now accepts standard strings (like CUIDs and `PRJ-XXX` codes). The controller delegates format lookup and security checks down to the `ProjectsService`, which has existing robust validation utilizing `findFirst` with `{ OR: [{ id }, { projectId: id }] }` and handles `NotFoundException` securely.

### Frontend Updates (`projects/[id]/page.tsx`)
- The `useQuery` error state (`isError` and `error`) was extracted.
- Replaced the generic fallback with an explicit error handler to show real API error messages (e.g. `An error occurred loading this project` or HTTP 403 Forbidden details).
- The route relies correctly on `project.id` (CUID), preserving precise referencing from list to detail cards.

### Testing and Scope Maintenance
- **Role Scoping Maintained:** Project visibility and update permissions were untouched. Service-layer authorization safely handles scoping queries.
- No other logic changes were introduced.

### Modules Touched
No unintended modules (like Timer Ledger, Email, Analytics, etc.) were altered. This was strictly a Projects controller & frontend route integration fix.
