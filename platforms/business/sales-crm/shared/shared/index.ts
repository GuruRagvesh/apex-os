// Sales CRM Shared — framework-independent surface.
//
// Domain types, role policy and seed/reference data usable by any Sales CRM
// component. Nothing here imports React, Next or Nest, so a future Sales CRM
// backend slice can consume this file unchanged.

// ── domain types ────────────────────────────────────────────────────────────
// Role is an enum, so it is a value as well as a type and must not be
// exported with `export type`.
export { Role } from './types';
export type {
  User,
  ColumnConfig,
  NavItem,
  AuthState,
  LeadStage,
  Activity,
  FollowUp,
  Requirement,
  Deal,
  Lead,
  CompanyMaster,
  CompanyAlias,
  ExternalCompanySuggestion,
} from './types';

export type { AuditAction, AuditCollection, AuditLogRecord } from './types/audit';

// ── constants and reference data ────────────────────────────────────────────
export { APP_NAME, NAVIGATION_ITEMS, ROLE_LABELS, ROLE_COLORS, MOCK_USERS } from './constants/constants';

export { MOCK_LEADS } from './constants/mock-data';

export { getCountryCodes, getDefaultCountryCode } from './constants/country-codes';
export type { CountryCodeOption } from './constants/country-codes';

// ── role policy ─────────────────────────────────────────────────────────────
// Pure predicates over Role. Kept beside the role constants they read rather
// than in a separate layer, because they are policy data, not behaviour.
export {
  CONTACT_FIELDS,
  canImport,
  canExport,
  canAddRecord,
  canEditRecord,
  canDeleteRecord,
  canChangeLeadOwner,
  isContactFieldVisible,
  isDealMoneyVisible,
  canAddDeal,
  canEditDeal,
  canDeleteDeal,
  canExportDeals,
  canManageActivityTabs,
} from './constants/permissions';
