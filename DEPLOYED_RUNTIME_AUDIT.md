# Deployed Runtime Audit

## 1. Deployment Version Check
**Observation:** Vercel frontend is running an older commit, before the "API Client Cleanup" (UX Fix 9) and "Blocked Ticket Workflow" changes were applied. Render backend is also running an older build that lacks recent database schema migrations.
**Evidence:** The frontend is making raw `fetch` calls to `/events` and `/home/summary` (which were refactored to use `api.ts` locally). 

## 2. API Base URL & Global Prefix
**Observation:** The backend correctly enforces the `app.setGlobalPrefix('api')` constraint, but the live Vercel frontend is missing the `/api` segment in multiple raw fetches.
**Evidence:** 
- `curl https://apex-os-3nyi.onrender.com/api/events` returns 401 (Route exists but requires auth).
- `curl https://apex-os-3nyi.onrender.com/events` returns 404 (Route not found).
- Live Vercel frontend throws 404s for `/events` because it is still using the older `fetch` code that bypasses the centralized `api.ts` interceptor.

## 3. The 500 Notifications Error & Timeouts
**Observation:** `GET /api/notifications` returns 500 Internal Server Error, and other endpoints like `/api/tickets/sla-risk` and `/api/dashboard/overview` timeout.
**Evidence & Root Cause:** 
The `backend/render.yaml` file defines the Start Command as:
`startCommand: node dist/main.js`
This completely skips the database migration step (`npx prisma migrate deploy`). Because of this, the deployed PostgreSQL database lacks the `notifications` table, the `isBlocked` column in the tickets table, and other recent schema changes. The backend code crashes with a Prisma schema mismatch when attempting to query these missing columns/tables.

## 4. WebSocket Disconnection Spam
**Observation:** The frontend attempts to establish a WebSocket connection and continuously logs `connect_error` in the browser console.
**Evidence:**
The `useSocket.ts` hook initiates connection to the root URL. If Render blocks WebSockets or routing fails, it spams warnings to the console on every retry or page load. The fallback HTTP polling works, but the Socket UI degrades gracefully.

## Conclusion
The application logic itself (both frontend and backend) is fundamentally sound as proved by local testing. The **"disconnected feeling"** is entirely an infrastructure orchestration issue:
1. Render backend is crashing because its database is desynced from the Prisma schema (due to missing `prisma migrate deploy` in `render.yaml`).
2. Vercel frontend is returning 404s on the Dashboard because it hasn't deployed the latest branch commit where raw fetches were replaced with `api.ts`.
