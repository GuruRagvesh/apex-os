"use client";
// Adapted from intern source (src/app/(protected)/dashboard/page.tsx).
// Replaces the Phase 1 simplified rebuild with the real intern Dashboard
// experience: dashboard-type switcher (Sales/Lead/Deals/Activity), Quick
// Add, Export (PDF working, Excel disabled — see report-output.ts),
// Share, and personal/team mode. useAuth() now comes from the Apex auth
// adapter, not intern's mock auth.

import { useEffect, useState, useCallback } from "react";
import { DashboardData, getDashboardData } from "@/lib/sales-crm/dashboard-calculations";
import { useAuth, Role } from "@apex/sales-crm-shared";
import DashboardHeader from "./DashboardHeader";
import QuickAdd from "./QuickAdd";
import SalesDashboard from "./SalesDashboard";
import ExportModal from "@apex/sales-crm-shared/components/ExportModal";
import ShareModal from "./ShareModal";
import { useAnalyticsStore } from "@/lib/sales-crm/analytics-store";
import Toast from "@apex/sales-crm-shared/components/Toast";
import {
  ReportArtifact,
  createSharePackage,
  downloadReportExport,
} from "@/lib/sales-crm/report-output";
import styles from "@apex/sales-crm-shared/styles/dashboard.module.css";

