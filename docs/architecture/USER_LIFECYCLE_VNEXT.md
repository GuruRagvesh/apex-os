# User lifecycle — next iteration

**Nothing here is implemented, and nothing here should be implemented as part
of the current production push.** This records requirements so they are not
lost, and so the one real contradiction among them is resolved deliberately
rather than discovered halfway through building.

The current release ships Archive & Delete as a one-way operation, switched
off by default. Everything below changes the identity model itself, which is
why it is a separate track.

---

## 1. User Profile becomes the universal identity

One profile is the identity a person has across Apex OS, rather than
attendance, tickets, leave and HR each resolving a person their own way.

## 2. One person, several department memberships

Today somebody working across two departments tends to get two accounts. That
is the wrong shape: it splits their attendance, their tickets and their leave
balance between two identities that no report joins back together.

The cleaner model is **one account with multiple department memberships**.
`UserDepartmentMembership` already exists and is already a join table, so the
data model is closer to this than the product is.

Note the consequence for scoping: manager access is currently resolved
through `managedDepartmentIds`, and a person in two departments makes
"is this employee on my team" a question with two answers. Every scoped read
and every scoped write — including Comp Off grant and extension — would need
re-examining.

## 3. A deleted identity must not permanently block a new account

`User.email` is unique across the whole table. Once Archive & Delete removes
the row the address is free again, which is correct — but if a recycle bin or
a soft-delete arrives, a retained row would hold that address forever and the
same person could never be re-onboarded with their own email.

The rule to aim for: **unique among ACTIVE accounts**, not unique for all
time.

## 4. Recycle bin, 30 days

A deleted employee recoverable for 30 days without touching the Drive
archive.

## 5. Full restore during the recycle period

Within those 30 days, restoring should bring back the account and its
relationships as they were — not a fresh user with the same name.

## 6. Long-term rehire restore from the Drive archive

Re-creating a former employee a year later, from the archive, when they
return.

---

## 7. THE CONTRADICTION THAT MUST BE RESOLVED FIRST

Requirements 4 and 6 are in direct conflict, and building either one without
deciding between them produces a system that quietly cannot do the other.

> If everything is permanently purged after 30 days, there is nothing left to
> restore from a year later.

Two coherent answers, and the choice is a product and compliance decision,
not a technical one:

**A. Purge from active storage, keep the Drive archive.** The 30 days governs
how long a *cheap, complete* restore is available. After that the archive
remains and a rehire is a slower, partial reconstruction. Retains statutory
payroll records, which Indian compliance requires for years. **This is the
only option compatible with requirement 6.**

**B. Genuinely destroy everything at 30 days, archive included.** The
strongest privacy position and the simplest promise to make to an employee.
It removes long-term rehire restore entirely, and it conflicts with payroll
record retention obligations — those would need a separate, narrower store.

Decide A or B **before** building the recycle bin, because the retention
semantics shape the schema, and discovering the conflict after the fact means
rebuilding it.

## 8. Company history stays readable regardless

Whatever is decided above, the property the current release establishes must
survive it: a ticket raised, a comment written, a payroll month approved and
an audit event recorded all remain readable after the person is gone.

`FormerEmployee` already provides that, and a recycle bin must not undermine
it — in particular, restoring a user must not leave records pointing at a
tombstone for somebody who now exists again. Reconciling tombstone and
restored identity is part of the work, not an afterthought.

---

## What exists today, for whoever picks this up

| Thing | Where |
|---|---|
| Relation classification (45 FKs) | `backend/src/modules/platform/archive/user-relation-classification.ts` |
| Archive collector | `backend/src/modules/platform/archive/employee-archive-collector.service.ts` |
| Drive storage + verification | `backend/src/modules/platform/archive/storage/` |
| The destructive workflow | `backend/src/modules/platform/archive/archive-delete.service.ts` |
| Tombstone + ledger | `FormerEmployee`, `EmployeeDeletionLedger` in `schema.prisma` |
| Feature gate | `employee_lifecycle.archiveDeleteEnabled`, default **false** |

The guard in `user-relation-classification.spec.ts` will fail the moment a
new User foreign key appears without a classification. Any identity work
below will trip it, which is intended: a new relation needs a deletion
decision before it ships.
