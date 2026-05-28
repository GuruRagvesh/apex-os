# Deployed Runtime Fix Plan

## 1. Backend Infrastructure (Render)
**Issue:** The deployed database schema is drastically out of sync with the Prisma models, causing 500 Server Errors for critical endpoints (Notifications, Workday, Dashboard SLA, etc.).
**Fix:**
- Modify `render.yaml` inside the `backend` directory.
- Update the `startCommand` from `node dist/main.js` to `npx prisma migrate deploy && node dist/main.js`.
- *Wait for Render to redeploy.* This will automatically apply all pending migrations and create the missing `notifications` table, `isBlocked` column, etc.

## 2. Frontend Infrastructure (Vercel)
**Issue:** Vercel is serving an older commit bundle that contains raw `fetch` calls pointing to root paths (e.g., `/events`), which fail the backend's `/api` prefix enforcement.
**Fix:**
- Push the latest stable branch (`stabilize/apex-os-core`) to the origin repository.
- Trigger a fresh Vercel deployment.
- This will deploy the recent "API Client Cleanup" where raw fetches were replaced with `eventsApi.getAll()`, effectively routing all traffic properly through `/api/*`.

## 3. WebSocket Graceful Degradation
**Issue:** `useSocket.ts` logs an error on every reconnect attempt, spamming the console on Render where WebSocket routing might be constrained or missing.
**Fix:**
- Modify `useSocket.ts` to only log socket `connect_error` traces on a `"debug"` level instead of `warn`, preventing UX console clutter. 
- Rely on the `polling` transport fallback which is already properly configured.

## Execution Order
1. Apply the `render.yaml` update to fix DB deployment pipelines.
2. Apply the `useSocket.ts` debug downgrade.
3. Commit and push these fixes to `stabilize/apex-os-core`.
4. The deployment platforms (Render & Vercel) will auto-sync with the latest commit, resolving the 404 and 500 errors simultaneously.
