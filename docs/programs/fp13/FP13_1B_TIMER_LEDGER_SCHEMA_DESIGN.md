# FP-13.1B Timer Ledger Schema Design

## B. Required Ledger Models

### 1. `TicketTimeLog`
A highly granular table capturing exact chronological periods of effort mapped against the ticket.

**Proposed Schema:**
```prisma
model TicketTimeLog {
  id              String    @id @default(cuid())
  ticketId        String
  userId          String
  stage           String    // e.g., 'WORK', 'REVIEW', 'REWORK', 'BLOCKED'
  ownerType       String    // e.g., 'ASSIGNEE', 'REVIEWER', 'SYSTEM'
  source          String    // e.g., 'SYSTEM', 'MANUAL', 'WORKDAY'
  startedAt       DateTime
  endedAt         DateTime?
  durationMinutes Int?      // Derived upon endAt
  pauseReason     String?   // E.g., 'BREAK', 'LOGOUT', 'BLOCKED'
  workSessionId   String?   // Link to workday session
  breakLogId      String?   // Link to break log if paused by break
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  ticket      Ticket       @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  user        User         @relation(fields: [userId], references: [id])
  workSession WorkSession? @relation(fields: [workSessionId], references: [id])
  breakLog    BreakLog?    @relation(fields: [breakLogId], references: [id])

  @@index([ticketId])
  @@index([userId])
  @@index([startedAt])
  @@index([workSessionId])
}
```

### 2. `ReviewCycleLog`
Captures macro-level iterations between reviewers and workers.

**Proposed Schema:**
```prisma
model ReviewCycleLog {
  id                  String    @id @default(cuid())
  ticketId            String
  cycleNo             Int       @default(1)
  assigneeId          String
  reviewerId          String
  reviewStartedAt     DateTime
  reviewEndedAt       DateTime?
  decision            String?   // 'APPROVED', 'REWORK', 'REJECTED'
  feedback            String?
  assigneeWorkMinutes Int?      // Sum of TicketTimeLog minutes for this cycle
  reviewerWorkMinutes Int?
  reworkStartedAt     DateTime?
  reworkEndedAt       DateTime?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  ticket   Ticket @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  assignee User   @relation("CycleAssignee", fields: [assigneeId], references: [id])
  reviewer User   @relation("CycleReviewer", fields: [reviewerId], references: [id])

  @@index([ticketId])
  @@index([cycleNo])
}
```

### 3. Enum vs String Tradeoffs
**Stage / OwnerType Options:** 
- **String:** Highly flexible. Prevents downtime and complex database locks when adding new states (e.g. `QA`, `MEETING`). 
- **Enum:** Type-safe at the DB level, preventing bad string insertions, but requires DB-level `ALTER TYPE` which carries migration risk on Postgres and can crash live pipelines if rolled back poorly.
**Recommendation:** Use `String` mapped strictly via TypeScript Application-level Enums (e.g., `enum LogStage { WORK = 'WORK' }`). This is safest for V1 and prevents migration-related friction.

### 4. Ticket Fields
- Add `reworkCount Int @default(0)` to `Ticket` to rapidly display rework cycles on the Kanban without joining `ReviewCycleLog`.

## C. Relationship to Existing Fields

1. **Should existing Ticket timestamp fields remain?**
   Yes. `executionDueAt`, `actualStartAt`, `isBlocked` should remain untouched to prevent destroying current read/write UI paths.
2. **Which fields become derived?**
   `actualTime` / `totalWorkTime` will eventually be derived by summing `durationMinutes` from `TicketTimeLog`.
3. **Which fields remain for quick UI display?**
   `executionDueAt` and `isBlocked` remain critical for quick UI querying without heavy JOINS.
4. **Which fields are historical truth?**
   The `TicketTimeLog` and `ReviewCycleLog` tables become the unassailable chronological truth.
5. **Should TicketTimeLog be the source of truth for productive time?**
   Yes. Analytics should run off `TicketTimeLog` entirely.
6. **Should executionDueAt/reviewDueAt remain SLA deadlines?**
   Yes, but their mutation behavior will change later to dynamically extend when valid pauses occur.
7. **Should pause/resume mutate executionDueAt, or should paused durations be calculated from logs?**
   **Recommendation:** Mutate `executionDueAt` forward upon timer *resume*. This keeps the lightweight querying in `ticket-timing.service.ts` working seamlessly for the dashboard, while `TicketTimeLog` safely records *why* the due date shifted.
8. **How should blocked tickets interact?**
   A blocked ticket terminates the active `WORK` log and potentially creates a `BLOCKED` log or just leaves a void until unblocked. 
9. **How should Workday BreakLog relate to TicketTimeLog?**
   When a `BreakLog` opens, any active `TicketTimeLog` for that user closes with `pauseReason = 'BREAK'`, populated with `breakLogId`. When the break ends, a new `TicketTimeLog` initiates.

## What NOT to change yet
- Do NOT run prisma migrate.
- Do NOT rewrite `tickets.service.ts` to populate these tables yet.
- Do NOT drop old timestamp fields on `Ticket`.
