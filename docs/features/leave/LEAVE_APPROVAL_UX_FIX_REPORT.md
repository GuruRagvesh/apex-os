# Leave Approval Decision Support UX Report
**Phase:** UX Fix 7 — Leave Approval Decision Support
**Date:** 2026-05-28
**Status:** COMPLETE

---

## Objective

Make the Leave page useful for both employees applying leave and managers/TLs approving leave — using only existing, RBAC-scoped backend data. No backend changes.

---

## Audit Findings

### What was already working

| Feature | Location | Status |
|---------|----------|--------|
| Leave list with RBAC scope | Leave page — scoped via `LeaveAccessService` | ✅ |
| Approve / Reject mutations | `leaveApi.approve(id)` / `leaveApi.reject(id)` | ✅ |
| Leave stats (total/pending/approved/rejected) | Leave page stat cards | ✅ |
| Own balance fetch | `leaveApi.getBalance()` | ✅ |
| Per-user balance (expand) | `leaveApi.getBalance(userId)` on row expand | ✅ |
| Role-level approval guard | `checkApprovalAllowed()` — prevents self-approval, cross-dept, same/higher rank | ✅ |
| Tab: Needs Action / All / My Requests | Manager defaults to "Needs Action" | ✅ |
| Conflict/overlap detection | Client-side, within same dept, non-rejected/cancelled leaves | ✅ |
| `isHalfDay` / `halfDayType` in backend | `leave.service.ts` create() accepts these fields | ✅ |
| Balance validation server-side | `LeaveBalanceService.validateLeaveRequest()` enforces quota + overlap | ✅ |

### What was missing

| Feature | Gap |
|---------|-----|
| My balance shown prominently | Balance card showed raw numbers without visual hierarchy |
| Allocation / Used / Pending breakdown | Not visible before submitting |
| Low-balance warning | No visual alert when running low |
| Duration preview before submission | No indication of how many days a request would consume |
| Half-day leave option in form | Form sent full days only, despite backend supporting `isHalfDay` |
| Balance impact preview | No "X days remaining after approval" calculation |
| Approve/Reject affordance clarity | Buttons were icon-only, no label |
| Reject reason input | No field existed; backend doesn't store it either |
| Post-submission explanation | No text explaining what PENDING status means |
| Read-only reason displayed | `approvalState.reason` not surfaced to user |

---

## Fixes Applied

### FIX-1 — My Leave Balance Card Redesign
**File:** `frontend/app/(dashboard)/(operations)/leave/page.tsx`

**Before:** Small grid of numbers with no visual hierarchy.

**After:**
- Large prominent remaining days counter (red if ≤ 2, indigo otherwise)
- 3-column grid: Alloc / Used / Pend
- "Low balance" warning in red with AlertTriangle icon when ≤ 2 days remain
- Fetches `leaveApi.getBalance()` — uses `LeaveBalanceService.getLeaveBalance()` server-side (unchanged)

---

### FIX-2 — Apply Leave Modal: Balance Context Strip
**File:** `frontend/app/(dashboard)/(operations)/leave/page.tsx`

Added a balance context strip at the top of the Apply Leave modal:
- Shows remaining days (red if ≤ 2)
- Shows pending days if > 0
- Shows Allocation and Used totals inline
- Renders only when `myBalance` is loaded (no fake data)

---

### FIX-3 — Apply Leave Modal: Half-Day Support
**File:** `frontend/app/(dashboard)/(operations)/leave/page.tsx`

Added `isHalfDay` state (boolean) and `halfDayType` state (`'FIRST_HALF' | 'SECOND_HALF'`):
- Checkbox to enable half-day mode
- When checked: dropdown for First Half (Morning) / Second Half (Afternoon)
- `getLeaveDuration()` already accepted `isHalfDay` — returns 0.5 when true
- Mutation payload includes `isHalfDay` and `halfDayType: isHalfDay ? halfDayType : undefined`
- Cancel button resets both states

Backend `leave.service.ts` `create()` already stored and handled these fields — no backend change needed.

---

### FIX-4 — Apply Leave Modal: Duration Preview + Balance Impact
**File:** `frontend/app/(dashboard)/(operations)/leave/page.tsx`

Added computed vars:
```tsx
const formDuration = form.startDate && form.endDate
  ? getLeaveDuration(form.startDate, form.endDate, isHalfDay)
  : 0;
const exceedsBalance = myBalance != null && formDuration > 0 && formDuration > (myBalance.balance ?? 0);
```

Duration preview pill (shown when `formDuration > 0`):
- **Green:** "This request = N working days · X days remaining after"
- **Red:** "This request = N working days — exceeds your remaining balance of X days"
- Submit button disabled and labelled "Balance Exceeded" when `exceedsBalance` is true
- Server-side `LeaveBalanceService.validateLeaveRequest()` remains the authoritative check; this is UI guidance only

---

