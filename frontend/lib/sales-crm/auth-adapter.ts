"use client";

// Sales CRM — Apex-to-intern auth adapter
//
// Ported intern components (Topbar, LeadDetail, ActivityModal, permission
// checks, etc.) all call useAuth() expecting intern's own shape:
// { user, isAuthenticated, isLoading, login, logout }, with `user.role`
// being intern's Role enum. This adapter exposes that exact shape while
// reading from Apex OS's real auth store (frontend/store/auth.store.ts) —
// it never reads or writes intern's own "salescrm_auth" key, and it never
// mounts intern's mock login/AuthProvider.
//
// The outer route gate (frontend/app/(workspaces)/sales-crm/layout.tsx)
// is what actually enforces authentication + Admin/SuperAdmin access
// before any Sales CRM content renders. By the time a component reaches
// for this adapter, the user is already really authenticated — login()
// here exists only so intern components that reference it don't crash;
// it is a deliberate no-op, not a second auth path.

import { useAuthStore } from "@/store/auth.store";
import { Role, User as CrmUser } from "./types";

const APEX_TO_CRM_ROLE: Record<string, Role> = {
  SUPER_ADMIN: Role.SUPERADMIN,
  ADMIN: Role.ADMIN,
  MANAGER: Role.MANAGER,
  TEAM_LEAD: Role.TL,
  EMPLOYEE: Role.EMPLOYEE,
  INTERN: Role.EMPLOYEE,
};

function mapApexRoleToCrmRole(apexRoleName: string | undefined): Role {
  if (apexRoleName && apexRoleName in APEX_TO_CRM_ROLE) {
    return APEX_TO_CRM_ROLE[apexRoleName];
  }
  // Unknown/missing Apex role: fail closed to the lowest-privilege CRM role
  // rather than guessing upward.
  return Role.EMPLOYEE;
}

export interface UseAuthResult {
  user: CrmUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (user: CrmUser) => void;
  logout: () => void;
}

export function useAuth(): UseAuthResult {
  const { user: apexUser, isAuthenticated, hasHydrated, logout: apexLogout } = useAuthStore();

  const user: CrmUser | null = apexUser
    ? {
        id: apexUser.id,
        name: apexUser.name,
        email: apexUser.email,
        role: mapApexRoleToCrmRole(apexUser.role?.name),
        avatarUrl: apexUser.photoUrl || apexUser.avatar,
      }
    : null;

  return {
    user,
    isAuthenticated,
    // Mirrors the outer route gate's own hasHydrated check — until the
    // persisted Apex auth store has rehydrated, treat CRM auth as loading
    // rather than momentarily flashing "unauthenticated".
    isLoading: !hasHydrated,
    login: () => {
      // Intentional no-op — see module doc comment. Real login happens
      // through Apex's own /login page before a user ever reaches
      // /sales-crm; this adapter does not create a second auth path.
    },
    logout: () => {
      // Reuses Apex's real logout action (clears the real session). Does
      // not redirect on its own — callers (e.g. the ported Topbar) decide
      // navigation after logout, same as the intern source's own call sites.
      apexLogout();
    },
  };
}
