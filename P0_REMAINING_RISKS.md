# Apex OS — Remaining Risks & System Gaps

Despite completing P0 stabilization, several secondary risks and architecture gaps remain in the codebase. These should be addressed in subsequent development cycles to prepare the platform for production.

---

## 1. High Performance Risk: Database Indexes
The `schema.prisma` file defines models and mappings, but lacks critical database indexes (`@@index`).
* **Risk:** As the number of users, activity logs, and tickets scale to thousands of records, query performance on list filters will degrade exponentially.
* **Affected Areas:**
  - `Ticket` model: queries filtering by `departmentId`, `assignedToId`, `status`, or `createdById`.
  - `Notification` and `LeaveRequest` models: queries filtering by `userId`.
* **Recommendation:** Add explicit index directives to `schema.prisma` in the next DB migration.

---

## 2. Structural/UX Risk: Missing User Detail Page
* **Risk:** The department detail page (`/departments/:id`) lists member rows that link to `/users/:id`. Since the frontend page for `/users/:id` does not exist, clicking a member profile triggers a **404 page not found** error.
* **Affected Areas:** Department directory, team management view.
* **Recommendation:** Build the client-side profile page `app/(dashboard)/(platform)/users/[id]/page.tsx` mapping to `GET /api/users/:id`.

---

## 3. Settings Form Persistence Gaps
* **Risk:** The **Company Settings** tab under the Settings view displays a success toast message when saved, but it does not call the corresponding API endpoint (`settingsApi.updateCompany`). As a result, changes to the company name, theme, or SMTP configurations are discarded on page refresh.
* **Affected Areas:** `/settings` UI, general branding customizability.
* **Recommendation:** Wire the form submit handler to the NestJS settings controller.

---

## 4. Duplicate Scoping Logic (Potential Metric Drift)
* **Risk:** While the main dashboard query utilizes the new `TicketAccessService` queries, smaller dashboard widgets (such as critical alerts, upcoming events, and user metrics) still rely on the legacy `DashboardService.buildRoleScope` and `DashboardService.buildLeaveScope` helpers.
* **Affected Areas:** [dashboard.service.ts](file:///c:/Users/Administrator/Desktop/nexus-app/backend/src/modules/platform/dashboard/dashboard.service.ts).
* **Recommendation:** Completely refactor these helpers to delegate scoping checks directly to the unified access services.

---

## 5. Mocked/Stubbed Services in Local Dev
* **Risk:** High-value features such as **AI Priority Suggestion**, **AI Ticket Summary**, and **Cloudinary Attachments** are gracefully disabled or use local static stubs because API keys/credentials are missing from local configurations.
* **Affected Areas:** Attachment uploads on tickets, AI suggestions drawer.
* **Recommendation:** Establish development-environment credentials and write mock tests for offline coverage.
