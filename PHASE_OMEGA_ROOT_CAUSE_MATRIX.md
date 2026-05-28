# Phase Ω - Root Cause Matrix

| Issue | Root Cause | Affected Files | Disconnect Type |
| --- | --- | --- | --- |
| **Directory Roster Request Reset** | Pending request states are stored only in React component state `requestedIds` and reset on refresh. | `frontend/app/(dashboard)/(operations)/team/page.tsx` | Local State Volatility |
| **Activity System Redundancy** | Comments, tickets, and user updates write duplicate entries to `activity_logs` and `operational_events`. | `backend/src/modules/operations/comments/comments.service.ts`, `backend/src/modules/operations/tickets/tickets.service.ts` | Model Duplication |
| **Hidden Leave Balance Banner** | Leave balance calculations exist in the backend (`LeaveBalanceService`), but are never queried or displayed to employees on the Leave request page. | `frontend/app/(dashboard)/(operations)/leave/page.tsx` | Hidden Context |
| **TL Workload Visibility Gap** | Team Leads are excluded from `/analytics` navigation in the sidebar, preventing them from auditing member workload charts. | `frontend/components/layout/sidebar.tsx` | Nav Gate Restriction |
| **No Standalone Workday History** | Workday events return `null` entity links because no separate workday logs history route exists in the frontend. | `backend/src/modules/platform/events/events.controller.ts` | Dead Navigation |
| **No Blocked Ticket Status** | Database `TicketStatus` enum does not have a `BLOCKED` status, although `TICKET_BLOCKED` events are recorded. | `backend/prisma/schema.prisma` | Schema Limitation |
