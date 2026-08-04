# Apex OS Dashboard Command Center Recovery Fix Report

This report details the diagnostics and fixes implemented to transform the Apex OS Dashboard into a real-time operational command center.

## 1. Summary of Issues Identified
* **Telemtry Hover Previews Empty**: The `CommandCard` components expected lists of items in their `previewItems` parameter to display hover details, but the backend summary API returned nothing.
* **Employee Card Redundancy**: Employees were shown duplicate cards for "In Review" because the dashboard was unable to display "Overdue Tickets" due to missing calculations in the backend for the employee role.
* **Misleading Bottlenecks**: The bottlenecks panel relied on client-side filtering of `overview.myTickets` which was hard-capped to `take: 5` general tickets. When these 5 tickets were done, the bottleneck list showed "No critical bottlenecks" despite active overdue tickets existing.
* **Broken Drilldowns**: Drilldowns for Leave, Active Staff, and Active Projects pointed to static pages, but the target pages completely ignored the URL parameters (`tab=needs-action`, `tab=live-status`, `status=ACTIVE`).

---

## 2. Technical Implementation Details

### A. Backend Metrics Expansion & Telemetry Previews
* **[dashboard.service.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/modules/platform/dashboard/dashboard.service.ts)**:
  * Calculated `overdue` counts for the `EMPLOYEE`/`INTERN` role within `getMetrics`.
  * Implemented a private `getPreviews(user)` helper that fetches up to 5 matching items for each category and formats them cleanly (e.g. `[TICKET-ID]: [TITLE]` or `[EMPLOYEE]: [LEAVE_TYPE] ([DUR]d)`).
  * Exposed `previews` inside the return payload of `getSummary`.
  * Modified `getOverview` to query and filter active tickets for overdue or in-review status directly in the database, returning them as `bottleneckTickets` (ensuring no client-side truncation issues).

### B. Frontend Dashboard Layout Hardening
* **[page.tsx (dashboard)](file:///c:/Users/Administrator/Desktop/nexus-app/frontend/app/(dashboard)/(core)/dashboard/page.tsx)**:
  * Configured Card 1 to show "Overdue Tickets" for all users (using `metrics.overdue`), mapping to `overdue=true`.
  * Bound the live telemetry lists (`overdueTickets`, `activeProjects`, `pendingLeave`, `inReviewTickets`) directly to their respective card's `previewItems` parameter.
  * Added dynamic card summaries (e.g., displaying "No overdue tickets in your scope" or "No pending leave requests" when count is `0`).
  * Bound the bottlenecks list directly to `overview.bottleneckTickets` and removed the redundant client-side filter logic.

### C. Sub-Pages Query Parameter Hydration
* **[leave/page.tsx](file:///c:/Users/Administrator/Desktop/nexus-app/frontend/app/(dashboard)/(operations)/leave/page.tsx)**: Imported `useSearchParams` and added a `useEffect` hook to set the active tab state (`tab`) to `pending` (Needs Action) when the `tab` parameter equals `needs-action`.
* **[team/page.tsx](file:///c:/Users/Administrator/Desktop/nexus-app/frontend/app/(dashboard)/(operations)/team/page.tsx)**: Imported `useSearchParams` and added a `useEffect` hook to select the `live` tab when `tab` equals `live-status`.
* **[projects/page.tsx](file:///c:/Users/Administrator/Desktop/nexus-app/frontend/app/(dashboard)/(operations)/projects/page.tsx)**: Imported `useSearchParams` and added a `useMemo` filter block to restrict the listed projects to `ACTIVE` status when `status=ACTIVE` is provided in the URL query string.