export default function SalesCrmDashboard() {
  const { user } = useAuth();
  const userRole = (user?.role as Role | undefined) ?? Role.EMPLOYEE;
  const currentUserId = user?.id || "";

  const canSeeTeam = [
    Role.SUPERADMIN,
    Role.ADMIN,
    Role.MANAGER,
    Role.TL,
  ].includes(userRole);
  const [dashboardModeState, setDashboardMode] = useState<"personal" | "team">(
    () => {
      if (typeof window !== "undefined") {
        const saved = localStorage.getItem("salescrm_default_dashboard");
        if (saved === "team" && canSeeTeam) return "team";
        return "personal";
      }
      return "personal";
    },
  );
  const dashboardMode = canSeeTeam ? dashboardModeState : "personal";
  const [data, setData] = useState<DashboardData | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dateRange, setDateRange] = useState<
    "today" | "week" | "month" | "all"
  >("all");
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [dashboardType, setDashboardType] = useState<string>("Sales");

  const { logAction } = useAnalyticsStore();


  /* Persist default dashboard */
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("salescrm_default_dashboard", dashboardMode);
    }
  }, [dashboardMode]);

  const loadData = useCallback(async (showLoading = true) => {
    if (showLoading) setIsRefreshing(true);
    /* simulate brief loading for realism */ await new Promise((r) => setTimeout(r, 400));
    setData(getDashboardData(undefined, userRole, currentUserId, dashboardMode, dateRange));
    setIsRefreshing(false);
  }, [userRole, currentUserId, dashboardMode, dateRange]);

  /* Listen to refresh-dashboard event from Topbar */
  useEffect(() => {
    const handleRefreshDash = () => {
      loadData(true);
    };
    window.addEventListener("salescrm:refresh-dashboard", handleRefreshDash);
    return () => window.removeEventListener("salescrm:refresh-dashboard", handleRefreshDash);
  }, [loadData]);
  useEffect(() => {
    if (userRole && currentUserId) {
      let isMounted = true;
      const fetchInitialData = async () => {
        /* simulate brief loading for realism */ await new Promise((r) =>
          setTimeout(r, 400),
        );
        if (isMounted) {
          setData(
            getDashboardData(
              undefined,
              userRole,
              currentUserId,
              dashboardMode,
              dateRange,
            ),
          );
        }
      };
      fetchInitialData();
      return () => {
        isMounted = false;
      };
    }
  }, [userRole, currentUserId, dashboardMode, dateRange]);
  const handleRefresh = async () => {
    if (user) {
      logAction({
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        action: "update",
        collection: "System",
        details: "Refreshed dashboard data.",
      });
    }
    await loadData(true);
  };

  const buildDashboardArtifact = (): ReportArtifact | null => {
    if (!data) return null;

    return {
      title: `${dashboardType} Dashboard`,
      subtitle: "Sales CRM analytics dashboard snapshot",
      generatedBy: user?.name || "System",
      generatedAt: new Date().toISOString(),
      context: {
        dashboardType,
        dashboardMode,
        dateRange,
        userRole,
      },
      summary: {
        totalLeads: data.totalLeads,
        activeLeads: data.activeLeads,
        activeLeadsPercentage: `${data.activeLeadsPercentage}%`,
        newLeads: data.newLeads,
        conversionRate: `${data.conversionRate}%`,
        opportunityPipeline: data.opportunityPipeline,
        opportunityValue: data.opportunityValue,
        revenue: data.revenue,
        activeDeals: data.activeDeals.count,
        activeDealValue: data.activeDeals.value,
      },
      filters: {
        dateRange,
        dashboardMode,
      },
      sections: [
        {
          title: "Requirements Captured",
          rows: [{ ...data.requirementsCaptured }],
        },
        {
          title: "Lead Funnel",
          rows: data.leadFunnel.map((row) => ({ ...row })),
        },
        {
          title: "Action Board Summary",
          rows: [{ ...data.todayActionBoard.summary }],
        },
        {
          title: "Action Board Worklist",
          rows: data.todayActionBoard.workList.map((row) => ({ ...row })),
        },
        {
          title: "Owner Performance",
          rows: data.ownerPerformance.map((row) => ({ ...row })),
        },
        {
          title: "Needs Attention",
          rows: data.needsAttention.map((row) => ({ ...row })),
        },
      ],
    };
  };

  if (!data && !isRefreshing) {
    return (
      <div className={styles["dashboard-loading"]}>
        <div className={styles["spinner"]}></div> <p>Loading your dashboard...</p>
      </div>
    );
  }
  return (
    <div className={styles["dash-container"]}>
      {showQuickAdd && <QuickAdd onClose={() => setShowQuickAdd(false)} />}
      {/* 1. Dashboard Header (Switcher, Filters, Actions) */}
      <DashboardHeader
        userRole={userRole}
        dashboardMode={dashboardMode}
        setDashboardMode={setDashboardMode}
        dateRange={dateRange}
        setDateRange={setDateRange}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        onQuickAdd={() => setShowQuickAdd(true)}
        dashboardType={dashboardType}
        setDashboardType={setDashboardType}
        onExport={() => setShowExportModal(true)}
        onShare={() => setShowShareModal(true)}
      />
      {data && <SalesDashboard data={data} dashboardType={dashboardType} />}

      {showExportModal && (
        <ExportModal
          onClose={() => setShowExportModal(false)}
          onExport={async (action) => {
            const artifact = buildDashboardArtifact();
            if (!artifact) {
              setToastMsg("Dashboard data is still loading.");
              return;
            }

            try {
              const fileName = await downloadReportExport(action, artifact);
              logAction({ type: "ExportDashboard", ...action, fileName, dashboardMode });
              setToastMsg(`${fileName} downloaded successfully.`);
            } catch (err) {
              setToastMsg(err instanceof Error ? err.message : "Export failed. Please try again.");
            }
          }}
        />
      )}
      {showShareModal && (
        <ShareModal
          onClose={() => setShowShareModal(false)}
          onShare={async (action) => {
            const artifact = buildDashboardArtifact();
            if (!artifact) {
              setToastMsg("Dashboard data is still loading.");
              return;
            }

            try {
              const result = await createSharePackage(action, artifact);
              logAction({
                type: "ShareDashboard",
                ...action,
                dashboardMode,
                token: result.token,
                fileName: result.fileName,
              });
              setToastMsg(
                result.copied
                  ? `${result.fileName} downloaded and copied.`
                  : `${result.fileName} downloaded.`,
              );
            } catch {
              setToastMsg("Share failed. Please try again.");
            }
          }}
        />
      )}
      {toastMsg && <Toast message={toastMsg} onClose={() => setToastMsg(null)} />}
    </div>
  );
}
