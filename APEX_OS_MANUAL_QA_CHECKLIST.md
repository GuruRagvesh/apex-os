# APEX OS — MANUAL QA CHECKLIST
**Date:** 2026-06-02 | `main` @ `7f1c8fb`
**Frontend:** https://apex-os-frontend.vercel.app · **Backend:** https://apex-os-3nyi.onrender.com/api

Use real role accounts. Fill PASS/FAIL + Notes. Items marked ❓ in the audit are the priority — they could not be confirmed without a live session.

---

## 0. PRE-FLIGHT (Infra)
| # | Step | Expected | Pass/Fail | Notes |
|---|---|---|---|---|
| 0.1 | `GET /api/health` | 200, `database: connected`, `environment: production` | | |
| 0.2 | Render env → JWT_SECRET | Long random (NOT placeholder) | | **P0** |
| 0.3 | Render env → RESEND_API_KEY + RESEND_FROM_EMAIL | Present, domain verified | | P1 |
| 0.4 | Service warm during business hours | Cron jobs firing (check logs) | | P1 |

---

## 1. AUTH (login: any)
| # | Step | Expected | P/F | Notes |
|---|---|---|---|---|
| 1.1 | Login with valid SUPER_ADMIN | Redirect to dashboard/select-mode | | |
| 1.2 | Login with wrong password | "Invalid credentials" (no enumeration) | | |
| 1.3 | 6 rapid bad logins | 429 rate limit | | |
| 1.4 | Forgot password → enter real email | Generic message + OTP email arrives | | **P1 (Resend)** |
| 1.5 | Complete OTP reset → login new password | Works; old password fails | | |
| 1.6 | Logout | Returns to login; token cleared | | |
| 1.7 | First-login user | Forced `/change-password` | | |

---

## 2. TICKETS (login: EMPLOYEE, then MANAGER)
| # | Step | Expected | P/F | Notes |
|---|---|---|---|---|
| 2.1 | Create ticket (all fields) | Appears in list with TKT-xxx | | |
| 2.2 | Open ticket detail | Shows status stepper, comments, history tabs | | |
| 2.3 | Move OPEN→IN_PROGRESS | Timer starts; status updates | | |
| 2.4 | Submit for REVIEW (with attachment) | Moves to REVIEW; attachment uploads | | **❓ attachments** |
| 2.5 | Reviewer rejects → REWORK | Returns to IN_PROGRESS; rework counted | | |
| 2.6 | Reviewer approves + ratings | Moves to DONE; ratings saved | | |
| 2.7 | Try editing a CLOSED ticket | Blocked ("Cannot modify a closed ticket") | | |
| 2.8 | Try reassign DONE without reopen | Blocked | | |
| 2.9 | While ON_BREAK, submit to REVIEW | Blocked ("Resume work before...") | | |
| 2.10 | Block then unblock a ticket | Blocked banner shows then clears | | |
| 2.11 | Add comment | Appears immediately | | |
| 2.12 | Export CSV | File downloads | | |
| 2.13 | **MANAGER**: dashboard ticket count vs `/tickets` list count | Counts MATCH | | **P1 (dept NULL)** |

---

## 3. KANBAN (login: EMPLOYEE + MANAGER)
| # | Step | Expected | P/F | Notes |
|---|---|---|---|---|
| 3.1 | Open `/kanban` | Columns render with counts | | |
| 3.2 | Drag own ticket to next column | Moves; status persists on refresh | | **❓ drag-drop** |
| 3.3 | Drag a ticket you don't own | Rejected (403/snap back) | | |

---

