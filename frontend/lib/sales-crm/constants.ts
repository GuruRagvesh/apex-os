// Sales CRM — App constants
// Ported from intern source (src/lib/constants.ts). Nav hrefs rewritten to
// live under /sales-crm per Apex OS containment rules; MOCK_USERS kept as
// reference/display data only (lead ownership, activity attribution) — NOT
// used for authentication. Real auth is Apex OS's own Admin/SuperAdmin gate.
import { NavItem, Role } from "./types";

export const APP_NAME = "Sales CRM";

export const NAVIGATION_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/sales-crm/dashboard", icon: "dashboard" },
  { label: "Leads", href: "/sales-crm/leads", icon: "leads", description: "Lead management and pipeline" },
  { label: "Requirements & Sourcing", href: "/sales-crm/requirements-sourcing", icon: "requirements", description: "Requirements and sourcing management" },
  { label: "Deals", href: "/sales-crm/deals", icon: "deals", description: "Deal tracking and management" },
  { label: "Database", href: "/sales-crm/database", icon: "database", description: "Master lists and data management" },
  { label: "Analytics", href: "/sales-crm/analytics", icon: "analytics", description: "Pipeline and performance analytics" },
  { label: "Settings", href: "/sales-crm/settings", icon: "settings", description: "System settings and configuration" },
];

export const ROLE_LABELS: Record<Role, string> = {
  [Role.SUPERADMIN]: "Super Admin",
  [Role.ADMIN]: "Admin",
  [Role.MANAGER]: "Manager",
  [Role.TL]: "Team Lead",
  [Role.EMPLOYEE]: "Employee",
};

export const ROLE_COLORS: Record<Role, string> = {
  [Role.SUPERADMIN]: "#7C3AED",
  [Role.ADMIN]: "#2563EB",
  [Role.MANAGER]: "#0891B2",
  [Role.TL]: "#059669",
  [Role.EMPLOYEE]: "#6366F1",
};

// Reference-only mock reps used to attribute leads/deals in the demo dataset.
// NOT used for login — Sales CRM Phase 1 has no login of its own.
export const MOCK_USERS = [
  { id: "u-superadmin-1", name: "Priya Sharma", email: "priya@salescrm.io", role: Role.SUPERADMIN },
  { id: "u-admin-1", name: "Rahul Mehta", email: "rahul@salescrm.io", role: Role.ADMIN },
  { id: "u-manager-1", name: "Anita Desai", email: "anita@salescrm.io", role: Role.MANAGER },
  { id: "u-tl-1", name: "Vikram Singh", email: "vikram@salescrm.io", role: Role.TL },
  { id: "u-employee-1", name: "Sneha Patil", email: "sneha@salescrm.io", role: Role.EMPLOYEE },
];
