# FP-14A — PROJECT MODULE V2 — DATA MODEL + API PLAN
**Date:** 2026-06-02
**Status:** PLANNING ONLY — No migrations created

---

## SECTION A — PROPOSED DATA MODELS

### A1. `ProjectStage` ⭐ Most critical new model

**Purpose:** Define the lifecycle phases of a project (Discovery, Design, Development, Testing, Deployment, etc.)

**Proposed fields:**
```prisma
model ProjectStage {
  id          String   @id @default(cuid())
  projectId   String
  name        String                      // "Discovery", "Development", etc.
  description String?
  order       Int      @default(0)        // for drag-reorder
  status      ProjectStageStatus @default(PLANNED)  // PLANNED | ACTIVE | COMPLETED | SKIPPED
  color       String?                     // hex color for UI
  startDate   DateTime?
  endDate     DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  project  Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  tickets  Ticket[] @relation("TicketStage")  // if adding Ticket.stageId

  @@index([projectId])
  @@index([projectId, order])
  @@map("project_stages")
}

enum ProjectStageStatus {
  PLANNED
  ACTIVE
  COMPLETED
  SKIPPED
}
```

**Migration risk:** LOW — new table, no changes to existing tables
**Required for:** FP-14E (lifecycle), FP-14D (stage kanban), FP-14F (Gantt)
**Phase:** FP-14B (schema migration)

---

### A2. `ProjectDocument`

**Purpose:** Store metadata for documents attached to a project (specs, designs, meeting notes)

**Proposed fields:**
```prisma
model ProjectDocument {
  id           String   @id @default(cuid())
  projectId    String
  uploadedById String
  filename     String
  url          String                     // Cloudinary ref or base64 fallback (same as Attachment)
  size         Int?
  mimeType     String?
  category     String   @default("OTHER") // SPEC | DESIGN | MEETING | REPORT | OTHER
  createdAt    DateTime @default(now())

  project    Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  uploadedBy User    @relation(fields: [uploadedById], references: [id])

  @@index([projectId])
  @@map("project_documents")
}
```

**Migration risk:** LOW — new table, no changes to existing tables
**Required for:** FP-14H (documents tab)
**Phase:** FP-14B or FP-14H (can defer)

---

### A3. `ProjectMilestone`

**Purpose:** Mark key milestone dates on the project timeline/Gantt

**Proposed fields:**
```prisma
model ProjectMilestone {
  id          String   @id @default(cuid())
  projectId   String
  stageId     String?                     // optional: anchor to a stage
  name        String
  description String?
  targetDate  DateTime
  completedAt DateTime?
  createdAt   DateTime @default(now())

  project Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  stage   ProjectStage?  @relation(fields: [stageId], references: [id])

  @@index([projectId])
  @@map("project_milestones")
}
```

**Migration risk:** LOW — new table
**Required for:** FP-14F (Gantt view)
**Phase:** FP-14F (can defer until Gantt)

---

### A4. `Ticket.projectStageId` field addition

**Purpose:** Link a ticket to a specific project stage (for stage-grouped Kanban)

**Proposed change to existing Ticket model:**
```prisma
// Add to Ticket model:
projectStageId String?
projectStage   ProjectStage? @relation("TicketStage", fields: [projectStageId], references: [id])
```

**Migration risk:** LOW — nullable field, additive only
**Required for:** FP-14D (stage kanban)
**Phase:** Same migration as ProjectStage

---

### A5. `ProjectMemberRole` enum (formalization)

**Purpose:** Replace freeform `ProjectMember.role String` with a proper enum

**Current issue:** `role` is a plain string — no validation, any value can be stored

**Proposed enum:**
```prisma
enum ProjectMemberRole {
  OWNER
  LEAD
  DEVELOPER
  REVIEWER
  OBSERVER
  MEMBER
}
```

**Migration risk:** MEDIUM — requires migrating existing String data to enum values
**Recommendation:** Add enum but keep backward compat. Run data migration that maps existing values.
**Phase:** FP-14B (careful)

---

### A6. `ProjectStatus` — add ARCHIVED (optional)

**Purpose:** Soft-archive instead of hard-delete. Preserves all project history.

**Current enum:** `ACTIVE | ON_HOLD | COMPLETED | CANCELLED`
**Proposed addition:** `ARCHIVED`

**Migration risk:** LOW — additive enum value
**Phase:** FP-14B

---

### A7. DEFERRED / Future models

