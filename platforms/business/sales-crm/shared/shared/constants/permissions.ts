// Sales CRM — Centralized Role & Permission Engine
// Ported from intern source (src/lib/permissions.ts). Pure functions, no
// hooks, no side effects. This governs in-module record-level permissions
// only (edit own lead vs. any lead, etc.) — it is NOT the app access gate.
// Real workspace access control is Apex OS's own Admin/SuperAdmin auth gate.

import { Role } from "../types";

// ---------------------------------------------------------------------------
// 1. Overall CRM Permissions
// ---------------------------------------------------------------------------

/** Import is allowed for all roles. */
export function canImport(role: Role): boolean {
  void role;
  return true;
}

/** Export is allowed only for Superadmin and Admin. */
export function canExport(role: Role): boolean {
  return role === Role.SUPERADMIN || role === Role.ADMIN;
}

/** All roles can add records. */
export function canAddRecord(role: Role): boolean {
  void role;
  return true;
}

/** All roles can edit their own records. S and A can edit anyone's records. */
export function canEditRecord(
  role: Role,
  recordOwnerId: string,
  currentUserId: string
): boolean {
  if (role === Role.SUPERADMIN || role === Role.ADMIN) return true;
  return recordOwnerId === currentUserId;
}

/** Delete is allowed only for Superadmin and Admin. */
export function canDeleteRecord(role: Role): boolean {
  return role === Role.SUPERADMIN || role === Role.ADMIN;
}

// ---------------------------------------------------------------------------
// 2. Lead-Specific Permissions
// ---------------------------------------------------------------------------

/**
 * Only the current/existing owner of a lead can change ownership.
 * S and A do NOT get an override here — the matrix says "only if current owner"
 * for every role.
 */
export function canChangeLeadOwner(
  currentUserId: string,
  leadOwnerId: string
): boolean {
  return currentUserId === leadOwnerId;
}

/**
 * Contact fields (email, phone, WhatsApp, poc name, designation, alternate
 * contact) are visible to:
 *   - The lead creator/owner (all roles)
 *   - Superadmin and Admin (for any lead)
 *
 * For M, TL, E viewing a team/cross-team lead → hidden.
 */
export function isContactFieldVisible(
  role: Role,
  leadOwnerId: string,
  currentUserId: string
): boolean {
  if (role === Role.SUPERADMIN || role === Role.ADMIN) return true;
  return leadOwnerId === currentUserId;
}

/** The set of lead field keys that are considered "contact" fields. */
export const CONTACT_FIELDS: readonly string[] = [
  "email",
  "phone",
  "poc",
  "designation",
  "linkedin",
  "whatsapp",
  "alternate_contact",
] as const;

// ---------------------------------------------------------------------------
// 3. Deal-Specific Permissions
// ---------------------------------------------------------------------------

/**
 * Deal money visibility:
 *   - S, A, M → can always see deal amount
 *   - TL → own deals + same-department/team deals (until department mapping
 *     is available, non-own deals are treated as cross-team → hidden)
 *   - E → own deals only
 *
 * @param isSameDepartment  Set to `true` when department mapping is available
 *   and the deal belongs to a user in the same department. Default `false`
 *   (treats non-own deals as cross-team).
 */
export function isDealMoneyVisible(
  role: Role,
  dealOwnerId: string,
  currentUserId: string,
  isSameDepartment: boolean = false
): boolean {
  if (role === Role.SUPERADMIN || role === Role.ADMIN || role === Role.MANAGER)
    return true;

  // Own deal — always visible
  if (dealOwnerId === currentUserId) return true;

  if (role === Role.TL) {
    // TL can see team (same-department) deal amounts
    return isSameDepartment;
  }

  // Employee — only own deals
  return false;
}

/** All roles can add deals. */
export function canAddDeal(role: Role): boolean {
  void role;
  return true;
}

/** Own deal: all roles. Others' deals: S and A only. */
export function canEditDeal(
  role: Role,
  dealOwnerId: string,
  currentUserId: string
): boolean {
  if (role === Role.SUPERADMIN || role === Role.ADMIN) return true;
  return dealOwnerId === currentUserId;
}

/** Delete deal: S and A only. */
export function canDeleteDeal(role: Role): boolean {
  return role === Role.SUPERADMIN || role === Role.ADMIN;
}

/** Export deals: S and A only. */
export function canExportDeals(role: Role): boolean {
  return role === Role.SUPERADMIN || role === Role.ADMIN;
}

// ---------------------------------------------------------------------------
// 4. Custom Activity Tabs Permissions
// ---------------------------------------------------------------------------

/** Manage Custom Activity Tabs: S, A, M only. */
export function canManageActivityTabs(role: Role): boolean {
  return role === Role.SUPERADMIN || role === Role.ADMIN || role === Role.MANAGER;
}
