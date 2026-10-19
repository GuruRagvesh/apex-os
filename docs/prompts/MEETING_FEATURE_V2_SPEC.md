# Meeting feature v2: spec (final draft)

Status: under review, nothing built. Draft 3 adds your second set of answers (17 Oct): collaborators
join through an invite popup, the meeting screen has two buttons, and there is no time limit. Open
questions are in section 8.

The current flow (new or join by ID, meeting codes) is removed and replaced by the flow below.

---

## 1. The idea in one line

A meeting has **who created it**, a **type** (decides the rules: who may create it, which people can be
picked, who approves), an optional **purpose tag**, and a **collaborator list** built with one flexible
picker. A picker can cover every combination (1 person, 2 managers + admin, a whole other department,
two departments plus a client), so we don't need a separate form for each case.

## 2. The form (opens when you press "Meeting")

| Field | Notes |
|---|---|
| **Agenda** | Required. |
| **Meeting type** | One-on-one · Internal · External · Custom. Internal is shown to Team Leads and Managers, and to employees with only "Departmental meeting" inside (answer 1). |
| **Purpose** | Review · Planning · Training / knowledge share · Client · Status update · Other. Used later in reports and Team insights. |
| **Collaborators** | The picker in section 3. Pre-filled where the type allows (for example your TL and manager for Internal). |
| **Client / outside guests** | External and Custom only: free-text names, and a company name for clients. |
| **Approval goes to** | Always visible before saving, with "Change" when the default approver is away. |

## 3. The collaborator picker (covers all the cases)

```text
┌──────────────────────────────────────────────────────────────┐
│ Quick add:  [My TL] [My manager] [Admin] [Whole department]  │
│ Departments: ☑ AI & R&D  ☐ QC Team  ☐ Content   (multi)      │
│ Roles:       ☑ Manager ☑ Team Lead ☑ Employee ☐ Intern       │
│ Search: [ type a name…                                    ]   │
│ ─────────────────────────────────────────────────────────── │
│ ☑ Aniket Phapale · Team Lead · QC Team                       │
│ ☐ Riya Deshmukh · Employee · QC Team                         │
│ ☑ Payal · Manager · Accounts                                 │
│ Selected (3): Aniket ✕  Payal ✕  Pavan (Admin) ✕             │
└──────────────────────────────────────────────────────────────┘
```

- **Departments** is a tick-box list (pick several). **Roles** filters who appears. **Search** finds anyone in scope.
- **Quick add** buttons cover the common cases in one click. "Whole department" ticks everyone in the chosen departments.
- **Admin** appears only when the type allows it, and is selected only when you tick it (answer 8).
- The selected people stay visible as chips, so the list always shows exactly who attends.

**What the picker allows, per type:**

| Type | Who can create | People shown in the picker | How many |
|---|---|---|---|
| **One-on-one** | Anyone | Your department (incl. its TL and manager) | Exactly **1** |
| **Internal** | TL, Manager; employees only as "Departmental meeting" | Your department (incl. TL, manager). Admin when ticked. | 2 or more |
| **External** | Anyone | Any department(s) you tick, plus your own, plus Admin when ticked, plus outside guests or clients | 1 or more |
| **Custom** | Anyone | **Anyone in the company**, plus outside guests | Any. Used for exceptions like "me + my manager + admin" (answer 2) |

This covers your examples:
- employee ↔ employee → One-on-one
- employee ↔ manager → One-on-one
- employee + admin + manager → Custom (or Internal for a TL or Manager)
- an employee explaining something to another whole department → External → tick that department → "Whole department"
- two departments' people + a client → External → tick both departments + add the client
- 2–3 managers + admin + 2–3 TLs → Internal (TL or Manager creator) or Custom
- a review meeting → any type with Purpose = Review

## 4. Approval

| Situation | Approver |
|---|---|
| Employees / interns from one department meet | That department's **Team Lead**; if unavailable → its **Manager**; if unavailable → **Admin** |
| Department A and Department B meet | One eligible leader for **A and B separately**. Both approvals are required. |
| One employee from A meets the whole of B | A's Team Lead and B's Team Lead; use the Manager/Admin fallback independently for either department. |
| A Team Lead conducts their departmental meeting | Their **Manager**; a creator never approves their own meeting. |
| A Manager conducts their departmental meeting | **Admin** |
| Senior people attend | Every attending Team Lead, Manager, Admin or Super Admin is included as a required validator, except the organizer. |
| Client-only meeting | The creator's **Manager**; if unavailable → Admin. |
| Leader is on approved leave | Skip that leader and move upward: Team Lead → Manager → Admin → Super Admin. Never silently self-approve. |
| Several valid people have the same designation | The form recommends one and lets the creator choose an eligible name. |