### FIX-5 — Apply Leave Modal: Post-Submission Info Note
**File:** `frontend/app/(dashboard)/(operations)/leave/page.tsx`

Added explanatory note below the form fields:
> "After submitting, your request goes to Pending status. Your manager or team lead will approve or reject it. You'll receive a notification when a decision is made. Pending requests count towards your tracked balance."

---

### FIX-6 — Approve / Reject Button Labels
**File:** `frontend/app/(dashboard)/(operations)/leave/page.tsx`

**Before:** Icon-only buttons (ambiguous at a glance).

**After:**
- `<CheckCircle size={13} /> Approve` — green styled
- `<XCircle size={13} /> Reject` — red styled
- Reject button calls `handleRejectClick(leave.id)` which sets `rejectingId` and opens confirmation modal

---

### FIX-7 — Reject Confirmation Modal
**File:** `frontend/app/(dashboard)/(operations)/leave/page.tsx`

Added full confirmation modal when `rejectingId` is set:
- Header with XCircle icon + "Reject Leave Request" title
- Summary warning: "This action cannot be undone"
- Rejection reason textarea (optional)
- Backend gap note: reason is for reference only and is **not stored** by the system
- "Confirm Rejection" button → calls `rejectMutation.mutate(rejectingId)`
- "Cancel" button → clears `rejectingId` and `rejectReason`
- Disabled during pending mutation

**Backend gap documented (not a blocker):**
`PATCH /leave/:id/reject` accepts no body — `leave.service.ts` `reject()` stores only `status: REJECTED`, `rejectedBy`, `rejectedAt`. There is no `rejectionReason` column in the schema. The reason textarea is a UX improvement for the approver's reference; it is not transmitted or persisted.

**Future enhancement:** Add `rejectionReason?: string` to `leave.controller.ts` body DTO, persist it in `leave.service.ts` reject(), expose it in leave list response. This requires a schema migration and is out of scope for this fix.

---

## Architecture Compliance

- ✅ No backend changes
- ✅ No new API endpoints — uses existing `leaveApi.getBalance()`, `leaveApi.approve()`, `leaveApi.reject()`
- ✅ `LeaveBalanceService` and `LeaveAccessService` not bypassed, duplicated, or replaced
- ✅ Duration preview is UI guidance only — server enforces balance via `validateLeaveRequest()`
- ✅ No fake metrics or fake balance calculations
- ✅ No P2/P3 features (payroll, HR fields, document uploads)
- ✅ No sensitive HR/payroll fields exposed

---

## Known Limitation: Overlap Detection

Client-side overlap detection (in `getConflicts()`) compares date ranges within the same department. This is a display-only hint for managers. The authoritative overlap check is performed server-side by `LeaveBalanceService.validateLeaveRequest()` on submission. The client-side check may produce false positives or false negatives if leave data is partially loaded.

---

## Verification

### Employee UX

| Feature | Covered by |
|---------|-----------|
| Remaining balance prominently shown | My Leave Balance card — large remaining days counter |
| Allocation / Used / Pending breakdown | 3-col grid in balance card + balance context strip in modal |
| Duration preview before submission | Duration preview pill in Apply Leave modal |
| Half-day support | `isHalfDay` checkbox + `halfDayType` dropdown in modal |
| Balance exceeded warning | Red pill + disabled submit + "Balance Exceeded" label |
| Post-submission explanation | Info note below form fields |

### Manager/TL UX

| Feature | Covered by |
|---------|-----------|
| Needs Action tab default | `tab` initialized to `'pending'` for `isManager` |
| Labeled Approve/Reject buttons | `<CheckCircle /> Approve` and `<XCircle /> Reject` |
| Rejection confirmation modal | `rejectingId` state + modal with reason textarea |
| Rejection reason gap documented | Backend note in modal + this report |
| Read-only reason surfaced | `approvalState.reason` shown in expandable details drawer |
| Leave balance decision support | Balance Before / Balance After Approval in expandable drawer |
| Overlap/conflict warning | Conflict badge in expandable drawer (client-side) |

### Tests
- Frontend TypeScript: **0 errors** (`npx tsc --noEmit`)
- Backend: **117/117 tests pass** (no backend changes)
- Frontend build: clean

---

## Files Modified

| File | Type | Change |
|------|------|--------|
| `frontend/app/(dashboard)/(operations)/leave/page.tsx` | Frontend | Balance card redesign, half-day support, duration preview, reject confirmation modal, labeled buttons, post-submit note |

---

## Backend Gap — Rejection Reason

| Field | Current State | Future Action Required |
|-------|--------------|----------------------|
| `rejectionReason` | Not in schema, not accepted by controller, not stored by service | Add optional `rejectionReason` field to `LeaveRequest` entity, DTO, service `reject()`, and list response |

This gap does not block any existing functionality. The reject action itself works correctly; only the optional reason text is not persisted.
