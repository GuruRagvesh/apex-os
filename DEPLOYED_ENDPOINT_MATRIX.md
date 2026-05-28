# Deployed Endpoint Matrix

| Feature | Frontend Call (Live) | Expected Backend Route | Actual Status | Root Cause | Fix |
|---|---|---|---|---|---|
| Health Check | `GET /health` | `GET /health` | 200 OK | N/A | N/A |
| Dashboard Overview | `GET /api/dashboard/overview` | `GET /api/dashboard/overview` | 500 / Timeout | DB Schema Mismatch | Run `prisma migrate deploy` on Render |
| SLA Risk | `GET /api/tickets/sla-risk` | `GET /api/tickets/sla-risk` | 500 / Timeout | DB Schema Mismatch (missing blocked fields) | Run `prisma migrate deploy` on Render |
| Workday Today | `GET /api/workday/today` | `GET /api/workday/today` | 500 / Timeout | DB Schema Mismatch | Run `prisma migrate deploy` on Render |
| Notifications | `GET /api/notifications` | `GET /api/notifications` | 500 Internal Error | `notifications` table missing in remote DB | Add `npx prisma migrate deploy` to `render.yaml` start command |
| Notifications Count | `GET /api/notifications/unread-count` | `GET /api/notifications/unread-count` | 500 Internal Error | `notifications` table missing in remote DB | Same as above |
| Home Summary | `GET /home/summary` | `GET /api/home/summary` | 404 Not Found | Vercel running old frontend commit with raw fetch bypassing `/api` prefix | Redeploy Vercel from latest commit (`stabilize/apex-os-core`) |
| Activity Events | `GET /events?limit=15` | `GET /api/events?limit=15` | 404 Not Found | Vercel running old frontend commit with raw fetch | Redeploy Vercel from latest commit |
| WebSockets | `wss://.../socket.io` | `wss://.../socket.io` | Connection Failed | Backend websocket adapter potentially not matching CORS or deployment env | Add `debug` downgrade for `useSocket` to stop console spam and rely on HTTP polling |
