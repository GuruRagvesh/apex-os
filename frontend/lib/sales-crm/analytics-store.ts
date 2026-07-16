"use client";

// Sales CRM — Analytics in-memory store
// Ported from intern source (src/lib/analytics-store.ts) verbatim — no
// imports needed rewriting (only "react"), no localStorage usage (state is
// a module-level variable, intentionally not persisted, matching intern
// behavior exactly), no unsafe storage keys.
//
// Note: this hook's returned `logAction` is a local analytics-action-history
// recorder, distinct from `./audit-log`'s `logAction` (the global audit
// log). Both exist in the intern source under the same name — a consuming
// component that needs both must alias one on import.

import { useSyncExternalStore } from "react";

export interface UserContext {
  id: string;
  role: string;
  teamId: string;
  groupId: string;
  profileIds: string[];
}

export function createAnalyticsId(prefix: string, parts: Array<string | number | undefined>) {
  const raw = parts.map((part) => String(part || "")).join("-");
  const normalized = raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 36) || "item";
  let checksum = 0;
  for (let i = 0; i < raw.length; i += 1) {
    checksum = (checksum + raw.charCodeAt(i) * (i + 1)) % 100000;
  }
  return `${prefix}-${normalized}-${checksum}`;
}
interface AnalyticsUserLike {
  id?: string;
  role?: string;
  teamId?: string;
  team_id?: string;
  groupId?: string;
  group_id?: string;
  department?: string;
}

export function getUserAnalyticsContext(
  user: AnalyticsUserLike | null | undefined,
  profiles: ReportProfile[]
): UserContext {
  const role = user?.role || "EMPLOYEE";

  return {
    id: user?.id || "",
    role,
    teamId: user?.teamId || user?.team_id || user?.department || "team-1",
    groupId: user?.groupId || user?.group_id || user?.department || "group-1",
    profileIds: profiles.filter((profile) => profile.role === role).map((profile) => profile.id),
  };
}

export function getMatchingProfiles(
  profiles: ReportProfile[],
  role: string
): ReportProfile[] {
  return profiles.filter(p => p.role === role);
}

export function canViewItem(
  user: UserContext,
  item: {
    id?: string;
    ownerId: string;
    isTeamReport?: boolean;
    isTeamSchedule?: boolean;
    teamId?: string;
    groupId?: string;
    roleAccess?: string[];
    profileAccess?: string[];
    sharedTargets?: string[];
  },
  profiles?: ReportProfile[]
): boolean {
  // 1. Superadmin / Admin see everything
  if (user.role === "SUPERADMIN" || user.role === "ADMIN") return true;

  // 2. Owner always sees it
  if (item.ownerId === user.id) return true;

  // 3. Shared targets explicitly include user
  if (item.sharedTargets?.includes(user.id)) return true;

  // 4. Role-level access tag on the item
  if (item.roleAccess?.includes(user.role)) return true;

  // 5. Profile-level access tag on the item
  if (item.profileAccess && user.profileIds.length > 0) {
    if (item.profileAccess.some(p => user.profileIds.includes(p))) return true;
  }

  // 6. Team/Group membership
  if (item.teamId && item.teamId === user.teamId) return true;
  if (item.groupId && item.groupId === user.groupId) return true;

  // 7. Check profile.accessibleReports if profiles are provided
  if (profiles && item.id) {
    const userProfiles = getMatchingProfiles(profiles, user.role);
    if (userProfiles.some(p => p.accessibleReports.includes(item.id!))) return true;
  }

  return false;
}

export function canViewDashboard(
  user: UserContext,
  dashboardName: string,
  profiles: ReportProfile[]
): boolean {
  if (user.role === "SUPERADMIN" || user.role === "ADMIN") return true;
  const userProfiles = getMatchingProfiles(profiles, user.role);
  return userProfiles.some(p => p.accessibleDashboards.includes(dashboardName));
}