- The meeting **starts straight away**; approval never blocks it from starting.
- Required approvers receive an immediate information notification that a meeting started.
- After it ends, each required approver sees the agenda, type, purpose, attendees and duration, then approves or rejects the recorded time.
- Each department has its own approval response. The meeting is confirmed only after **all required approvers approve**. One rejection rejects the validation.
- Before starting, the form always shows **Send for approval to**, with designation and name filters. The server independently checks that every represented department remains covered.

## 5. Joining and during the meeting

### Creator
- Saving the form **starts the meeting** for the creator. Their work and ticket timers pause.

### Collaborators get an invite popup
- Each collaborator gets a **notification**, plus a popup: **"{Creator} added you to '{Agenda}'. Join the meeting?"** with **Approve** and **Reject**.
  - **Approve** → their work pauses and the full meeting screen opens for them. Their meeting time is counted from the moment they approve.
  - **Reject**, or no answer → the meeting is **not recorded for them**, and their workday is not touched.
- This applies to every collaborator, whether working, on break or not punched in.

### The meeting screen (full-screen freeze)
- A large **green, pulsing "Meeting in progress"** label, with the agenda, timer and who has joined.
- **Two buttons only** in the middle:
  1. **Back to Apex:** hides the screen. The meeting keeps running, and the hero's **Meeting** button turns **red with pulsing rings** until it ends. Click it to come back.
  2. **Resume work:** ends the meeting **for you**, records your meeting time, and restarts your work timer.
- No time limit. A meeting runs until the person ends it with Resume work (answer 6).

### After the meeting
- The approver (section 4) gets a notification and approves or rejects the meeting.
- If the approver **rejects**, the time stays as working time but is not counted as productive (answer 5).

## 6. Edge cases already handled in the design

| Case | Behaviour |
|---|---|
| Collaborator not punched in, on break or on leave | They still get the invite. If they don't approve, nothing is recorded for them. |
| Collaborator is already in another meeting | Shown greyed out with "In a meeting". They can't be added. |
| Creator has no Team Lead | Approval goes to the Manager automatically. |
| Manager owns 2–3 departments | The approver is the manager of the creator's department. |
| Meeting still running at End Day | End Day first ends the meeting and records it, then ends the day. There is no automatic time limit. |
| Meeting still running at the auto-close time | **Auto-close is frozen while you are in a meeting:** no auto-close prompt and no forced close. When the meeting ends, the normal auto-close rules apply again (see section 9). |
| Someone presses Meeting during a break | The break ends first, then the meeting starts. |
| Page refresh or closed tab during a meeting | The meeting keeps running on the server. The overlay or red button comes back on reopen. |
| Duplicate meeting | The same person can't start a second meeting while one is running. |
| Old meetings (current flow) | Kept in history and reports (answer 10). |

---

## 7. Decisions (17 Oct)

| # | Decision |
|---|---|
| Custom approval | Attending seniors plus an eligible leader for every otherwise-uncovered department. All required approvals must be completed. |
| Purpose tag | Yes. |
| Collaborators | They get a notification and a Join popup with Approve / Reject. It is recorded for them only if they approve. |
| Collaborator didn't attend | They reject in the popup. The creator can cancel the meeting for everyone. |
| Approver rejects afterwards | The time counts as working time, not productive. |
| Time limit | None. The meeting ends when the person clicks Resume work. |
| Notifications | Yes. |
| One-on-one outside your department | Not allowed. Use External or Custom. |
| Meeting screen | Only **Back to Apex** and **Resume work**. Approve / Reject live in the invite popup. |

## 8. Final answers (17 Oct)

| # | Decision |
|---|---|
| Custom or cross-department meeting with several required approvers | Every required department/senior has an independent response. All must approve; one rejection rejects the validation. |
| Creator cancelling a meeting that never happened | A small **"Cancel meeting"** link under the two buttons on the meeting screen. |
| Creator clicks Resume work | The meeting ends **only for the creator**. Every other attendee ends their own. |

## 9. Auto-close and the end-of-day reminder

**What Apex does today (checked in the code and in your local settings):**
- The company **auto-close time** is set under Settings → Workday policy. On your local copy it is **9:00 PM** (normal hours are 9:30 AM–6:30 PM; Team Leads leave between 6:30 and 7:30 PM).
- From that time, anyone still working sees an **"End your workday?"** popup. If they close it, it **doesn't come back**. Later, the server closes the workday automatically once there's no recent activity.

**New behaviour:**
1. **During a meeting:** auto-close is **frozen**. No popup, and the server never auto-closes a workday that has a running meeting, even past midnight.
2. **When the meeting ends** (Resume work), the normal rules apply. If it's already past the auto-close time, the reminder starts straight away.
3. **The end-of-day reminder repeats every 10 minutes** after the auto-close time, as both a popup and a notification, until the person clicks **End Day** or **Keep working**. "Keep working" snoozes it for 10 minutes. It doesn't turn it off.
4. **End Day during a meeting** ends the meeting first (it's recorded), then ends the day.
