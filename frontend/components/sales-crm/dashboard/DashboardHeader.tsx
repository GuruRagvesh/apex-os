"use client";

import { Role } from "@apex/sales-crm-shared";
import styles from "@/styles/sales-crm/dashboard.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";
import { RefreshCw, Plus } from "lucide-react";

interface DashboardHeaderProps {
  userRole: Role;
  dashboardMode: "personal" | "team";
  setDashboardMode: (mode: "personal" | "team") => void;
  dateRange: "today" | "week" | "month" | "all";
  setDateRange: (range: "today" | "week" | "month" | "all") => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onQuickAdd: () => void;
  dashboardType: string;
  setDashboardType: (type: string) => void;
  onExport: () => void;
  onShare: () => void;
}

export default function DashboardHeader({
  userRole,
  dashboardMode,
  setDashboardMode,
  dateRange,
  setDateRange,
  onRefresh,
  isRefreshing,
  onQuickAdd,
  dashboardType,
  setDashboardType,
  onExport,
  onShare,
}: DashboardHeaderProps) {
  const canSeeTeamDashboard = [Role.SUPERADMIN, Role.ADMIN, Role.MANAGER, Role.TL].includes(userRole);

  return (
    <div className={styles["dash-header-actions"]}>
      <div className={styles["dash-header-left"]}>
        {canSeeTeamDashboard && (
          <div className={styles["dash-segmented-switch"]}>
            <button
              className={dashboardMode === "personal" ? "active" : ""}
              onClick={() => setDashboardMode("personal")}
            >
              Personal
            </button>
            <button
              className={dashboardMode === "team" ? "active" : ""}
              onClick={() => setDashboardMode("team")}
            >
              Team
            </button>
          </div>
        )}
      </div>

      <div className={styles["dash-header-right"]}>
        <select
          className={`${ui["ui-input"]} ${styles["analytics-w-200"]}`}
          value={dashboardType}
          onChange={(e) => setDashboardType(e.target.value)}
        >
          <option value="Sales">Sales Dashboard</option>
          <option value="Lead">Lead Dashboard</option>
          <option value="Deals">Deals Dashboard</option>
          <option value="Activity">Activity Dashboard</option>
        </select>

        <select
          className={`${ui["ui-input"]} ${styles["dash-date-select"]}`}
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as "today" | "week" | "month" | "all")}
        >
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="all">All Time</option>
        </select>

        <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]} ${ui["ui-btn-sm"]}`} onClick={onExport}>
          Export
        </button>
        <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]} ${ui["ui-btn-sm"]}`} onClick={onShare}>
          Share
        </button>

        <button
          className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]} ${ui["ui-btn-sm"]}`}
          onClick={onRefresh}
          disabled={isRefreshing}
          title="Refresh Data"
        >
          <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
        </button>

        <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]} ${ui["ui-btn-sm"]}`} onClick={onQuickAdd}>
          <Plus size={16} /> Quick Add
        </button>
      </div>
    </div>
  );
}