export interface ReportConfig {
  id: string;
  name: string;
  type: string;
  date: string;
  pinned: boolean;
  ownerId: string;
  isTeamReport: boolean;
  teamId?: string;
  groupId?: string;
  roleAccess?: string[];
  profileAccess?: string[];
  sharedTargets?: string[];
  ownerLabel?: string;
  stage?: string;
  source?: string;
  status?: string;
  activityType?: string;
  dealStage?: string;
  region?: string;
  customFields?: string[];
  description?: string;
  data: Record<string, unknown>;
}

export interface ReportSchedule {
  id: string;
  name: string;
  frequency: "Daily" | "Weekly" | "Monthly";
  format: "Excel" | "PDF";
  status: "Active" | "Paused";
  ownerId: string;
  isTeamSchedule: boolean;
  teamId?: string;
  groupId?: string;
  roleAccess?: string[];
  profileAccess?: string[];
  sharedTargets?: string[];
  emailRecipients: string;
}

export interface ReportProfile {
  id: string;
  name: string;
  role: string;
  accessibleReports: string[];
  accessibleDashboards: string[];
  pinnedReports: string[];
  homeDashboard: string;
  sharingRules: { canShare: boolean; maxRoleLevel?: string };
}

export interface SavedReport {
  id: string;
  name: string;
  baseReportId: string;
  filters: Record<string, unknown>;
  sortField: string;
  sortDir: "asc" | "desc";
  pinned: boolean;
  ownerId: string;
  isTeamReport: boolean;
  teamId?: string;
  groupId?: string;
  roleAccess?: string[];
  profileAccess?: string[];
  sharedTargets?: string[];
}

interface AnalyticsState {
  reports: ReportConfig[];
  savedReports: SavedReport[];
  schedules: ReportSchedule[];
  profiles: ReportProfile[];
  recentDashboards: string[];
  actionHistory: Record<string, unknown>[];
  uiState: { activeReportId: string | null; activeSavedReportId: string | null };
}

