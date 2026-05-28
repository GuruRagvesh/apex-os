# UX STABILITY REPORT
**Phase:** P1-C Enterprise Hardening  
**Date:** 2026-05-27  
**Status:** ✅ COMPLETE

---

## 1. Loading States

All data-fetching pages use TanStack Query `isLoading` to show a spinner before content renders. Audited pages:

| Page | Loading Spinner | Notes |
|------|----------------|-------|
| `/dashboard` | ✅ | Per-widget skeleton / spinner |
| `/tickets` | ✅ | Full-page centered spinner |
| `/tickets/[id]` | ✅ | Ticket detail spinner |
| `/projects` | ✅ | Grid skeleton |
| `/projects/[id]` | ✅ | Detail spinner |
| `/leave` | ✅ | List spinner |
| `/users` | ✅ | Table skeleton |
| `/analytics` | ✅ | Chart area spinner |
| `/notifications` | ✅ (via dropdown) | Bell icon panel |

---

## 2. Error States

### Before P1-C
`projects/page.tsx` and `leave/page.tsx` only checked `isLoading`. If the API returned an error, the page would silently show an empty state — no indication of failure.

### After P1-C — Error UI Added

**`projects/page.tsx`:**
```tsx
} : isError ? (
  <div className="flex flex-col items-center justify-center h-64 gap-3 apex-card">
    <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Failed to load projects.</p>
    <button onClick={() => refetch()} className="apex-btn apex-btn-secondary text-xs">Retry</button>
  </div>
```

**`leave/page.tsx`:**
```tsx
} : isError ? (
  <div className="flex flex-col items-center justify-center h-40 gap-3">
    <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Failed to load leave requests.</p>
    <button onClick={() => refetch()} className="apex-btn apex-btn-secondary text-xs">Retry</button>
  </div>
```

### Error State Coverage After P1-C
| Page | Error State | Retry Button |
|------|------------|-------------|
| `/dashboard` | ✅ (per widget) | ✅ |
| `/tickets` | ✅ | ✅ |
| `/tickets/[id]` | ✅ | ✅ |
| `/projects` | ✅ (added P1-C) | ✅ |
| `/projects/[id]` | ✅ | ✅ |
| `/leave` | ✅ (added P1-C) | ✅ |
| `/users` | ✅ | ✅ |
| `/analytics` | ✅ | ✅ |

---

## 3. Empty States

All empty states use the shared `EmptyState` component (`/components/ui/empty-state`) with:
- Icon (emoji)
- Title
- Description
- Optional action button (role-gated)

### Empty State Audit
| Page | Empty State | Action CTA |
|------|------------|-----------|
| `/projects` | ✅ "No projects yet" | "New Project" (managers only) |
| `/leave` | ✅ "No leave requests yet" | "Apply Leave" |
| `/tickets` | ✅ "No tickets yet" | "New Ticket" |
| `/users` | ✅ "No users found" | — |
| `/projects/[id]/tickets tab` | ✅ "No tickets in this project" | — |

---

## 4. Regression Fix — `doneTickets` Variable

**File:** `frontend/app/(dashboard)/(operations)/projects/[id]/page.tsx`  
**Issue:** P1-B removed the `doneTickets` variable but left a JSX reference, causing a TypeScript compile error and runtime blank render.  
**Fix (P1-C):**
```tsx
// Before (broken):
{doneTickets} of {project.tickets?.length || 0} tickets resolved

// After:
{project.ticketStats?.done
  ?? project.tickets?.filter((t: any) => t.status === 'DONE' || t.status === 'CLOSED').length
  ?? 0} of {project.ticketStats?.total ?? project.tickets?.length ?? 0} tickets resolved
```
This uses backend-computed `ticketStats` when available, falling back to client-side filter.

---

## 5. SLA Risk Dashboard Widget

For users with `TEAM_LEAD` or above role, the dashboard now surfaces live SLA risk data:
- **Overdue** tickets (exceeded SLA window)
- **Due soon** tickets (within 4 hours)
- **Review ageing** tickets (waiting in review too long)

The widget:
- Only renders when there are actionable items (no noise for healthy systems)
- Auto-refreshes every 2 minutes
- Links to `/tickets` for immediate action
- Uses backend-computed `getSlaRiskCategories()` — no frontend business logic

---

## 6. Toast Notifications

All mutation operations (create, update, approve, reject, cancel) use `react-hot-toast` for feedback:
- ✅ Success toasts on all mutations
- ✅ Error toasts with appropriate messages
- Error messages propagate backend error where available: `err?.message || 'default message'`

---

## Summary
| Check | Result |
|-------|--------|
| Loading states on all data pages | ✅ |
| Error states with retry | ✅ (added projects + leave) |
| Empty states with CTAs | ✅ |
| doneTickets regression fixed | ✅ |
| SLA risk widget for managers | ✅ |
| Toast feedback on mutations | ✅ |
