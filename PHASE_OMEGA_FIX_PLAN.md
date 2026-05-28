# Phase Ω - Operational UX Convergence Fix Plan

This document outlines the step-by-step implementation plan to resolve the identified operational UX convergence gaps.

---

## 1. Directory Roster Request Persistence
*   **Goal:** Ensure adding team members in the directory displays as "Requested" persistently across page reloads.
*   **Fix:**
    *   Load the requested user IDs from `localStorage` using a key unique to the logged-in user (`requestedIds_${me.id}`) during a `useEffect` hook.
    *   Whenever a request is successfully sent, update the `requestedIds` state and save the updated array to `localStorage`.
*   **File:** `frontend/app/(dashboard)/(operations)/team/page.tsx`

---

## 2. Expose Leave Balance to Employees
*   **Goal:** Ensure employees can easily track their yearly allocation, approved days, and remaining balance at the top of the Leave page, even if they have no current leave requests.
*   **Fix:**
    *   Query the existing backend leave balance API using `leaveApi.getBalance()` on page load.
    *   Add a visual "My Leave Balance" card next to the status cards at the top of `leave/page.tsx`.
*   **File:** `frontend/app/(dashboard)/(operations)/leave/page.tsx`

---

## 3. Team Lead Workload Visibility
*   **Goal:** Enable Team Leads to audit department/team workloads via the Analytics page.
*   **Fix:**
    *   Update `sidebar.tsx` to set `showReports = isTeamLead` (instead of `isManager`), allowing Team Leads to view the Analytics page.
    *   Since the backend workload API is already correctly scoped for Team Leads (showing only their department members), no backend modifications are required.
*   **File:** `frontend/components/layout/sidebar.tsx`