const INITIAL_REPORTS: ReportConfig[] = [
  { id: "1", name: "Lead Source Report", type: "Summary", date: "2026-07-07", pinned: true, ownerId: "system", isTeamReport: false, ownerLabel: "Me", teamId: "team-1", groupId: "group-1", stage: "Created", source: "Organic", status: "Active", activityType: "Email", dealStage: "Discovery", region: "NA", customFields: ["lead", "source"], data: {} },
  { id: "2", name: "Lead Funnel Report", type: "Summary", date: "2026-07-06", pinned: false, ownerId: "other_user", isTeamReport: true, ownerLabel: "My Team", teamId: "team-1", groupId: "group-1", stage: "Level 1", source: "Referral", status: "Active", activityType: "Call", dealStage: "Discovery", region: "EMEA", customFields: ["funnel", "lead"], data: {} },
  { id: "3", name: "Revenue Report", type: "Financial", date: "2026-07-05", pinned: false, ownerId: "system", isTeamReport: true, ownerLabel: "My Team", teamId: "team-1", groupId: "group-2", stage: "Closed", source: "Paid", status: "Active", activityType: "Meeting", dealStage: "Won", region: "NA", customFields: ["revenue", "finance"], data: {} },
  { id: "4", name: "User Performance Report", type: "Performance", date: "2026-07-01", pinned: true, ownerId: "system", isTeamReport: false, ownerLabel: "Me", teamId: "team-1", groupId: "group-1", stage: "Level 1", source: "Organic", status: "Active", activityType: "Call", dealStage: "Proposal", region: "APAC", customFields: ["performance"], data: {} },
  { id: "5", name: "Deals Pipeline Report", type: "Pipeline", date: "2026-06-30", pinned: false, ownerId: "other_user", isTeamReport: true, ownerLabel: "My Team", teamId: "team-2", groupId: "group-2", stage: "Level 1", source: "Paid", status: "Active", activityType: "Meeting", dealStage: "Proposal", region: "EMEA", customFields: ["pipeline", "deal"], data: {} },
  { id: "6", name: "Lead Aging Report", type: "Summary", date: "2026-07-02", pinned: false, ownerId: "system", isTeamReport: false, ownerLabel: "Me", teamId: "team-1", groupId: "group-1", stage: "Created", source: "Referral", status: "Inactive", activityType: "Email", dealStage: "Discovery", region: "APAC", customFields: ["aging"], data: {} },
  { id: "7", name: "Lead Assignment Report", type: "Summary", date: "2026-07-03", pinned: false, ownerId: "system", isTeamReport: true, ownerLabel: "My Team", teamId: "team-1", groupId: "group-1", stage: "Level 1", source: "Organic", status: "Active", activityType: "Call", dealStage: "Discovery", region: "NA", customFields: ["assignment"], data: {} },
  { id: "8", name: "Lead Conversion Report", type: "Summary", date: "2026-07-04", pinned: false, ownerId: "system", isTeamReport: false, ownerLabel: "Me", teamId: "team-1", groupId: "group-1", stage: "Closed", source: "Paid", status: "Active", activityType: "Meeting", dealStage: "Won", region: "EMEA", customFields: ["conversion"], data: {} },
  { id: "9", name: "Sales Performance Report", type: "Performance", date: "2026-07-01", pinned: false, ownerId: "system", isTeamReport: true, ownerLabel: "My Team", teamId: "team-1", groupId: "group-2", stage: "Closed", source: "Referral", status: "Active", activityType: "Meeting", dealStage: "Won", region: "NA", customFields: ["sales"], data: {} },
  { id: "10", name: "Deal Stage Report", type: "Pipeline", date: "2026-06-25", pinned: false, ownerId: "system", isTeamReport: false, ownerLabel: "Me", teamId: "team-1", groupId: "group-1", stage: "Level 1", source: "Organic", status: "Active", activityType: "Call", dealStage: "Proposal", region: "APAC", customFields: ["deal"], data: {} },
  { id: "11", name: "Activity Report", type: "Activity", date: "2026-07-05", pinned: false, ownerId: "system", isTeamReport: false, ownerLabel: "Me", teamId: "team-1", groupId: "group-1", stage: "Created", source: "Organic", status: "Active", activityType: "Meeting", dealStage: "Discovery", region: "NA", customFields: ["activity"], data: {} },
  { id: "12", name: "Email Performance Report", type: "Activity", date: "2026-07-05", pinned: false, ownerId: "system", isTeamReport: true, ownerLabel: "My Team", teamId: "team-1", groupId: "group-1", stage: "Created", source: "Paid", status: "Active", activityType: "Email", dealStage: "Discovery", region: "EMEA", customFields: ["email"], data: {} },
  { id: "13", name: "Call Activity Report", type: "Activity", date: "2026-07-06", pinned: false, ownerId: "system", isTeamReport: false, ownerLabel: "Me", teamId: "team-1", groupId: "group-1", stage: "Level 1", source: "Referral", status: "Active", activityType: "Call", dealStage: "Discovery", region: "NA", customFields: ["call"], data: {} },
  { id: "14", name: "SLA Report", type: "Performance", date: "2026-07-07", pinned: false, ownerId: "system", isTeamReport: true, ownerLabel: "My Team", teamId: "team-2", groupId: "group-2", stage: "Closed", source: "Organic", status: "Inactive", activityType: "Email", dealStage: "Won", region: "APAC", customFields: ["sla"], data: {} }
];

const INITIAL_SCHEDULES: ReportSchedule[] = [
  { id: "1", name: "Weekly Sales Performance", frequency: "Weekly", format: "Excel", status: "Active", ownerId: "system", isTeamSchedule: true, emailRecipients: "team@salescrm.io" },
  { id: "2", name: "Monthly Revenue Summary", frequency: "Monthly", format: "PDF", status: "Paused", ownerId: "system", isTeamSchedule: false, emailRecipients: "me@salescrm.io" },
];

