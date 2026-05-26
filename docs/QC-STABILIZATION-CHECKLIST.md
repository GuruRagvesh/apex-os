# Apex OS — QC Stabilization Checklist

> **Version:** Stabilization Stage 8 · Branch: `stabilize/apex-os-core`
> **Last reviewed:** 2026-05-26
>
> Each item must be manually verified by a QA reviewer before marking ✅.
> Failures must be filed as GitHub issues with the label `qc-regression`.

---

## 0 — Test Accounts

Use the local-only role accounts for all permission tests.
Seed with: `npx ts-node prisma/seed-test-users.ts`

| Role        | Email                       | Password      |
|-------------|-----------------------------|---------------|
| SUPER_ADMIN | `superadmin@apex.local`     | `Apex@local1` |
| ADMIN       | `admin@apex.local`          | `Apex@local1` |
| MANAGER     | `manager@apex.local`        | `Apex@local1` |
| TEAM_LEAD   | `teamlead@apex.local`       | `Apex@local1` |
| EMPLOYEE    | `employee@apex.local`       | `Apex@local1` |
| INTERN      | `intern@apex.local`         | `Apex@local1` |

---

## 1 — Authentication

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 1.1 | Login with valid credentials (`admin@apex.local`) | Redirected to `/dashboard`; JWT stored in `apex_token` | ☐ |
| 1.2 | Login with wrong password | Toast: "Invalid credentials"; no redirect | ☐ |
| 1.3 | Login with unknown email | Toast: "Invalid credentials" | ☐ |
| 1.4 | Visit `/dashboard` without a token | Redirected to `/login` | ☐ |
| 1.5 | Token expires (set short TTL in .env, e.g. `JWT_EXPIRES_IN=5s`) | Auto-redirected to `/login?expired=true`; token cleared | ☐ |
| 1.6 | Logout | `apex_token` and `apex-auth` removed; redirected to `/login` | ☐ |
| 1.7 | `GET /api/auth/me` without Bearer token | 401 Unauthorized | ☐ |
| 1.8 | Forgot password flow: submit email → receive OTP → reset | OTP accepted; new password works | ☐ |
| 1.9 | `POST /api/auth/register` without admin JWT | 401 Unauthorized | ☐ |
| 1.10 | `POST /api/auth/register` with EMPLOYEE JWT | 403 Forbidden | ☐ |
| 1.11 | `POST /api/auth/login` rate limit (6 attempts in < 15 min) | 429 Too Many Requests | ☐ |
| 1.12 | Old `nexus_token` in localStorage is migrated to `apex_token` on page load | `nexus_token` gone; user stays logged in | ☐ |

---

## 2 — Role Permissions Matrix

Test each action as each role and confirm the expected result.

### Tickets

| Action | SUPER_ADMIN | ADMIN | MANAGER | TEAM_LEAD | EMPLOYEE | INTERN |
|--------|-------------|-------|---------|-----------|----------|--------|
| Create ticket | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View all tickets | ✅ | ✅ | ✅ (dept) | ✅ (dept) | ✅ (own) | ✅ (own) |
| Assign ticket | ✅ | ✅ | ✅ | ✅ | ✅ (own only) | ✅ (own only) |
| Approve/reject ticket | ✅ | ✅ | ✅ | ☐ | ☐ | ☐ |
| Delete ticket | ✅ | ✅ | ☐ | ☐ | ☐ | ☐ |
| Intern: move to DONE | ✅ (self-assigned) | ✅ | ✅ | ✅ | ✅ | ❌ forbidden |
| REVIEW → DONE | ✅ | ✅ | ✅ | ❌ forbidden | ❌ forbidden | ❌ forbidden |

### Users

| Action | SUPER_ADMIN | ADMIN | MANAGER | TEAM_LEAD | EMPLOYEE | INTERN |
|--------|-------------|-------|---------|-----------|----------|--------|
| View user list | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create user | ✅ | ✅ | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 |
| Edit any user | ✅ | ✅ | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 |
| View own profile | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View payroll fields | ✅ | ✅ | ❌ masked | ❌ masked | ❌ masked | ❌ masked |
| Deactivate user | ✅ | ✅ | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 |