## 4. WORKDAY (login: EMPLOYEE)
| # | Step | Expected | P/F | Notes |
|---|---|---|---|---|
| 4.1 | Start workday | Status → WORKING; bar shows timer | | |
| 4.2 | Take break (pick type) | Status → ON_BREAK | | |
| 4.3 | Resume | Status → WORKING | | |
| 4.4 | End workday | Summary shows realistic totals (NOT 100h+) | | **P1** |
| 4.5 | Refresh mid-session | Session recovers correctly | | |
| 4.6 | Idle 2+ min (if testable) | Idle popup appears | | ❓ idle |
| 4.7 | Profile → workday history | Grouped history; no impossible hours | | **P1 (55 corrupt)** |
| 4.8 | **MANAGER** → `/team` live status | Shows team WORKING/BREAK/OFFLINE | | |

---

## 5. LEAVE (login: EMPLOYEE, then MANAGER, then own-MANAGER)
| # | Step | Expected | P/F | Notes |
|---|---|---|---|---|
| 5.1 | Apply for leave | Appears in "My Requests" | | |
| 5.2 | Balance shown | Correct remaining quota | | |
| 5.3 | **MANAGER** approves subordinate leave | Status → APPROVED; employee notified | | |
| 5.4 | **MANAGER** views own leave request | NO approve/reject buttons on own | | |
| 5.5 | Manager tries to approve higher-rank leave | Blocked | | |
| 5.6 | Reject a leave | Status → REJECTED | | |
| 5.7 | Calendar shows approved leave | Visible on `/calendar` | | |

---

## 6. NOTIFICATIONS (two browsers: assigner + assignee)
| # | Step | Expected | P/F | Notes |
|---|---|---|---|---|
| 6.1 | Assign ticket to user B | User B bell increments | | **❓ socket** |
| 6.2 | Real-time without refresh | Appears live (or within poll) | | ❓ |
| 6.3 | Mark one read | Count decrements | | |
| 6.4 | Mark all read | Count → 0 | | |
| 6.5 | User B sees only own notifications | No cross-user leakage | | |

---

## 7. PROJECTS (login: MANAGER)
| # | Step | Expected | P/F | Notes |
|---|---|---|---|---|
| 7.1 | `/projects` list | Cards render | | |
| 7.2 | Create project | Appears; PRJ-xxx | | |
| 7.3 | Open detail (click 3 projects) | Each opens, no "could not be located" | | |
| 7.4 | Edit project | Saves | | |
| 7.5 | Add/remove member | Updates | | |

---

## 8. ANALYTICS (login: SUPER_ADMIN, then EMPLOYEE)
| # | Step | Expected | P/F | Notes |
|---|---|---|---|---|
| 8.1 | `/analytics` all 7 tabs load | No console errors | | |
| 8.2 | Command Center period toggle | Counts change | | |
| 8.3 | Team tab as EMPLOYEE | "Not available for your role" | | |
| 8.4 | Rankings | "No ranking data yet" (not blank/crash) | | |

---

## 9. USERS / SETTINGS (login: SUPER_ADMIN)
| # | Step | Expected | P/F | Notes |
|---|---|---|---|---|
| 9.1 | `/users` as EMPLOYEE | Blocked / not in nav | | |
| 9.2 | Create + deactivate user | Works | | |
| 9.3 | User profile 5 tabs | All render; sensitive fields masked for non-HR | | |
| 9.4 | Settings: change SLA | Saves; new ticket reflects new SLA | | |
| 9.5 | Settings: Email Test | Sends (if Resend configured) | | **P1** |
| 9.6 | `GET /task-types` without token (devtools) | Should be 401 | ✅ | **P1 security** |

---

## 10. SECURITY SPOT-CHECKS
| # | Step | Expected | P/F | Notes |
|---|---|---|---|---|
| 10.1 | Open `/dashboard` logged out | Redirect to `/login` | | |
| 10.2 | EMPLOYEE hits `GET /users/:otherId` | 403 or self-only | | |
| 10.3 | EMPLOYEE hits another user's ticket by ID | 403 (scope check) | | |
| 10.4 | Inspect any GET response | No `password` field | | |

---

### Sign-off
| Role tester | Date | Overall result | Blocking issues |
|---|---|---|---|
| | | | |
