"use client";

import { useState } from "react";
import { useAnalyticsStore, canViewItem, getUserAnalyticsContext } from "@/lib/sales-crm/analytics-store";
import { useAuth } from "@apex/sales-crm-shared";
import { Pin } from "lucide-react";
import styles from "@/styles/sales-crm/analytics.module.css";
import dash from "@apex/sales-crm-shared/styles/dashboard.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

export default function AnalyticsHome({
  dashboardMode,
  onNavigate,
}: {
  dashboardMode: "personal" | "team";
  onNavigate: (tab: "reports" | "home" | "dashboards" | "scheduled" | "management") => void;
}) {
  const { reports, savedReports, profiles, recentDashboards, pinReport, setUiState } = useAnalyticsStore();
  const { user } = useAuth();
  const [search, setSearch] = useState("");

  const userContext = getUserAnalyticsContext(user, profiles);
  const savedReportItems = savedReports.map((savedReport) => {
    const baseReport = reports.find((report) => report.id === savedReport.baseReportId);

    return {
      ...savedReport,
      type: "Saved",
      isTeamReport: savedReport.isTeamReport ?? baseReport?.isTeamReport ?? false,
      ownerId: savedReport.ownerId || baseReport?.ownerId || "",
      teamId: savedReport.teamId || baseReport?.teamId,
      groupId: savedReport.groupId || baseReport?.groupId,
      roleAccess: savedReport.roleAccess || baseReport?.roleAccess,
      profileAccess: savedReport.profileAccess || baseReport?.profileAccess,
      sharedTargets: savedReport.sharedTargets || baseReport?.sharedTargets,
    };
  });
  const visibleSavedReportItems = savedReportItems.filter((savedReport) => canViewItem(userContext, { ...savedReport, id: savedReport.baseReportId }, profiles));
  const allReports = [...reports.filter((report) => canViewItem(userContext, report, profiles)), ...visibleSavedReportItems];

  const pinnedReports = allReports.filter((r) => r.pinned && (dashboardMode === "team" ? r.isTeamReport : !r.isTeamReport));

  const filteredReports = allReports.filter((r) => {
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className={`${ui["ui-card"]} ${styles["analytics-card-padded"]}`}>
      <div className={styles["analytics-header-row-sm"]}>
        <h2 className={ui["ui-card-title"]}>Analytics Home ({dashboardMode === "personal" ? "My Analytics" : "Team Analytics"})</h2>
        <input
          className={`${ui["ui-input"]} ui-input-sm ${styles["analytics-w-250"]}`}
          placeholder="Search saved reports..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <p className={dash["settings-text-muted"]}>Welcome to your Analytics Home. Here you can find pinned reports, saved views, and quick links to common dashboards.</p>

      <div className={`${dash["dash-row"]} ${styles["analytics-tabs-container"]}`}>
        <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]}`}>
          <h3 className={ui["ui-label"]}>Pinned Reports</h3>
          {pinnedReports.length > 0 ? (
            <ul className={styles["analytics-list"]}>
              {pinnedReports.map((r) => (
                <li key={r.id} className={styles["analytics-list-item-flex"]}>
                  <span
                    className={styles["analytics-cursor-pointer"]}
                    onClick={() => {
                      if ((r as import("@/lib/sales-crm/analytics-store").ReportConfig).type === "Saved") {
                        setUiState({ activeSavedReportId: r.id, activeReportId: null });
                      } else {
                        setUiState({ activeReportId: r.id, activeSavedReportId: null });
                      }
                      onNavigate("reports");
                    }}
                  >
                    {r.name}
                  </span>
                  <span title="Unpin">
                    <Pin size={14} className={`${styles["analytics-pinned-icon"]} ${styles["analytics-cursor-pointer"]}`} onClick={() => pinReport(r.id, false)} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={`${dash["settings-text-muted"]} ${styles["analytics-text-sm"]}`}>No reports pinned yet.</p>
          )}
        </div>
        <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]}`}>
          <h3 className={ui["ui-label"]}>Recent Dashboards</h3>
          <ul className={styles["analytics-list"]}>
            {recentDashboards.map((d) => (
              <li key={d} className={`${styles["analytics-list-item"]} ${styles["analytics-cursor-pointer"]}`} onClick={() => onNavigate("dashboards")}>
                {d}
              </li>
            ))}
          </ul>
        </div>
        <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]}`}>
          <h3 className={ui["ui-label"]}>All Reports & Saved {search ? "(Filtered)" : ""}</h3>
          {filteredReports.length > 0 ? (
            <ul className={styles["analytics-list"]}>
              {filteredReports.slice(0, 5).map((r) => (
                <li key={r.id} className={`${styles["analytics-list-item-flex"]} ${styles["analytics-list-item-between"]}`}>
                  <span
                    className={styles["analytics-cursor-pointer"]}
                    onClick={() => {
                      if (r.type === "Saved") {
                        setUiState({ activeSavedReportId: r.id, activeReportId: null });
                      } else {
                        setUiState({ activeReportId: r.id, activeSavedReportId: null });
                      }
                      onNavigate("reports");
                    }}
                  >
                    {r.name}
                  </span>
                  <span title={r.pinned ? "Unpin" : "Pin"}>
                    <Pin
                      size={14}
                      className={
                        r.pinned
                          ? `${styles["analytics-pinned-icon"]} ${styles["analytics-cursor-pointer"]} ${styles["analytics-mb-0"]}`
                          : `${styles["analytics-icon-lg-muted"]} ${styles["analytics-cursor-pointer"]} ${styles["analytics-mb-0"]}`
                      }
                      onClick={() => pinReport(r.id, !r.pinned)}
                    />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={`${dash["settings-text-muted"]} ${styles["analytics-text-sm"]}`}>No reports found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
