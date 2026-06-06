# FP-10 — MISSING FEATURE CLOSURE — PHASE 1 AUDIT
**Date:** 2026-05-30 | Branch: stabilize/apex-os-core @ 8eddef7
**Method:** Read-only source inspection. No code changed in this phase.

---

## EXECUTIVE FINDINGS (corrections to prior health check)

| Prior claim | Reality | Evidence |
|---|---|---|
| "Forgot password page missing" | **FALSE NEGATIVE — page exists** | `frontend/app/(auth)/forgot-password/page.tsx` (201 lines, full 2-step OTP flow) |
| "Block/Unblock ticket UI missing" | **TRUE — confirmed missing** | Zero block UI in `tickets/[id]/page.tsx`; backend complete |
| "Ticket block workflow frontend missing" | **TRUE — same gap as above** | — |

So FP-10 has **one genuine missing UI** (block/unblock) and **one already-built feature** (forgot/reset) that only needs a small security hardening.

---

## A. BLOCK / UNBLOCK TICKET UI

| # | Question | Answer |
|---|---|---|
| 1 | Backend endpoint exists? | **YES** — `POST /tickets/:id/block` and `POST /tickets/:id/unblock` (`tickets.controller.ts:172-184`) |
| 2 | Block request body | `{ reason: string }`. Service enforces `reason.trim().length >= 3`, else `400 "A blocker reason of at least 3 characters is required"` (`tickets.service.ts:657-659`) |
| 3 | Block response shape | The updated ticket (via `addSla(updated)`), `include: includeOptions`. Scalar block fields returned: `isBlocked:true`, `blockedAt`, `blockedReason`, `blockedById`. Side effects: `TicketHistory` row (`isBlocked false→true`), `ActivityLog TICKET_BLOCKED`, `EventLoggerService TICKET_BLOCKED`, socket `emitTicketStatusChanged(...,'BLOCKED')`, notifications to assignee + creator |
| 4 | Unblock request body | **None** (empty POST). Returns updated ticket via `addSla`; block fields nulled. Logs `TICKET_UNBLOCKED` to history + ActivityLog + EventLogger; socket emit; notifies assignee |
| 5 | Who can block? | `TicketAccessService.assertCanBlockTicket` (`ticket-access.service.ts:145-160`): **INTERN → forbidden**; **ADMIN/SUPER_ADMIN → allowed (any)**; **MANAGER/TEAM_LEAD → allowed if ticket in scope**; **EMPLOYEE → allowed if participant** (assignee/creator/listed assignee). Plus: **cannot block DONE/CLOSED** (`400`), **cannot block already-blocked** (`400`) |
| 6 | Who can unblock? | Same `assertCanBlockTicket`. Plus **cannot unblock a non-blocked ticket** (`400 "Ticket is not currently blocked"`) |
| 7 | Detail API returns block fields? | **Partially.** `findOne` uses `include: includeOptions` → all scalar columns return: `isBlocked`, `blockedAt`, `blockedReason`, `blockedById`. **No `blockedBy` user relation exists** in the Prisma schema (`schema.prisma:226-229` are scalars only) → blocker **name** must be resolved client-side from the already-loaded `users` query |
| 8 | Detail currently shows blocked state? | **NO.** Grep for `block`/`BLOCKED`/`unblock` in `tickets/[id]/page.tsx` → 0 matches |
| 9 | List/Kanban show blocked badge? | Backend selects `isBlocked` in kanban + sla-risk + supports `?isBlocked=true` filter (`tickets.service.ts:152-156, 960, 1014`). Frontend badge rendering not confirmed — **out of FP-10 scope** (this pass = ticket detail only) |
| 10 | api.ts exposes block/unblock? | **YES** — `ticketsApi.block(id, reason)` and `ticketsApi.unblock(id)` (`lib/api.ts:190-191`). **Zero callers** anywhere (grep clean). Spec asks for `blockTicket`/`unblockTicket` → will **rename** (safe, no callers) |
| 11 | What UI is missing? | (a) **Block button** for allowed users on non-blocked active tickets; (b) **Block-reason modal** (min 3 chars); (c) **Blocked banner panel** showing reason + blockedAt + blockedBy; (d) **Unblock button** on blocked tickets |

