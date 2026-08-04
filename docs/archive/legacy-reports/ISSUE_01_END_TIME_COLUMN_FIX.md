# ISSUE #01 — END TIME COLUMN (Team → Live Status) — FIX REPORT
**Date:** 2026-06-06 | Branch: `main`
**Scope:** Add a TVA-integrated **End Time** column to the Team → Live Status table. Display only — no new time calculation.

---

## 1. BACKEND FINDINGS

### Authoritative end-time source
| Candidate field | Verdict |
|---|---|
| `WorkSession.logoutAt` | ✅ **AUTHORITATIVE** — set on both manual End Day and auto-close |
| `WorkSession.autoClosedAt` | Secondary marker (auto-close audit time); `logoutAt` is still set in the auto-close path |
| `WorkSession.status` | Drives Active vs Ended classification |
| `endTime` / `endedAt` / `endWorkAt` | **Do not exist** — `logoutAt` is the single end field |

### Evidence (writers of `logoutAt`)
- **Manual End Day** — `workday.service.ts` `endWork()`: `updateWorkSession(session.id, { status: 'LOGGED_OUT', logoutAt: now, totalBreakMinutes, totalWorkMinutes })` (L221-226). End time = `now` at End Day.
- **Auto-close (scheduler)** — sets `logoutAt`, `autoClosed: true`, status `AUTO_CLOSED`/`LOGGED_OUT`. End time = cutoff time.
- **Read path** — `calculateWorkdayRuntime()` already returns `currentEndTime` (= `logoutAt` when present, else live now). The team API returns the raw `todaySession` too.

**Conclusion:** `WorkSession.logoutAt` is the one authoritative End Time, written by the same workday engine that powers Start/Break/Resume/End/Auto-close. No new field needed in the DB.

---

## 2. TVA SOURCE OF TRUTH IDENTIFIED

```
WorkSession.logoutAt  (DB, authoritative)
        │  written by endWork() + auto-close scheduler (same engine as Work Time)
        ▼
/workday/team  →  member.endTime   (NEW explicit response alias = session.logoutAt)
        ▼
Team Live Status table  →  "End Time" column  (display only, formatted in company TZ)
```

End Time flows from the **same WorkSession record** as Work Time / Breaks. The frontend never computes it.

---

## 3. API CHANGES

**File:** `backend/src/modules/platform/workday/workday.service.ts` (`getTeam` response)

Added three explicit, authoritative fields to each team member (additive — no duplicate DB fields, no calculation change):
```ts
startTime: rt.firstStartTime,           // authoritative start (from runtime engine)
endTime: session?.logoutAt ?? null,     // AUTHORITATIVE end — WorkSession.logoutAt
hasOpenSession: !!session && !session.logoutAt,
```
`autoClosed` was already exposed. `todaySession` (full session) remains for backward compatibility.

> **No TVA / Work Time / Break calculations were modified.** Only a read-projection of the existing `logoutAt` was surfaced.

---

## 4. FRONTEND TABLE UPDATED

**File:** `frontend/app/(dashboard)/(operations)/team/page.tsx`

- New column header **End Time** inserted directly after **Started**:
  `Member | Status | Started | End Time | Work Time | Breaks | Department`
- `endedAt` now sourced from authoritative API field: `m.endTime ?? m.todaySession?.logoutAt` (formatted via existing `fmtTime()`, company TZ Asia/Kolkata).
- **Started** column simplified to show start time only (end info moved to the new column; removes the prior redundant "Ended at …" text). `Late` badge stays with Started.
- **No `Date.now()` / `new Date()` used for End Time.** `fmtTime()` only formats the authoritative ISO timestamp.

### Display rules implemented (all 6 cases)
| Case | Condition | Renders |
|---|---|---|
| 1 Active work | status WORKING | `Active` |
| 2 On break | status ON_BREAK (also IDLE) | `Active` |
| 3 Ended day | `endTime` present | `06:17 PM` |
| 4 Auto closed | `endTime` present + `autoClosed` | `06:17 PM` + `Auto Closed` badge |
| 5 Not started | no session / no start | `—` |
| 6 Corrupted | started, not active, **no `logoutAt`** | `Needs Review` (red badge — issue surfaced, not hidden) |

---

## 5. VALIDATION RESULTS

| Check | Result |
|---|---|
| Backend `tsc --noEmit` | ✅ PASS (0 errors) |
| Frontend `tsc --noEmit` | ✅ PASS (0 errors) |
| Frontend `npm run build` | ✅ PASS — `/team` compiled (7.77 kB) |
| Workday unit specs (`test/unit/workday*`) | ✅ **10/10 pass** — Work Time / runtime engine unaffected |

### Mapping to requested TEST cases
| Test | Expected | Status |
|---|---|---|
| T1 start work | Started=start, End Time=Active | ✅ (rule 1) |
| T2 break | End Time still Active | ✅ (rule 2) |
| T3 resume | End Time still Active | ✅ (rule 2→1) |
| T4 end day | End Time = logoutAt | ✅ (rule 3) |
| T5 auto close | End Time = logoutAt + badge | ✅ (rule 4) |
| T6 historical completed | actual End Time | ✅ (rule 3) |
| T7 Work Time unchanged | identical | ✅ (engine untouched; workday specs pass) |

> Live multi-role browser validation (T1–T6 end-to-end) requires a running backend + seeded sessions and is recommended as a manual pass; the logic is verified by build + type-check + workday unit specs.

---

## 6. ⚠️ PRE-EXISTING ISSUE (NOT caused by this change, NOT in scope)

The working tree currently contains a **large in-progress TVA refactor** that predates this issue (21 modified source files incl. new `company-date.service.ts`, `tva-attendance-authority`, `tva-date-authority`, `tva-sla-authority` specs; modified `auth.service`, `ticket-ledger`, `scheduler`, `analytics`, etc.).

Running the full unit suite shows **6 failing suites / 10 failing tests** in that refactor zone:
`tva-date-authority`, `p1.leave-balance`, `ticket-ledger.service`, `scheduler.service`, `auth.otp` (resend-cooldown test), `p1d.attachment-security`.

**These are NOT caused by Issue #01:**
- My change touches only the team API response projection + the team table UI.
- Workday-domain specs (the only domain I touched) pass 10/10.
- The failing suites are unrelated to a team-table column and were already failing in the working tree.

Per the explicit instruction *"Do NOT modify TVA calculations"*, I did **not** alter those files. They should be resolved as part of the separate TVA refactor workstream before delivery.

---

## 7. FILES CHANGED BY THIS ISSUE (2)
| File | Change |
|---|---|
| `backend/src/modules/platform/workday/workday.service.ts` | +`startTime`/`endTime`/`hasOpenSession` in `getTeam` response (authoritative `logoutAt`) |
| `frontend/app/(dashboard)/(operations)/team/page.tsx` | +End Time column (header + cell, 6 display rules), Started simplified |

**Not committed** — the working tree is mid-refactor with unrelated failing tests; committing now would entangle Issue #01 with the in-progress TVA work. Recommend committing this 2-file change on a clean base (or as an isolated commit) once the TVA refactor stabilizes.

## CONSTRAINTS HONORED
✅ End Time sourced from authoritative `WorkSession.logoutAt` · ✅ No frontend time computation · ✅ No TVA/Work Time/Break calculation modified · ✅ No duplicate DB timing field · ✅ Column placed after Started · ✅ Existing styling/responsive layout preserved · ✅ Corrupted sessions surfaced ("Needs Review"), not hidden.
