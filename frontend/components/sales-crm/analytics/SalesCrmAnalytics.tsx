"use client";

import { useState } from "react";
import { BarChart3, CalendarClock, FolderKanban, Home, LayoutGrid, Users, type LucideIcon } from "lucide-react";
import { useAuth } from "@apex/sales-crm-shared";
import AnalyticsHome from "./AnalyticsHome";
import DashboardGrid from "./DashboardGrid";
import ReportsView from "./ReportsView";
import ScheduledReports from "./ScheduledReports";
import ReportManagement from "./ReportManagement";
import styles from "@/styles/sales-crm/analytics.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

type AnalyticsMode = "personal" | "team";
type AnalyticsTab = "home" | "dashboards" | "reports" | "scheduled" | "management";

// Adapted: intern typed this as ComponentType<{ size?: number }>, but the
// lucide-react version pinned in Apex's package.json types `size` as
// `string | number` on its icon components, which isn't assignable to a
// narrower `size?: number`. Using lucide-react's own LucideIcon type fixes
// the mismatch without changing how any icon is rendered.
const ANALYTICS_TABS: { id: AnalyticsTab; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "dashboards", label: "Dashboards", icon: LayoutGrid },
  { id: "reports", label: "Reports", icon: FolderKanban },
  { id: "scheduled", label: "Scheduled", icon: CalendarClock },
  { id: "management", label: "Profiles", icon: Users },
];

export default function SalesCrmAnalytics() {
  const { user } = useAuth();
  const [mode, setMode] = useState<AnalyticsMode>("personal");
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("dashboards");

  const userId = user?.id || "system";

  const handleNavigate = (tab: AnalyticsTab | "dashboards") => {
    setActiveTab(tab);
  };

  const renderContent = () => {
    switch (activeTab) {
      case "reports":
        return <ReportsView dashboardMode={mode} userId={userId} />;
      case "dashboards":
        return <DashboardGrid dashboardMode={mode} />;
      case "scheduled":
        return <ScheduledReports dashboardMode={mode} userId={userId} />;
      case "management":
        return <ReportManagement />;
      case "home":
      default:
        return <AnalyticsHome dashboardMode={mode} onNavigate={handleNavigate} />;
    }
  };

  return (
    <div className={styles["analytics-page"]}>
      <div className={styles["analytics-page-header"]}>
        <div>
          <span className={`${ui["ui-badge"]} ${ui["ui-badge-info"]} ${styles["analytics-page-kicker"]}`}>
            <BarChart3 size={14} />
            Analytics
          </span>
          <h1 className={styles["analytics-page-title"]}>Analytics Workspace</h1>
          <p className={styles["analytics-page-subtitle"]}>Review reports, saved views, scheduled exports, and role-based report profiles.</p>
        </div>

        <div className={styles["analytics-mode-switch"]}>
          <button type="button" className={`${styles["analytics-mode-button"]} ${mode === "personal" ? styles["analytics-mode-button-active"] : ""}`} onClick={() => setMode("personal")}>
            Personal
          </button>
          <button type="button" className={`${styles["analytics-mode-button"]} ${mode === "team" ? styles["analytics-mode-button-active"] : ""}`} onClick={() => setMode("team")}>
            Team
          </button>
        </div>
      </div>

      <div className={styles["analytics-tab-rail"]}>
        {ANALYTICS_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={`${styles["analytics-tab-button"]} ${activeTab === tab.id ? styles["analytics-tab-button-active"] : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {renderContent()}
    </div>
  );
}
