# Analytics & Reporting Completion Report

**Date:** 2026-05-27  
**Sprint:** P1-B  
**Status:** COMPLETE

---

## 1. Export Filter Fix (Analytics Page)

**Gap:** `handleExport` in `analytics/page.tsx` called `ticketsApi.exportCsv()` with no arguments, producing an unfiltered export regardless of the selected date range.

**Fix:** `frontend/app/(dashboard)/analytics/page.tsx`
```typescript
const handleExport = () => {
  const dateTo = new Date();
  const dateFrom = new Date(dateTo);
  dateFrom.setDate(dateFrom.getDate() - days);
  ticketsApi.exportCsv({
    dateFrom: dateFrom.toISOString().split('T')[0],
    dateTo: dateTo.toISOString().split('T')[0],
  });
};
```
Now the export respects the selected range toggle (7d / 30d / 90d).

---

## 2. Export Filter Fix (Tickets Page)

**Pre-existing (P1-A):** `tickets/page.tsx` already passed `{ ...filters, search }` to `exportCsv`. No change needed for category/priority/status/department filters.  
**P1-B addition:** Also passes `extraFilters` (overdueOnly → `dueBefore`, myTickets → `assignedToId`) so the export matches the current filtered view exactly.

---

## 3. Export Audit Trail

**Gap:** No operational event was logged when exports were performed.  
**Fix:** `GET /tickets/export` in `tickets.controller.ts` now logs `EXPORT_PERFORMED` after the CSV is generated:
```typescript
this.eventLogger.log({
  actorId: user.id,
  entityType: 'Ticket',
  entityId: 'export',
  action: OperationalAction.EXPORT_PERFORMED,
  metadata: { format: 'csv', filters: query },
}).catch(() => {});
```

---

## 4. getSlaRisk API Endpoint

Added `ticketsApi.getSlaRisk()` to `frontend/lib/api.ts` → `GET /tickets/sla-risk`. This exposes the risk categorisation endpoint for dashboards or widgets that need to surface SLA health.

---

## Backend Export Scoping (Pre-existing)

`TicketsService.exportCsv()` already delegates to `TicketAccessService.buildTicketWhereForUser()` — all exported data is scoped to the requesting user's access policy. No bypass is possible.

---

## Verification

- `npx tsc --noEmit`: ✅ 0 errors
- `npx jest test/unit --forceExit`: ✅ 56/56 tests passed