### Block/Unblock implementation contract (locked)
- Client method: `ticketsApi.blockTicket(id, reason)` → `POST /tickets/:id/block` body `{ reason }`
- Client method: `ticketsApi.unblockTicket(id)` → `POST /tickets/:id/unblock`
- Client permission gate (approximation; backend is final authority): `canToggleBlock = roleName !== 'INTERN' && (isTeamLeadPlus || isParticipant)`
- Block button hidden when `isDone` (DONE/CLOSED) — matches backend rejection
- All backend errors surfaced via toast (never hidden)
- On success: invalidate `['ticket', id]`, `['ticket-history', id]`, `['tickets']`

---

## B. FORGOT / RESET PASSWORD

| # | Question | Answer |
|---|---|---|
| 1 | forgot-password route exists? | **YES** — `frontend/app/(auth)/forgot-password/page.tsx`, full 2-step flow (email → OTP + new password) |
| 2 | reset-password route exists? | **NO separate route** — reset is **step 2 of the same page** (OTP method). This correctly matches the backend's email+OTP+newPassword contract (not a token-link flow) |
| 3 | Login links to forgot? | **YES** — `login/page.tsx:120` `<Link href="/forgot-password">Forgot your password?</Link>` |
| 4 | Forgot backend endpoint | `POST /auth/forgot-password` body `{ email }` → `sendOtp()`. Returns `{ message: "OTP sent to <email>" }`. **Throws `404 "User not found"` for unknown emails** (`auth.service.ts:144-157`) |
| 5 | Reset backend endpoint | `POST /auth/reset-password` body `{ email, otp, newPassword }` → `resetPasswordWithOtp()`. Returns `{ message: "Password reset successfully" }`. Errors: `400` password < 8 chars; `400 "No OTP requested for this email"`; `400 "OTP has expired"`; `400 "Invalid OTP"`; `404 "User not found"` (`auth.service.ts:159-181`) |
| 6 | Email send or dev message? | OTP generated server-side, stored **in-memory** (`Map`, 10-min TTL). **Not emailed** — `sendOtp` has a `TODO: send via SMTP`. In dev, a **non-revealing** console line is logged (the OTP value itself is NOT logged). Response **never** contains the OTP |
| 7 | SMTP needed for real email? | **YES — hard dependency.** `sendOtp` does not call `EmailService`. Without SMTP wiring, the user has **no channel to receive the OTP** in production. This is a backend limitation, not a UI gap |
| 8 | Errors UI should handle | Invalid email format; password < 8; invalid/expired/no OTP; rate-limit (429); network/500 |
| 9 | Backend protects against enumeration? | **NO.** `sendOtp` throws `404 "User not found"` for unknown emails — reveals account existence. **This is a tested business rule** (`backend/test/unit/auth.otp.spec.ts:59` asserts `rejects.toThrow('User not found')`). Per FP-10 scope ("do not change backend business rules"), **backend left unchanged** |
| 10 | What UI is missing? | **Functionally nothing** — pages + link + API methods all exist and work. **One security gap:** step 1 currently calls `toast.error("User not found")` and refuses to advance when the email is unknown → reveals enumeration. **Minimal frontend hardening** will show a generic message and advance regardless, so the UI no longer reveals existence at step 1 |

### Forgot/Reset implementation contract (locked)
- `authApi.forgotPassword(email)` and `authApi.resetPassword(email, otp, newPassword)` already exist (`lib/api.ts:67-69`) — **no change needed**
- Frontend hardening only: on step-1, treat `404 / "User not found"` as success-equivalent → generic message + advance to OTP step; surface other errors (rate-limit, network)
- No backend change (tested rule); residual enumeration documented in REMAINING_GAPS

---

## SCOPE CONFIRMATION

| Constraint | Honored |
|---|---|
| No ticket-detail redesign | ✅ additive panel + modal + 1 header button only |
| No login/auth redesign | ✅ forgot-page handler + copy hardening only |
| No backend business-rule change | ✅ block/unblock + OTP rules untouched |
| No bypass of TicketAccessService | ✅ all calls go through existing endpoints |
| No bypass of auth guards | ✅ central authenticated `api` client only |
| No bypass of EventLoggerService | ✅ backend logs events; frontend creates none |
| No new modules / AI / automation | ✅ |
| No deployment config change | ✅ |

**Phase 1 complete. Proceeding to implementation.**