### Leave

| Action | SUPER_ADMIN | ADMIN | MANAGER | TEAM_LEAD | EMPLOYEE | INTERN |
|--------|-------------|-------|---------|-----------|----------|--------|
| Submit own leave | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View all dept leave | ✅ | ✅ | ✅ | ✅ (dept) | ❌ own only | ❌ own only |
| Approve leave | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Approve own leave | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 | ❌ 403 |

### Settings

| Action | SUPER_ADMIN | ADMIN | MANAGER | TEAM_LEAD | EMPLOYEE | INTERN |
|--------|-------------|-------|---------|-----------|----------|--------|
| View settings page | ✅ | ✅ | ❌ redirect | ❌ redirect | ❌ redirect | ❌ redirect |
| Save company settings | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Save SMTP settings | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Save leave policy | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 3 — Tickets

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 3.1 | `/tickets` page loads | List renders; no console errors | ☐ |
| 3.2 | `/tickets/new` page loads | Form renders all fields | ☐ |
| 3.3 | Create ticket (all required fields) | Ticket appears in list; ticketId generated | ☐ |
| 3.4 | Create ticket with blank title | Validation error shown | ☐ |
| 3.5 | Open ticket detail `/tickets/:id` | All fields shown; history tab works | ☐ |
| 3.6 | Assign ticket to user | Assignee updated; notification sent | ☐ |
| 3.7 | Status transition OPEN → IN_PROGRESS | Status badge updates; history recorded | ☐ |
| 3.8 | Status transition IN_PROGRESS → REVIEW | Status updates | ☐ |
| 3.9 | Status transition REVIEW → DONE (as MANAGER) | Ticket closed; notification sent | ☐ |
| 3.10 | INTERN moves ticket to DONE directly | 403 error toast | ☐ |
| 3.11 | Filter tickets by status | Only matching tickets shown | ☐ |
| 3.12 | Filter tickets by department | Scoped correctly | ☐ |
| 3.13 | CSV export | File downloads with correct columns | ☐ |
| 3.14 | Attachment upload on ticket | File appears in attachments list | ☐ |
| 3.15 | Add comment on ticket | Comment appears; timestamps correct | ☐ |
| 3.16 | Edit then delete comment | Updates/removes correctly | ☐ |
| 3.17 | Kanban `/kanban` loads | Columns render; tickets in correct columns | ☐ |
| 3.18 | Drag ticket on Kanban to new column | Status updates; history recorded | ☐ |
| 3.19 | Approve ticket (REVIEW → DONE via Approve button) | Ticket moves to DONE | ☐ |
| 3.20 | Reject ticket (REVIEW → back) | Comment required; ticket reverts | ☐ |

---

## 4 — Projects

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 4.1 | `/projects` page loads | List renders; no console errors | ☐ |
| 4.2 | Create new project | Appears in list; projectId generated | ☐ |
| 4.3 | Open project detail `/projects/:id` | Members, tickets, progress visible | ☐ |
| 4.4 | Add member to project | Member appears in members list | ☐ |
| 4.5 | Remove member from project | Member removed | ☐ |
| 4.6 | EMPLOYEE only sees projects they're a member of | No cross-project leakage | ☐ |
| 4.7 | Link ticket to project | Ticket appears in project's ticket list | ☐ |
| 4.8 | Project status filter works | Only matching projects shown | ☐ |
| 4.9 | Delete project (as ADMIN) | Project removed | ☐ |

---

## 5 — Leave

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 5.1 | `/leave` page loads | Requests listed; stats shown | ☐ |
| 5.2 | Submit leave request | Appears with PENDING status | ☐ |
| 5.3 | Submit leave with end < start | Validation error | ☐ |
| 5.4 | Manager approves leave | Status → APPROVED; email sent | ☐ |
| 5.5 | Manager rejects leave | Status → REJECTED | ☐ |
| 5.6 | Employee tries to approve own leave | 403 error | ☐ |
| 5.7 | Cancel pending leave (as submitter) | Status → CANCELLED | ☐ |
| 5.8 | Cannot cancel already-approved leave | Error shown | ☐ |
| 5.9 | Leave stats widget shows correct counts | Matches DB state | ☐ |