| Model | Purpose | When |
|---|---|---|
| `ProjectHealthSnapshot` | Periodic health score history for trend charts | FUTURE |
| `ProjectRisk` | Risk register (likelihood, impact, mitigation) | FUTURE |
| `ProjectDependency` | Inter-project or inter-stage dependency links | FUTURE |
| `ProjectUpdate` | Manager status updates / announcements | FUTURE |

---

## SECTION B — PROPOSED API ENDPOINTS

### B1. Stage CRUD (FP-14E)

| Method | Endpoint | Purpose | Role |
|---|---|---|---|
| GET | /projects/:id/stages | List all stages for project | Member+ |
| POST | /projects/:id/stages | Create new stage | TL+ |
| PATCH | /projects/:id/stages/:stageId | Update stage (name, dates, status, order) | TL+ |
| DELETE | /projects/:id/stages/:stageId | Delete stage | Manager+ |
| PATCH | /projects/:id/stages/reorder | Bulk reorder stages | TL+ |

**Response shape (GET list):**
```json
[{ "id": "cuid", "name": "Discovery", "order": 0, "status": "ACTIVE",
   "startDate": "...", "endDate": "...", "ticketCount": 5, "completedTickets": 2 }]
```

---

### B2. Member role update (FP-14B)

| Method | Endpoint | Purpose | Role |
|---|---|---|---|
| PATCH | /projects/:id/members/:userId | Update member role | TL+ |

**Request:** `{ "role": "LEAD" }`
**Response:** Updated `ProjectMember` record

---

### B3. Project-scoped activity (FP-14B — quick win)

| Method | Endpoint | Purpose | Role |
|---|---|---|---|
| GET | /projects/:id/activity | Events where entityId=project.id or related ticket | Member+ |

**Query params:** `?limit=50&before=<cursor>`
**Note:** Reuses existing `OperationalEvent` — only a new filtered query, no new model

---

### B4. Documents (FP-14H)

| Method | Endpoint | Purpose | Role |
|---|---|---|---|
| GET | /projects/:id/documents | List project documents | Member+ |
| POST | /projects/:id/documents | Upload document (multipart) | TL+ |
| DELETE | /projects/:id/documents/:docId | Delete document | TL+ or uploader |

**Reuses:** `UploadsService` pattern from ticket attachments

---

### B5. Project dashboard / analytics (FP-14G)

| Method | Endpoint | Purpose | Role |
|---|---|---|---|
| GET | /analytics/project/:id | Project-specific KPIs | Member+ |

**Response:**
```json
{
  "ticketVelocity": 3.2,
  "completionRate": 67,
  "blockedCount": 1,
  "averageCompletionTimeSeconds": 7200,
  "memberContributions": [],
  "ticketTrend": []
}
```

---

### B6. Timeline (FP-14F)

| Method | Endpoint | Purpose | Role |
|---|---|---|---|
| GET | /projects/:id/timeline | Stages + milestones for Gantt | Member+ |

**Response:**
```json
{ "stages": [...], "milestones": [...], "projectStartDate": "...", "projectEndDate": "..." }
```

---

### B7. Milestone CRUD (FP-14F)

| Method | Endpoint | Purpose | Role |
|---|---|---|---|
| GET | /projects/:id/milestones | List milestones | Member+ |
| POST | /projects/:id/milestones | Create milestone | TL+ |
| PATCH | /projects/:id/milestones/:mid | Update milestone | TL+ |
| DELETE | /projects/:id/milestones/:mid | Delete milestone | Manager+ |

---

### B8. AI endpoints (FP-14J — future)

| Method | Endpoint | Purpose | Role |
|---|---|---|---|
| POST | /projects/:id/ai/workflow | Generate stage/ticket suggestions | Manager+ |
| POST | /projects/:id/ai/classify-ticket | Suggest stage for a ticket | TL+ |

**Note:** Returns suggestions only — user must explicitly apply. Never auto-modifies data.

---

## MIGRATION ORDER (safest sequence)

1. **FP-14B migration 1:** Add `ProjectStage`, `Ticket.projectStageId`, `ProjectStatus.ARCHIVED`, formalize `ProjectMemberRole` enum
2. **FP-14H migration:** Add `ProjectDocument`
3. **FP-14F migration:** Add `ProjectMilestone`
4. **Future:** `ProjectHealthSnapshot`, `ProjectRisk`, `ProjectDependency`
