# FP-10 — REMAINING GAPS
**Date:** 2026-05-30 | Branch: stabilize/apex-os-core @ 8eddef7

Categorized per the FP-10 brief: actual defects · backend contract limitations · SMTP dependency · production env dependency · future enhancement.

---

## 1. ACTUAL DEFECTS
**None introduced by this change.** Type-check, build, and the backend OTP contract test are all green. No regression to existing ticket-detail or auth behavior (additive UI only).

The previously-reported "forgot password page missing" (health check item) was a **false negative** — the page existed. This is corrected in `FP10_MISSING_FEATURE_CLOSURE_AUDIT.md`.

---

## 2. BACKEND CONTRACT LIMITATIONS

| ID | Limitation | Impact | Recommendation |
|---|---|---|---|
| BC-1 | **User enumeration on `POST /auth/forgot-password`** — `sendOtp` throws `404 "User not found"` for unknown emails (asserted by `auth.otp.spec.ts:59`). | Step 1 is masked by the UI (404 treated as success), but a network-level observer can still see the 404. Residual enumeration also exists at **step 2**: unknown email → `400 "No OTP requested"` vs wrong code → `400 "Invalid OTP"`. | Backend follow-up (separate task): make `sendOtp` return the generic success message for unknown emails and update `auth.otp.spec.ts` accordingly. Out of FP-10 scope (changes a tested business rule). |
| BC-2 | **No `blockedBy` relation** — schema stores `blockedById` scalar only; `findOne` does not hydrate a blocker `User`. | UI resolves the blocker's name client-side from the `users` query. If the viewer's `users` list doesn't include the blocker, the banner falls back to showing the raw id. | Optional backend follow-up: add a `blockedBy User @relation` and include it in `includeOptions`, or expose blocker name in the block response. |

---

## 3. SMTP DEPENDENCY

| ID | Gap | Impact | Recommendation |
|---|---|---|---|
| SMTP-1 | **OTP is never delivered.** `sendOtp` generates + stores the OTP in-memory but does **not** send email (`TODO: send via SMTP`). In dev, a non-revealing console line is logged; the OTP value is not exposed anywhere a user can see. | In production, a real user **cannot receive the reset code** → the forgot-password feature is **not usable end-to-end** until SMTP send is wired. This is the true blocker for this feature, independent of the UI. | Wire `EmailService` into `sendOtp` to email the OTP, then configure SMTP (see production env dependency). Tracked under FP-11 (Environment Hardening). |
| SMTP-2 | **In-memory OTP store** — OTPs live in a per-process `Map`. | A backend restart or multi-instance deploy (e.g., Render scaling) invalidates/desyncs pending OTPs. | Persist OTPs (DB or cache) when moving beyond single-instance. Future. |

---

## 4. PRODUCTION / ENV DEPENDENCY

| ID | Gap | Impact | Recommendation |
|---|---|---|---|
| ENV-1 | **Backend not running locally** (`/api/health` timed out). | Interactive E2E for block/unblock and full OTP reset could not be executed this pass (all behind the API). | Start backend + frontend, run the Phase-4 manual steps in `FP10_MISSING_FEATURE_VERIFICATION_REPORT.md`. |
| ENV-2 | **No confirmed seeded credentials** post-migration. | Cannot log in to drive role-based block/unblock checks (MANAGER vs INTERN). | Confirm/seed a known user per role on the target DB. |
| ENV-3 | **Production smoke not run** (pre-existing P0). | Live behavior of new UI unverified in prod. | Deploy, hit `/api/health`, run one block/unblock + one password reset on the live URL. |

---

## 5. FUTURE ENHANCEMENTS (out of FP-10 scope)

| ID | Enhancement |
|---|---|
| FE-1 | **Blocked badge on tickets list & Kanban cards.** Backend already returns `isBlocked` and supports `?isBlocked=true`; surfacing a badge/filter chip in the list and kanban views would complete the blocked-ticket visual story. (FP-10 covered the detail page only.) |
| FE-2 | **Block reason in ticket History tab.** History records the `isBlocked` field change; a friendly "X blocked the ticket: <reason>" line in `formatHistoryItem` would read better than the generic field-change row. |
| FE-3 | **Dedicated `/reset-password` route** for a future token-link email flow (current OTP flow is single-page and correct for the present backend). |
| FE-4 | **Resend OTP / cooldown timer** on the forgot-password step 2. |

---

## PRIORITY SUMMARY

| Priority | Item | Blocks |
|---|---|---|
| **P1** | SMTP-1 (OTP delivery) | Forgot-password usable in production |
| **P1** | ENV-1/2/3 (run backend, seed creds, prod smoke) | Interactive verification + pilot |
| **P2** | BC-1 (backend enumeration) | Security hardening (UI already mitigates step 1) |
| **P3** | BC-2, SMTP-2, FE-1…FE-4 | Polish / scale |

**Block/Unblock UI:** code-complete, build-verified; only ENV-1/2 block its interactive sign-off.
**Forgot/Reset UI:** code-complete + enumeration-hardened; SMTP-1 blocks real-world usability.