---

## 6 — Users

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 6.1 | `/users` page loads (ADMIN) | Full user list with pagination | ☐ |
| 6.2 | Search users by name | Filtered results | ☐ |
| 6.3 | Filter users by department | Scoped list | ☐ |
| 6.4 | Create new user (ADMIN) | User appears in list | ☐ |
| 6.5 | Deactivate user (ADMIN) | User no longer appears in active list | ☐ |
| 6.6 | View own profile `/users/:id` | All own fields shown | ☐ |
| 6.7 | Employee views another user's profile | Payroll fields masked/hidden | ☐ |
| 6.8 | Edit own profile (personal fields) | Changes saved and persist on refresh | ☐ |
| 6.9 | Edit payroll fields as EMPLOYEE | 403 Forbidden | ☐ |
| 6.10 | Upload profile photo | Photo updates in header and profile | ☐ |
| 6.11 | Upload document | Document appears in Documents tab | ☐ |
| 6.12 | Admin verifies document | Status → VERIFIED; logged to audit | ☐ |
| 6.13 | Reset user password (ADMIN) | User can login with new password | ☐ |

---

## 7 — Departments

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 7.1 | `/departments` page loads (ADMIN) | List renders | ☐ |
| 7.2 | Create department | Appears in list | ☐ |
| 7.3 | Edit department name | Name updates everywhere | ☐ |
| 7.4 | Delete department (no users assigned) | Removed | ☐ |
| 7.5 | Delete department with users | Error or reassignment required | ☐ |
| 7.6 | Department detail `/departments/:id` | Member list and stats shown | ☐ |

---

## 8 — Settings

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 8.1 | `/settings` loads (ADMIN) | All tabs render | ☐ |
| 8.2 | Save company name | Persists after page refresh | ☐ |
| 8.3 | Save leave policy (annual days) | Persists after page refresh | ☐ |
| 8.4 | Save SLA config | Persists after page refresh | ☐ |
| 8.5 | Save SMTP host/port | Values show on reload; password masked | ☐ |
| 8.6 | Save notification preferences | Persists cross-device (DB-backed) | ☐ |
| 8.7 | Save ticket preferences | Persists after logout/login | ☐ |
| 8.8 | Save company theme defaults | `/settings` shows saved theme on reload | ☐ |
| 8.9 | Non-admin accessing `/settings` | Redirected; no 403 toast | ☐ |

---

## 9 — Notifications

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 9.1 | Ticket assigned → assignee receives in-app notification | Bell badge increments | ☐ |
| 9.2 | Mark single notification read | Badge decrements; item fades | ☐ |
| 9.3 | Mark all read | Badge → 0 | ☐ |
| 9.4 | Delete notification | Removed from list | ☐ |
| 9.5 | User B cannot read User A's notifications | `GET /notifications` returns own only | ☐ |
| 9.6 | Real-time: assign ticket while logged in as assignee | Bell pops without page refresh | ☐ |

---

## 10 — Dashboard

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 10.1 | `/dashboard` loads (all roles) | No console errors; charts render | ☐ |
| 10.2 | ADMIN sees org-wide stats | All departments in chart | ☐ |
| 10.3 | EMPLOYEE sees own stats only | No other users' ticket counts | ☐ |
| 10.4 | MANAGER sees department stats | Only their departments | ☐ |
| 10.5 | Activity feed shows recent actions | Items link to correct entities | ☐ |
| 10.6 | Workload chart shows ≤100 users | No timeout or empty state | ☐ |
| 10.7 | Ticket trend chart renders | Days toggle (7/30) works | ☐ |

---

## 11 — Analytics

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 11.1 | `/analytics` page loads | Charts render without error | ☐ |
| 11.2 | Ticket by category chart | Correct categories, counts | ☐ |
| 11.3 | Ticket by department chart | Dept names and counts | ☐ |
| 11.4 | Date range filter changes data | Charts update | ☐ |

---

## 12 — Mobile / Responsive

