# FP-12 — RECURRING TICKET SCHEDULER FIX REPORT
**Date:** 2026-06-01 | Commit: `9b9e0af`

---

## AUDIT FINDINGS

### 1. Type of `scheduleRecurring` in Prisma schema

```prisma
// schema.prisma line 209
scheduleRecurring String?
```

`String?` — nullable string. Stored value is either `null` (never set) or one of the known recurrence tokens: `'daily_morning'`, `'daily_evening'`, `'weekly'`, `'monthly'`, `'1_month'`, `'6_months'`, or the sentinel `'none'`.

---

### 2. Why the original query failed

**File:** `backend/src/modules/platform/scheduler/scheduler.service.ts:81`

```typescript
// BEFORE (broken)
scheduleRecurring: { notIn: [null as any, 'none'] },
```

Prisma's `StringFilter.notIn` accepts `ListStringFieldRefInput | null` — meaning either an array of **strings**, or `null` (to skip the filter entirely). It does **not** accept `null` as an element inside the array.

The `as any` cast bypasses TypeScript's type checker but Prisma's runtime query validator still rejects it, throwing:

```
Argument `notIn`: Invalid value provided.
Expected ListStringFieldRefInput or Null, provided (Null, String).
```

This error causes `checkScheduledTickets()` to throw on every cron execution (hourly), so **no recurring ticket reminders ever fire in production**.

---

### 3. The fix — Prisma-safe equivalent

```typescript
// AFTER (fixed)
AND: [
  { scheduleRecurring: { not: null } },
  { scheduleRecurring: { not: 'none' } },
],
```

Prisma's `StringNullableFilter.not` correctly handles:
- `{ not: null }` → excludes rows where `scheduleRecurring IS NULL`
- `{ not: 'none' }` → excludes rows where `scheduleRecurring = 'none'`

Multiple `AND` conditions on the same nullable field produce the correct SQL:

```sql
WHERE "scheduleRecurring" IS NOT NULL
  AND "scheduleRecurring" != 'none'
```

---

### 4. Are both `null` and `'none'` valid stored states?

**Yes.** Both represent "no recurrence":

| Value | Meaning | When stored |
|---|---|---|
| `null` | Field never set | Ticket created without a recurring schedule |
| `'none'` | Explicitly set to no-recurrence | Form reset or explicit "no recurrence" selection |

Both must be excluded from the recurring reminder query. The fix correctly handles both.

---

### 5. Does existing data need cleanup?

**No.** The fix is query-only. Existing rows with `scheduleRecurring = null` or `scheduleRecurring = 'none'` are correctly ignored by the new `AND` filter. No migration, no data rewrite, no schema change required.

---

## FILES CHANGED

| File | Change |
|---|---|
| `backend/src/modules/platform/scheduler/scheduler.service.ts` | Line 81: replaced `{ notIn: [null as any, 'none'] }` with `AND: [{ not: null }, { not: 'none' }]` |
| `backend/test/unit/scheduler.recurring.spec.ts` | New file — 8 unit tests |

---

## EXACT DIFF

```diff
-          scheduleRecurring: { notIn: [null as any, 'none'] },
+          AND: [
+            { scheduleRecurring: { not: null } },
+            { scheduleRecurring: { not: 'none' } },
+          ],
```

---

## COMPLETE FIXED QUERY

```typescript
const recurringTickets = await this.prisma.ticket.findMany({
  where: {
    status: { notIn: ['DONE', 'CLOSED'] },
    AND: [
      { scheduleRecurring: { not: null } },
      { scheduleRecurring: { not: 'none' } },
    ],
    OR: [
      { scheduleEndDate: null },
      { scheduleEndDate: { gte: now } },
    ],
  },
  include: {
    assignedTo: { select: { id: true, name: true } },
    assignees: { include: { user: { select: { id: true, name: true } } } },
  },
});
```

This finds all tickets where:
- Status is not DONE or CLOSED
- `scheduleRecurring` is set AND is not the `'none'` sentinel
- No end date, or end date is today or in the future
