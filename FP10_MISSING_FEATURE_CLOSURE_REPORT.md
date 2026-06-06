# FP-10 — MISSING FEATURE CLOSURE — IMPLEMENTATION REPORT
**Date:** 2026-05-30 | Branch: stabilize/apex-os-core @ 8eddef7
**Scope:** (1) Block/Unblock Ticket UI · (2) Forgot/Reset Password UI

---

## SUMMARY

| Feature | Before | After |
|---|---|---|
| Block/Unblock Ticket UI | Backend complete, **no frontend** | **Full UI added** to ticket detail — block button, reason modal, blocked banner, unblock button |
| Forgot/Reset Password UI | **Already existed** (prior "missing" was a false negative) | Kept as-is; **hardened against user enumeration** at step 1 |

**Backend changed:** none. All work is frontend, using existing endpoints, guards, access service, and event logging.

---

## FILES CHANGED (3 — all frontend)

### 1. `frontend/lib/api.ts`
Renamed the two pre-existing (uncalled) client methods to the FP-10-specified names:
```diff
- block:   (id, reason) => r(api.post(`/tickets/${id}/block`, { reason })),
- unblock: (id)         => r(api.post(`/tickets/${id}/unblock`)),
+ blockTicket:   (id, reason) => r(api.post(`/tickets/${id}/block`, { reason })),
+ unblockTicket: (id)         => r(api.post(`/tickets/${id}/unblock`)),
```
Grep confirmed **zero existing callers** before the rename, so this is safe. Uses the central authenticated `api` client (no raw fetch).

### 2. `frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx`
Additive only — no redesign of existing layout:
- **Imports:** added `Ban`, `Unlock` icons.
- **State:** `showBlockModal`, `blockReason`.
- **Mutations:** `blockMutation` → `ticketsApi.blockTicket(id, reason.trim())`; `unblockMutation` → `ticketsApi.unblockTicket(id)`. Both invalidate `['ticket', id]`, `['ticket-history', id]`, `['tickets']` on success and **surface the backend error message** on failure (`toast.error(e?.message …)`).
- **Permission gate:** `canToggleBlock = roleName !== 'INTERN' && (isTeamLeadPlus || isParticipant)` — a client approximation of `TicketAccessService.assertCanBlockTicket`; backend remains the final authority.
- **Header Block button:** shown only when `canToggleBlock && !ticket.isBlocked && !isDone` (DONE/CLOSED excluded to match backend rejection). Opens the reason modal.
- **Blocked banner:** rendered when `ticket.isBlocked` — shows "This ticket is blocked", `blockedReason`, blocker name (resolved client-side from the already-loaded `users` query via existing `resolveUserName`), `blockedAt` (via existing `formatDate`), and an **Unblock** button (gated by `canToggleBlock`).
- **Block modal:** reason textarea; submit disabled until `blockReason.trim().length >= 3` (matches backend minimum); loading state; cancel resets.

### 3. `frontend/app/(auth)/forgot-password/page.tsx`
Security hardening only (no structural/redesign change):
- Added `GENERIC_OTP_MESSAGE = 'If an account exists for that email, a one-time code has been sent.'`
- `handleSendOtp` now treats a `404 / "User not found"` response **exactly like success** (generic message + advance to OTP step), so step 1 no longer reveals whether an account exists. Genuine failures (rate-limit, network/server) are still surfaced so the user can retry.

---

## REQUIREMENT COMPLIANCE

### Phase 2 — Block/Unblock
| Requirement | Status |
|---|---|
| Block action only for allowed users | ✅ `canToggleBlock`, INTERN excluded, DONE/CLOSED excluded |
| Opens modal requiring reason (≥3 chars) | ✅ submit disabled < 3 chars (backend also enforces) |
| Calls `POST /tickets/:id/block` | ✅ via `ticketsApi.blockTicket` |
| Loading state + backend errors shown | ✅ spinner + `toast.error(e?.message)` |
| On success refresh detail/history | ✅ invalidates `['ticket']`, `['ticket-history']`, `['tickets']` |
| Blocked panel (reason/at/by) | ✅ reason + `formatDate(blockedAt)` + resolved blocker name |
| Unblock action for allowed users → `POST /unblock` | ✅ via `ticketsApi.unblockTicket` |
| Don't hide denied backend errors | ✅ surfaced verbatim |
| Don't show action to clearly-unable users | ✅ INTERN + non-participant employees hidden client-side |
| Don't make DONE/CLOSED blockable | ✅ button hidden when `isDone` |
| Minimal, consistent with existing style | ✅ mirrors Edit modal + Approvals banner patterns |
| No new "blocked" status column | ✅ overlay only |
| `ticketsApi.blockTicket` / `unblockTicket` via central client | ✅ |
| No frontend-created activity; backend logs event | ✅ history/event logging is backend-side; UI only refetches |

### Phase 3 — Forgot/Reset
| Requirement | Status |
|---|---|
| Login links to /forgot-password | ✅ pre-existing (`login/page.tsx:120`), browser-verified |
| Forgot page: email + submit + loading | ✅ pre-existing |
| Generic non-enumerating success message | ✅ **added** (`GENERIC_OTP_MESSAGE`, 404 treated as success) |
| Reset uses backend OTP method (email+OTP+new+confirm) | ✅ pre-existing step 2 |
| Validation (email, OTP, ≥8 chars, confirm match) | ✅ pre-existing |
| Success → confirmation + link to login | ✅ pre-existing (redirects to /login) |
| No OTP/password logged in console | ✅ verified — page logs nothing |
| `authApi.forgotPassword` / `resetPassword` via central client | ✅ pre-existing |

---

## WHAT WAS NOT DONE (and why)
- **Backend OTP enumeration not fixed in backend:** `sendOtp` throws `404 "User not found"`, asserted by `auth.otp.spec.ts:59`. Changing it = changing a tested business rule, explicitly out of FP-10 scope. Mitigated at the UI; documented in `FP10_REMAINING_GAPS.md`.
- **OTP email delivery (SMTP):** `sendOtp` does not send mail. Out of scope (no backend change); this is the real production blocker for the forgot flow — see remaining gaps.
- **Blocked badge on list/Kanban:** FP-10 scope was the ticket **detail** UI; list/kanban badges are noted as a future enhancement.

See `FP10_MISSING_FEATURE_VERIFICATION_REPORT.md` and `FP10_REMAINING_GAPS.md`.