Test at 375px (iPhone SE), 768px (iPad), and 1280px (desktop).

| # | Check | 375px | 768px | 1280px |
|---|-------|-------|-------|--------|
| 12.1 | Sidebar collapses to hamburger on mobile | ☐ | ☐ | ✅ always open |
| 12.2 | Ticket list is scrollable | ☐ | ☐ | ☐ |
| 12.3 | Ticket create form usable | ☐ | ☐ | ☐ |
| 12.4 | Kanban board scrolls horizontally | ☐ | ☐ | ☐ |
| 12.5 | Modal dialogs don't overflow viewport | ☐ | ☐ | ☐ |
| 12.6 | Settings page tabs are accessible | ☐ | ☐ | ☐ |
| 12.7 | Dashboard charts are readable | ☐ | ☐ | ☐ |
| 12.8 | Command palette (Ctrl+K) opens correctly | n/a | ☐ | ☐ |

---

## 13 — UI Consistency

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 13.1 | All buttons use consistent variant styles | No mix of raw `<button>` and custom `<Button>` | ☐ |
| 13.2 | Toast messages for success are green | Not white/neutral on success operations | ☐ |
| 13.3 | Toast messages for errors are red | Not green on errors | ☐ |
| 13.4 | No toast says "success" on a genuine failure | Review all catch blocks | ☐ |
| 13.5 | Product name "Apex OS" everywhere in UI | No "Nexus" visible to users | ☐ |
| 13.6 | Email logo shows "A" monogram | Not "N" in any email type | ☐ |
| 13.7 | Page titles / browser tabs say "Apex OS" | No "Nexus" in `<title>` | ☐ |
| 13.8 | Sidebar logo is consistent across all pages | Same component, no layout shift | ☐ |
| 13.9 | Loading skeletons shown during fetch | No blank-content flash | ☐ |
| 13.10 | Empty states shown when lists are empty | Friendly message, not blank | ☐ |
| 13.11 | Role badge colors are consistent | ADMIN = purple, MANAGER = blue, etc. | ☐ |
| 13.12 | Date formats consistent (DD MMM YYYY) | No ISO strings visible to user | ☐ |

---

## 14 — Regression Checks

Run these after every PR merge to `main`.

| # | Check | Expected | Pass? |
|---|-------|----------|-------|
| 14.1 | `npm run test` (backend) passes | All spec files pass; 0 failures | ☐ |
| 14.2 | `npm run build` (backend) succeeds | No TypeScript errors | ☐ |
| 14.3 | `npm run build` (frontend) succeeds | No TypeScript or Next.js errors | ☐ |
| 14.4 | `npm run lint` (backend) clean | 0 errors | ☐ |
| 14.5 | Browser console: no errors on `/dashboard` | 0 console errors | ☐ |
| 14.6 | Browser console: no errors on `/tickets` | 0 console errors | ☐ |
| 14.7 | Browser console: no errors on `/kanban` | 0 console errors | ☐ |
| 14.8 | No 404 links in sidebar | All routes resolve | ☐ |
| 14.9 | No fake success toasts in mutation handlers | Verify all `onError` handlers show error toasts | ☐ |
| 14.10 | localStorage migration runs once on load | `nexus_token` removed; `apex_token` preserved | ☐ |
| 14.11 | `GET /api/health` returns `{ status: "ok", database: "connected" }` | 200 OK | ☐ |
| 14.12 | Seed is idempotent | Running `npx prisma db seed` twice leaves DB unchanged | ☐ |

---

## Sign-off

| Stage | Reviewer | Date | Verdict |
|-------|----------|------|---------|
| Stages 1–4 (core stability) | | | ☐ Pass / ☐ Fail |
| Stage 5 (settings persistence) | | | ☐ Pass / ☐ Fail |
| Stage 6 (DB performance) | | | ☐ Pass / ☐ Fail |
| Stage 7 (branding) | | | ☐ Pass / ☐ Fail |
| Stage 8 (QC system) | | | ☐ Pass / ☐ Fail |

> Issues found during QC must be filed as GitHub issues before marking a stage
> as passed. Minor cosmetic issues may be deferred with written justification.
