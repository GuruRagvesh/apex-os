# User deletion — the relation matrix

**This document explains. It does not decide.**

The classification that actually governs employee deletion lives in code:

| What | Where |
|---|---|
| The classification | `backend/src/modules/platform/archive/user-relation-classification.ts` |
| The guard that enforces it | `backend/test/unit/user-relation-classification.spec.ts` |
| The delete plan it drives | `backend/src/modules/platform/archive/archive-delete.service.ts` |

An earlier version of this file carried all the rules as a hand-maintained
table. It was already wrong when the executable version replaced it: it
described **50 relations across 38 models** when the schema had **45 across
36**, and it had never heard of `AttendanceMonthClose.reopenedBy`, added days
earlier.

That is not a documentation problem. Deletion is irreversible, so a relation
the plan does not know about is a record silently orphaned or destroyed. The
rules moved into code for the same reason the attendance rules did: a list
nothing checks drifts, and nothing notices until it matters.

---

## How a new relation is forced through the guard

```text
somebody adds a User foreign key to schema.prisma
            ↓
user-relation-classification.spec.ts reads the schema and fails
            ↓
they must classify it before the suite is green
            ↓
archive-delete.spec.ts fails until the delete plan handles it
```

Three separate guards, because there are three separate ways to get it wrong:

1. **Unclassified** — in the schema, missing from the classification. The
   deletion would not know what to do with it.
2. **Unplanned** — classified, but no step in the delete transaction handles
   it. It would be skipped: orphaned, or left blocking the delete.
3. **Unachievable** — classified for retention, on a `NOT NULL` column. The
   intent cannot be carried out, and you would discover that mid-deletion.

A fourth guard covers the database doing it behind our backs: every
`onDelete: Cascade` on a User relation must be classified `DELETE_WITH_USER`.
A cascade is the database removing a row with no service involved and nothing
to review it — correct for a membership row, catastrophic for a ticket.

---

## The four actions

| Action | Meaning | Example |
|---|---|---|
| `DELETE_WITH_USER` | Personal or ephemeral. Goes with the person; the Drive archive is the record. | Their own attendance, leave, notifications |
| `RETAIN_AND_NULL_ACTOR` | Company record survives, actor becomes `NULL`. The identity adds nothing once they are gone. | An unassigned ticket is simply unassigned |
| `RETAIN_WITH_SNAPSHOT` | Company record survives **and keeps a readable identity**, because a blank would make it unanswerable. | "Who approved this payroll month" |
| `BLOCK_DELETE` | Refused until a human resolves it. An operational gap, not a tidy null. | A team with no lead |

Current counts come from the schema, and the spec pins them so a silent
reclassification — a record quietly moving from retained to deleted — fails:

```
45 relations across 36 models
    22  DELETE_WITH_USER
    15  RETAIN_WITH_SNAPSHOT
     5  RETAIN_AND_NULL_ACTOR
     3  BLOCK_DELETE
```

---

## Why attribution is a table and not forty-five columns

`RETAIN_WITH_SNAPSHOT` needs the former employee's identity to survive on
fifteen relations. The obvious implementation is three snapshot columns —
`formerActorName`, `formerActorEmployeeId`, `formerActorRole` — on each table
needing them.

That is the same three facts written forty-five times, free to disagree with
itself, with nothing to notice if one copy were written wrong.

Instead there is one `FormerEmployee` row per deleted person, and fifteen
nullable pointers to it. It is deliberately **not** a `User`: no email, no
password, no role grant, no login. A gravestone, not a disabled account —
nothing can authenticate as it or be assigned work. Its foreign keys are
`ON DELETE RESTRICT`, because deleting a tombstone while a ticket still points
at it would recreate the problem it exists to solve.

---

## Why `onDelete: Cascade` was rejected for the rest

It would have been less work: let the database remove everything that
references the user, and `user.delete()` just works.

It would also delete the company's tickets, comments, time logs and audit
trail because one person left. The work survives the worker; that is the
single most important property of the whole feature.

What exists today instead is the opposite accident: Prisma defaults a required
relation to `Restrict`, so before Migration A `user.delete()` **failed** on
anyone who had ever created a ticket. Safe, but it meant retention was
impossible — hence the ten columns widened to accept `NULL`.

---

## The four things a human must resolve first

`BLOCK_DELETE` is not an error to work around. Each is something that would
quietly stall:

| Relation | What would break | Resolution |
|---|---|---|
| `Team.teamLead` | A team with no lead | Assign a new lead |
| `EmployeeProfileChangeRequest.currentApprover` | An approval stalls forever | Reassign or resolve it |
| `Lead.owner` | Pipeline with no owner | Reassign the lead |

The service checks each and returns the resolution text with the refusal, so
an administrator is told what to do rather than only that they cannot proceed.
A test asserts the enforced list matches the classified list exactly — a rule
with no check would be describing a protection that does not exist.