const INITIAL_PROFILES: ReportProfile[] = [
  { id: "1", name: "Default Sales Profile", role: "EMPLOYEE", accessibleReports: ["1", "4", "6", "8", "10"], accessibleDashboards: ["Sales Dashboard", "Activity Dashboard"], pinnedReports: ["1", "4"], homeDashboard: "Sales Dashboard", sharingRules: { canShare: false } },
  { id: "2", name: "Manager Dashboard", role: "MANAGER", accessibleReports: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"], accessibleDashboards: ["Sales Dashboard", "Lead Dashboard", "Deals Dashboard", "Activity Dashboard"], pinnedReports: ["1", "2", "3", "5"], homeDashboard: "Sales Dashboard", sharingRules: { canShare: true, maxRoleLevel: "EMPLOYEE" } },
];

let globalState: AnalyticsState = {
  reports: INITIAL_REPORTS,
  savedReports: [],
  schedules: INITIAL_SCHEDULES,
  profiles: INITIAL_PROFILES,
  recentDashboards: ["Sales Dashboard"],
  actionHistory: [],
  uiState: { activeReportId: null, activeSavedReportId: null },
};

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return globalState;
}

function getServerSnapshot() {
  return globalState;
}

function updateState(newState: Partial<AnalyticsState>) {
  globalState = { ...globalState, ...newState };
  listeners.forEach((l) => l());
}

export function useAnalyticsStore() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const pinReport = (id: string, pinned: boolean) => {
    updateState({
      reports: state.reports.map((r) => (r.id === id ? { ...r, pinned } : r)),
      savedReports: state.savedReports.map((r) => (r.id === id ? { ...r, pinned } : r)),
    });
  };

  const saveReport = (report: ReportConfig) => {
    const exists = state.reports.find((r) => r.id === report.id);
    if (exists) {
      updateState({
        reports: state.reports.map((r) => (r.id === report.id ? report : r)),
      });
    } else {
      updateState({ reports: [...state.reports, report] });
    }
  };

  const saveSavedReport = (savedReport: SavedReport) => {
    const exists = state.savedReports.find((r) => r.id === savedReport.id);
    if (exists) {
      updateState({
        savedReports: state.savedReports.map((r) => (r.id === savedReport.id ? savedReport : r)),
      });
    } else {
      updateState({ savedReports: [...state.savedReports, savedReport] });
    }
  };

  const setUiState = (updates: Partial<{ activeReportId: string | null; activeSavedReportId: string | null }>) => {
    updateState({ uiState: { ...state.uiState, ...updates } });
  };

  const logAction = (action: Record<string, unknown>) => {
    updateState({
      actionHistory: [...state.actionHistory, action],
    });
  };

  const deleteReport = (id: string) => {
    updateState({
      reports: state.reports.filter((r) => r.id !== id),
    });
  };

  const createSchedule = (schedule: ReportSchedule) => {
    updateState({
      schedules: [...state.schedules, schedule],
    });
  };

  const editSchedule = (id: string, updates: Partial<ReportSchedule>) => {
    updateState({
      schedules: state.schedules.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    });
  };

  const deleteSchedule = (id: string) => {
    updateState({
      schedules: state.schedules.filter((s) => s.id !== id),
    });
  };

  const toggleScheduleStatus = (id: string) => {
    updateState({
      schedules: state.schedules.map((s) =>
        s.id === id ? { ...s, status: s.status === "Active" ? "Paused" : "Active" } : s
      ),
    });
  };

  const addRecentDashboard = (name: string) => {
    const filtered = state.recentDashboards.filter((d) => d !== name);
    updateState({
      recentDashboards: [name, ...filtered].slice(0, 5),
    });
  };

  const createProfile = (profile: ReportProfile) => {
    updateState({
      profiles: [...state.profiles, profile],
    });
  };

  const editProfile = (id: string, updates: Partial<ReportProfile>) => {
    updateState({
      profiles: state.profiles.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    });
  };

  const deleteProfile = (id: string) => {
    updateState({
      profiles: state.profiles.filter((p) => p.id !== id),
    });
  };

  return {
    ...state,
    pinReport,
    saveReport,
    saveSavedReport,
    deleteReport,
    createSchedule,
    editSchedule,
    deleteSchedule,
    toggleScheduleStatus,
    addRecentDashboard,
    createProfile,
    editProfile,
    deleteProfile,
    logAction,
    setUiState,
  };
}
