# Phase X - Core Operational Trust Remaining Gaps

While all core operational trust fixes have been successfully implemented and tested, this document logs minor remaining gaps and potential future enhancements for Apex OS.

---

## 1. Live Active Workday Minutes Real-Time Refresh
- **Gap**: Live active workday and break minutes calculate accurately on the backend upon queries (like loading `/team` or `/home/summary`). However, on the frontend UI, the counts do not tick up second-by-second in real-time unless the user manually refreshes the page or the periodic TanStack query refetch triggers (configured at 30/60s).
- **Impact**: Low. The database state remains the source of truth, and updates occur within a maximum of 30-60 seconds or on any navigation.
- **Remediation**: A client-side React interval timer could be added to locally increment the work/break minutes every minute.

## 2. Activity Feed Search Filtering
- **Gap**: The Activity Log page now supports date range filters and action categories, but lacks free-text filtering (e.g., searching for a specific ticket ID or details in the client UI).
- **Impact**: Medium. Large teams with high log volumes will need to rely on date filters and action filters to locate historical logs.
- **Remediation**: Update the backend `/events` endpoint to accept a `search` query parameter matching against event metadata.

## 3. Context-Scoping for Super Admin Modes
- **Gap**: When a `SUPER_ADMIN` switches mode to `team_lead` in the frontend UI, the backend still treats them as an administrator (inheriting global view privileges) rather than applying strict department scopes on metrics.
- **Impact**: Low. This is expected behavior as Super Admins require full system visibility.
- **Remediation**: Add a mode header or query parameter to restrict access checks when performing simulated role actions.
