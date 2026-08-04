# FP-13.4A — ANALYTICS DASHBOARD UI — AUDIT
**Date:** 2026-06-02 | Commit: `a1ee8ab`

---

## PHASE 1 AUDIT FINDINGS

### 1. Does an Analytics page already exist?
**YES.** `frontend/app/(dashboard)/analytics/page.tsx` existed (313 lines).
It used only `dashboardApi` (ticket trend, by-category, overview, workload) — the OLD dashboard endpoints, NOT the new ledger analytics endpoints.

### 2. Does it use real API data or mock data?
**Real API data** — via dashboardApi. The new analytics endpoints were not called at all.

### 3. Which frontend API client pattern?
- **axios** `api` instance with `r()` promise helper (strips `.data`, handles 401 redirect)
- **@tanstack/react-query** `useQuery` hooks with lazy `enabled` flags
- All auth via `Authorization: Bearer <apex_token>` from localStorage

### 4. Exact analytics endpoint URLs (confirmed from controller)

| Method | URL | Role Gate |
|---|---|---|
| GET | `/analytics/employee/:id?` | Any authenticated (others restricted to manager+) |
| GET | `/analytics/reviewer/:id?` | Any authenticated (others restricted to manager+) |
| GET | `/analytics/manager` | MANAGER / ADMIN / SUPER_ADMIN only (403 for others) |
| GET | `/analytics/sla` | Any authenticated (scoped to ticket access) |
| GET | `/analytics/rework` | Any authenticated (scoped to ticket access) |
| GET | `/analytics/command-center?period=today\|week\|month` | Any authenticated (scoped) |

### 5. What role should see which analytics?
| Section | EMPLOYEE/INTERN | TEAM_LEAD | MANAGER | ADMIN/SUPER_ADMIN |
|---|---|---|---|---|
| Command Center | Own scope | Own scope | Dept scope | All |
| Employee Metrics | Own only | Own only | Any in dept | Any |
| Reviewer Metrics | Own only | Own only | Any in dept | Any |
| Manager Metrics | ❌ 403 | ❌ 403 | Dept scope | All |
| SLA | Own scope | Own scope | Dept scope | All |
| Rework | Own scope | Own scope | Dept scope | All |

### 6. Is current user role available in frontend state?
**YES.** `useAuthStore()` → `user.role.name` as a string.

### 7. React Query or direct API calls?
**React Query** — `useQuery` with per-tab `enabled` flags for lazy loading.

### 8. Loading/error states that already existed?
- `Skeleton` component from `@/components/ui/skeleton`
- `ShieldAlert` for access denial
- CSS: `apex-card`, `apex-btn`, `apex-empty`, `apex-progress-track`
- CSS variables: `--text-primary/secondary/tertiary`, `--accent`, `--color-success/danger`

### 9. Which components can be reused?
- `Skeleton` ✅ used
- `TicketTrendChart`, `CategoryChart` ✅ preserved in Overview tab
- Lucide icons ✅ used
- All `apex-*` CSS classes ✅ used
- `LegacyStatCard` (inline) ✅ adapted from existing component

### 10. Safest minimal implementation?
Replace the analytics page with a 7-tab layout. Keep existing Overview content intact (no regression). Add 6 new tabs backed by `analyticsApi`. Each section loads independently — one failure does not break others.

---

## Backend Response Shapes (confirmed from analytics.service.ts)

### Command Center
```json
{ "period": "today", "activeWork": 5, "activeReviews": 3, "blockedTickets": 1, "pendingApprovals": 2 }
```

### Employee Metrics
```json
{ "ticketsCompleted": 8, "ticketsUnderReview": 2, "ticketsReworked": 1,
  "averageCompletionTimeSeconds": 7200, "productiveHours": 24.5,
  "reviewAcceptancePercent": 75, "reworkPercent": 25 }
```

### Reviewer Metrics
```json
{ "reviewsCompleted": 12, "averageReviewTimeSeconds": 3600, "approvalPercent": 67,
  "rejectionPercent": 33, "reviewBacklog": 4, "slaBreaches": 1 }
```

### Manager Metrics
```json
{ "departmentThroughput": 20, "ticketsCompleted": 20, "overdueTickets": 3,
  "blockedTickets": 1, "averageTurnaroundTime": 0, "employeeRankings": [], "reviewerRankings": [] }
```
Note: `averageTurnaroundTime: 0` and both rankings `[]` are backend placeholders.

### SLA Analytics
```json
{ "onTimePercent": 72, "overduePercent": 28, "slaBreaches": 7, "averageDelaySeconds": 1800 }
```

### Rework Analytics
```json
{ "reworkCount": 5, "reworkRate": 15, "mostReworkedEmployees": [],
  "mostReworkedTicketTypes": [], "reviewQualityIndicators": {} }
```
Note: Employee/type lists and quality indicators are backend placeholders returning `[]` / `{}`.
