# FP15B Hierarchy Request Modal UX Report

## Objective
Enhance the FP-15B hierarchy change request workflow within the existing Employee Profile page, providing a polished and dynamic modal experience without altering backend rules, email services, or other module pages.

## Implemented Changes

### Profile Page Enhancement (`frontend/app/(dashboard)/profile/page.tsx`)
- **Modal Introduction:** Replaced basic form logic with a polished, modal-based UX.
- **Request Type Cards:** Users now select the type of change they want via interactive button cards mapped seamlessly to backend Enums (e.g., `DEPARTMENT_CHANGE`).
- **Dynamic Input Rendering:**
  - **Departments:** Renders a dropdown sourced live from `departmentsApi.getAll()`.
  - **Managers (Reporting & Primary):** Renders a dropdown of actual users via `usersApi.getAll()`.
  - **Roles:** Pulled directly from `rolesApi.getAll()`, accompanied by an administrative warning.
  - **Multi-field Changes:** Allows for adding and removing multiple dynamic rows before submitting.
- **Preview & Routing:**
  - Displays a visual transition snippet showing the `Old Value → New Value`.
  - Exposes the expected approval chain (e.g. `Employee → Team Lead → Manager`).
- **Validations:** Prevents submission if fields are incomplete or if the "New Value" perfectly matches the "Old Value".
- **Clean Naming:** Translated enum statuses (`PENDING_TL_APPROVAL`) into human-readable tags ("Pending Team Lead Approval").

### Approvals Inbox Polish (`frontend/app/(dashboard)/admin/approvals/page.tsx`)
- **Data Mapping Enhancement:** Instead of raw IDs, the UI now fetches `departments`, `users`, and `roles` dynamically so approvers see the human-readable names for both the old value and the newly requested value.
- **Design Cleanup:** Brought the UI up to standard with white backgrounds, rounded borders, clean typography, and clearly differentiated "Approve" (Green) and "Reject" (Red) buttons with Lucide icons.

## Non-Impact Scope
- **Backend Rules:** Untouched.
- **Notification Services:** OTP/Resend mechanisms untouched.
- **Core Modules:** Tickets, projects, and analytics left exactly as they were.
