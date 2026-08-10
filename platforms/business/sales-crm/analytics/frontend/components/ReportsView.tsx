"use client";

import { useState } from "react";
import { ArrowUpDown, Download, Filter, Pin, Plus, Search, X } from "lucide-react";
import { ReportConfig, SavedReport, canViewItem, createAnalyticsId, getUserAnalyticsContext, useAnalyticsStore } from "@apex/sales-crm-shared/lib/analytics-store";
import { useAuth } from "@apex/sales-crm-shared";
import Chart, { ChartDataPoint, ChartType } from "@apex/sales-crm-shared/components/Chart";
import ExportModal from "@apex/sales-crm-shared/components/ExportModal";
import Toast from "@apex/sales-crm-shared/components/Toast";
import { ReportArtifact, downloadReportExport } from "@apex/sales-crm-shared/lib/report-output";
import styles from "../styles/analytics.module.css";
import dash from "@apex/sales-crm-shared/styles/dashboard.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

type ReportFilters = {
  dateFilter: string;
  ownerFilter: string;
  teamFilter: string;
  groupFilter: string;
  stageFilter: string;
  sourceFilter: string;
  statusFilter: string;
  activityTypeFilter: string;
  dealStageFilter: string;
  regionFilter: string;
  customFieldsFilter: string;
};

const defaultFilters: ReportFilters = {
  dateFilter: "All Time",
  ownerFilter: "All",
  teamFilter: "All",
  groupFilter: "All",
  stageFilter: "All",
  sourceFilter: "All",
  statusFilter: "All",
  activityTypeFilter: "All",
  dealStageFilter: "All",
  regionFilter: "All",
  customFieldsFilter: "",
};

const teamValueMap: Record<string, string> = {
  "Team A": "team-1",
  "Team B": "team-2",
};

const groupValueMap: Record<string, string> = {
  Enterprise: "group-1",
  SMB: "group-2",
};

function normalizeSavedFilters(filters: Record<string, unknown> | undefined): ReportFilters {
  return {
    ...defaultFilters,
    ...(filters || {}),
  } as ReportFilters;
}

function getActiveFilterCount(filters: ReportFilters) {
  return Object.values(filters).filter((value) => value && value !== "All" && value !== "All Time").length;
}

export default function ReportsView({ dashboardMode, userId }: { dashboardMode: "personal" | "team"; userId: string }) {
  const { reports, savedReports, profiles, pinReport, saveReport, saveSavedReport, logAction, uiState, setUiState } = useAnalyticsStore();
  const { user } = useAuth();
  const userContext = getUserAnalyticsContext(user, profiles);
  const [subTab, setSubTab] = useState<"all" | "saved" | "pinned">("all");
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<keyof ReportConfig>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const [exportingReportId, setExportingReportId] = useState<string | null>(null);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newReportName, setNewReportName] = useState("");
  const [newReportType, setNewReportType] = useState("Summary");

  const viewingReportId = uiState.activeReportId;
  const viewingSavedReportId = uiState.activeSavedReportId;

  const openReport = (id: string) => {
    setUiState({ activeReportId: id, activeSavedReportId: null });
  };

  const openSavedReport = (id: string) => {
    setUiState({ activeReportId: null, activeSavedReportId: id });
  };

  const closeActiveReport = () => {
    setUiState({ activeReportId: null, activeSavedReportId: null });
  };

  const updateFilter = (key: keyof ReportFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const matchesDashboardMode = (item: { isTeamReport?: boolean }) => (dashboardMode === "team" ? !!item.isTeamReport : !item.isTeamReport);

  const matchesReportFilters = (report: ReportConfig, activeFilters = filters) => {
    if (activeFilters.dateFilter === "Last 30 Days") {
      const reportDate = new Date(report.date);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      if (reportDate < cutoff) return false;
    }

    if (activeFilters.dateFilter === "This Year" && !report.date.startsWith(String(new Date().getFullYear()))) return false;
    if (activeFilters.ownerFilter !== "All" && report.ownerLabel !== activeFilters.ownerFilter) return false;
    if (activeFilters.teamFilter !== "All" && report.teamId !== teamValueMap[activeFilters.teamFilter]) return false;
    if (activeFilters.groupFilter !== "All" && report.groupId !== groupValueMap[activeFilters.groupFilter]) return false;
    if (activeFilters.stageFilter !== "All" && report.stage !== activeFilters.stageFilter) return false;
    if (activeFilters.sourceFilter !== "All" && report.source !== activeFilters.sourceFilter) return false;
    if (activeFilters.statusFilter !== "All" && report.status !== activeFilters.statusFilter) return false;
    if (activeFilters.activityTypeFilter !== "All" && report.activityType !== activeFilters.activityTypeFilter) return false;
    if (activeFilters.dealStageFilter !== "All" && report.dealStage !== activeFilters.dealStageFilter) return false;
    if (activeFilters.regionFilter !== "All" && report.region !== activeFilters.regionFilter) return false;

    if (activeFilters.customFieldsFilter.trim()) {
      const needle = activeFilters.customFieldsFilter.trim().toLowerCase();
      if (!(report.customFields || []).some((value) => value.toLowerCase().includes(needle))) return false;
    }

    return true;
  };

  const getSavedReportAccessItem = (savedReport: SavedReport) => {
    const baseReport = reports.find((report) => report.id === savedReport.baseReportId);

    if (!baseReport) return null;

    return {
      ...baseReport,
      ownerId: savedReport.ownerId || baseReport.ownerId,
      isTeamReport: savedReport.isTeamReport ?? baseReport.isTeamReport,
      teamId: savedReport.teamId || baseReport.teamId,
      groupId: savedReport.groupId || baseReport.groupId,
      roleAccess: savedReport.roleAccess || baseReport.roleAccess,
      profileAccess: savedReport.profileAccess || baseReport.profileAccess,
      sharedTargets: savedReport.sharedTargets || baseReport.sharedTargets,
    };
  };

  const handleSort = (field: keyof ReportConfig) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const filteredReports = reports
    .filter((report) => {
      if (!canViewItem(userContext, report, profiles)) return false;
      if (!matchesDashboardMode(report)) return false;
      if (subTab === "pinned" && !report.pinned) return false;
      if (search && !report.name.toLowerCase().includes(search.toLowerCase())) return false;
      return matchesReportFilters(report);
    })
    .sort((a, b) => {
      const valA = a[sortField] ?? "";
      const valB = b[sortField] ?? "";
      if (valA < valB) return sortDir === "asc" ? -1 : 1;
      if (valA > valB) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

  const visibleSavedReports = savedReports.filter((savedReport) => {
    const accessItem = getSavedReportAccessItem(savedReport);
    const baseReport = reports.find((report) => report.id === savedReport.baseReportId);

    if (!accessItem || !baseReport) return false;
    if (!canViewItem(userContext, accessItem, profiles)) return false;
    if (!matchesDashboardMode(accessItem)) return false;
    if (search && !savedReport.name.toLowerCase().includes(search.toLowerCase())) return false;
    return matchesReportFilters(baseReport, normalizeSavedFilters(savedReport.filters));
  });

  const viewingReport = viewingReportId ? reports.find((report) => report.id === viewingReportId) : null;
  const viewingSavedReport = viewingSavedReportId ? savedReports.find((report) => report.id === viewingSavedReportId) : null;
  const activeReport = viewingReport || (viewingSavedReport ? reports.find((report) => report.id === viewingSavedReport.baseReportId) : null);

  const getChartType = (report: ReportConfig): ChartType =>
    report.type === "Financial" ? "area" : report.type === "Activity" ? "donut" : report.type === "Performance" ? "line" : "column";

  const getChartData = (activeFilters: ReportFilters): ChartDataPoint[] => {
    const multiplier = 1 - getActiveFilterCount(activeFilters) * 0.1;
    return [
      { label: "Q1", value: Math.max(10, Math.floor(120 * multiplier)) },
      { label: "Q2", value: Math.max(10, Math.floor(250 * multiplier)) },
      { label: "Q3", value: Math.max(10, Math.floor(180 * multiplier)) },
      { label: "Q4", value: Math.max(10, Math.floor(300 * multiplier)) },
    ];
  };

  const buildReportArtifact = (report: ReportConfig, reportName: string, exportFilters: ReportFilters): ReportArtifact => ({
    title: reportName,
    subtitle: "Sales CRM analytics report",
    generatedBy: user?.name || "System",
    generatedAt: new Date().toISOString(),
    context: {
      reportId: report.id,
      reportType: report.type,
      dashboardMode,
      lastUpdated: report.date,
      owner: report.ownerLabel || report.ownerId,
    },
    filters: exportFilters,
    sort: {
      sortField,
      sortDir,
    },
    summary: {
      pinned: report.pinned ? "Yes" : "No",
      stage: report.stage || "-",
      source: report.source || "-",
      status: report.status || "-",
      activityType: report.activityType || "-",
      dealStage: report.dealStage || "-",
      region: report.region || "-",
    },
    sections: [
      {
        title: "Chart Data",
        rows: getChartData(exportFilters).map((row) => ({ ...row })),
      },
      {
        title: "Report Access",
        rows: [
          {
            ownerId: report.ownerId,
            teamId: report.teamId || "-",
            groupId: report.groupId || "-",
            roleAccess: (report.roleAccess || []).join(", "),
            profileAccess: (report.profileAccess || []).join(", "),
          },
        ],
      },
    ],
  });

  const renderExportModal = (exportFilters: ReportFilters) =>
    exportingReportId && (
      <ExportModal
        onClose={() => setExportingReportId(null)}
        onExport={async (action) => {
          const report = reports.find((item) => item.id === exportingReportId) || activeReport;

          if (!report) {
            setToastMsg("Report data is not available.");
            return;
          }

          try {
            const fileName = await downloadReportExport(action, buildReportArtifact(report, report.name, exportFilters));
            logAction({
              type: "ExportReport",
              reportId: exportingReportId,
              ...action,
              fileName,
              filters: exportFilters,
              sort: { sortField, sortDir },
            });
            setToastMsg(`${fileName} downloaded successfully.`);
          } catch {
            setToastMsg("Export failed. Please try again.");
          }
        }}
      />
    );

  if (activeReport) {
    const isSaved = !!viewingSavedReportId;
    const displayName = isSaved ? viewingSavedReport!.name : activeReport.name;
    const reportFilters = isSaved ? normalizeSavedFilters(viewingSavedReport!.filters) : filters;
    const chartType = getChartType(activeReport);
    const chartData = getChartData(reportFilters);

    return (
      <div className="analytics-view-container">
        <div className={`${styles["analytics-header-row"]} ${styles["analytics-mb-xl"]}`}>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={closeActiveReport}>
            <ArrowUpDown size={14} className={styles["analytics-rotate-90"]} /> Back to Reports
          </button>
          <div className={styles["analytics-flex-gap-sm"]}>
            <button
              className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]} ${ui["ui-btn-sm"]}`}
              onClick={() => {
                const savedReportId = viewingSavedReport?.id || createAnalyticsId("saved-report", [activeReport.id, activeReport.name, userId, savedReports.length]);
                saveSavedReport({
                  id: savedReportId,
                  name: viewingSavedReport?.name || `${activeReport.name} (Custom)`,
                  baseReportId: activeReport.id,
                  filters: reportFilters,
                  sortField: sortField as string,
                  sortDir,
                  pinned: viewingSavedReport?.pinned || false,
                  ownerId: userId,
                  isTeamReport: activeReport.isTeamReport,
                  teamId: activeReport.teamId,
                  groupId: activeReport.groupId,
                  roleAccess: activeReport.roleAccess,
                  profileAccess: activeReport.profileAccess,
                  sharedTargets: activeReport.sharedTargets,
                });
                setToastMsg("Report configuration saved.");
              }}
            >
              Save Config
            </button>
            <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]} ${ui["ui-btn-sm"]}`} onClick={() => setExportingReportId(activeReport.id)}>
              Export
            </button>
          </div>
        </div>

        <div className={`${ui["ui-card"]} ${styles["analytics-card-padded"]}`}>
          <h3 className={ui["ui-card-title"]}>{displayName}</h3>
          <p className={dash["settings-text-muted"]}>
            Type: {activeReport.type} | Last Updated: {activeReport.date}
          </p>

          <div className={`${styles["analytics-flex-gap"]} ${styles["analytics-mt-md"]} ${styles["analytics-mb-md"]} ${styles["analytics-flex-wrap"]}`}>
            <span className={`${ui["ui-badge"]} ui-badge-secondary`}>Date: {reportFilters.dateFilter}</span>
            <span className={`${ui["ui-badge"]} ui-badge-secondary`}>Owner: {reportFilters.ownerFilter}</span>
            <span className={`${ui["ui-badge"]} ui-badge-secondary`}>Team: {reportFilters.teamFilter}</span>
            <span className={`${ui["ui-badge"]} ui-badge-secondary`}>Group: {reportFilters.groupFilter}</span>
            <span className={`${ui["ui-badge"]} ui-badge-secondary`}>Stage: {reportFilters.stageFilter}</span>
            <span className={`${ui["ui-badge"]} ui-badge-secondary`}>Deal Stage: {reportFilters.dealStageFilter}</span>
            <span className={`${ui["ui-badge"]} ui-badge-secondary`}>Region: {reportFilters.regionFilter}</span>
          </div>

          <div className={`${styles["analytics-mt-lg"]} ${styles["analytics-h-350"]}`}>
            <Chart type={chartType} data={chartData} title={`${displayName} Trends`} height={300} />
          </div>
        </div>
        {renderExportModal(reportFilters)}
        {toastMsg && <Toast message={toastMsg} onClose={() => setToastMsg(null)} />}
      </div>
    );
  }

  const visibleRowsCount = subTab === "saved" ? visibleSavedReports.length : filteredReports.length;

  return (
    <div className={`${ui["ui-card"]} ${styles["analytics-card-padded"]}`}>
      <div className={styles["analytics-header-row-sm"]}>
        <h2 className={ui["ui-card-title"]}>Reports ({dashboardMode === "personal" ? "My Reports" : "Team Reports"})</h2>
        <div className={styles["analytics-flex-gap"]}>
          <div className={`ui-input-group ${styles["analytics-relative"]}`}>
            <span className={styles["analytics-search-icon"]}>
              <Search size={16} />
            </span>
            <input
              className={`${ui["ui-input"]} ui-input-sm ${styles["analytics-search-input"]}`}
              placeholder="Search reports..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className={styles["analytics-relative"]}>
            <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]} ${ui["ui-btn-sm"]}`} title="Filters" onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}>
              <Filter size={16} /> Filters
            </button>
            {showAdvancedFilters && (
              <div className={styles["analytics-popover"]}>
                <h4 className={styles["analytics-popover-title"]}>Advanced Filters</h4>
                <p className={`${dash["settings-text-muted"]} ${styles["analytics-text-xs"]} ${styles["analytics-mb-sm"]}`}>Filters apply to report visibility and chart previews.</p>
                <div className={`${ui["ui-form-group"]} ${styles["analytics-mb-sm"]}`}>
                  <label className={`${ui["ui-label"]} ${styles["analytics-text-xs"]}`}>Date Range</label>
                  <select className={`${ui["ui-input"]} ui-input-sm`} value={filters.dateFilter} onChange={(e) => updateFilter("dateFilter", e.target.value)}>
                    <option>All Time</option>
                    <option>Last 30 Days</option>
                    <option>This Year</option>
                  </select>
                </div>
                <div className={`${ui["ui-form-group"]} ${styles["analytics-mb-sm"]}`}>
                  <label className={`${ui["ui-label"]} ${styles["analytics-text-xs"]}`}>Lead Owner</label>
                  <select className={`${ui["ui-input"]} ui-input-sm`} value={filters.ownerFilter} onChange={(e) => updateFilter("ownerFilter", e.target.value)}>
                    <option>All</option>
                    <option>Me</option>
                    <option>My Team</option>
                  </select>
                </div>
                <div className={`${ui["ui-form-group"]} ${styles["analytics-mb-sm"]}`}>
                  <label className={`${ui["ui-label"]} ${styles["analytics-text-xs"]}`}>Team</label>
                  <select className={`${ui["ui-input"]} ui-input-sm`} value={filters.teamFilter} onChange={(e) => updateFilter("teamFilter", e.target.value)}>
                    <option>All</option>
                    <option>Team A</option>
                    <option>Team B</option>
                  </select>
                </div>
                <div className={`${ui["ui-form-group"]} ${styles["analytics-mb-sm"]}`}>
                  <label className={`${ui["ui-label"]} ${styles["analytics-text-xs"]}`}>Group</label>
                  <select className={`${ui["ui-input"]} ui-input-sm`} value={filters.groupFilter} onChange={(e) => updateFilter("groupFilter", e.target.value)}>
                    <option>All</option>
                    <option>Enterprise</option>
                    <option>SMB</option>
                  </select>
                </div>
                <div className={`${ui["ui-form-group"]} ${styles["analytics-mb-sm"]}`}>
                  <label className={`${ui["ui-label"]} ${styles["analytics-text-xs"]}`}>Stage</label>
                  <select className={`${ui["ui-input"]} ui-input-sm`} value={filters.stageFilter} onChange={(e) => updateFilter("stageFilter", e.target.value)}>
                    <option>All</option>
                    <option>Created</option>
                    <option>Level 1</option>
                    <option>Closed</option>
                  </select>
                </div>
                <div className={`${ui["ui-form-group"]} ${styles["analytics-mb-sm"]}`}>
                  <label className={`${ui["ui-label"]} ${styles["analytics-text-xs"]}`}>Source</label>
                  <select className={`${ui["ui-input"]} ui-input-sm`} value={filters.sourceFilter} onChange={(e) => updateFilter("sourceFilter", e.target.value)}>
                    <option>All</option>
                    <option>Organic</option>
                    <option>Paid</option>
                    <option>Referral</option>
                  </select>
                </div>
                <div className={`${ui["ui-form-group"]} ${styles["analytics-mb-sm"]}`}>
                  <label className={`${ui["ui-label"]} ${styles["analytics-text-xs"]}`}>Status</label>
                  <select className={`${ui["ui-input"]} ui-input-sm`} value={filters.statusFilter} onChange={(e) => updateFilter("statusFilter", e.target.value)}>
                    <option>All</option>
                    <option>Active</option>
                    <option>Inactive</option>
                  </select>
                </div>
                <div className={`${ui["ui-form-group"]} ${styles["analytics-mb-sm"]}`}>
                  <label className={`${ui["ui-label"]} ${styles["analytics-text-xs"]}`}>Activity Type</label>
                  <select className={`${ui["ui-input"]} ui-input-sm`} value={filters.activityTypeFilter} onChange={(e) => updateFilter("activityTypeFilter", e.target.value)}>
                    <option>All</option>
                    <option>Call</option>
                    <option>Email</option>
                    <option>Meeting</option>
                  </select>
                </div>
                <div className={`${ui["ui-form-group"]} ${styles["analytics-mb-sm"]}`}>
                  <label className={`${ui["ui-label"]} ${styles["analytics-text-xs"]}`}>Deal Stage</label>
                  <select className={`${ui["ui-input"]} ui-input-sm`} value={filters.dealStageFilter} onChange={(e) => updateFilter("dealStageFilter", e.target.value)}>
                    <option>All</option>
                    <option>Discovery</option>
                    <option>Proposal</option>
                    <option>Won</option>
                  </select>
                </div>
                <div className={`${ui["ui-form-group"]} ${styles["analytics-mb-sm"]}`}>
                  <label className={`${ui["ui-label"]} ${styles["analytics-text-xs"]}`}>Region</label>
                  <select className={`${ui["ui-input"]} ui-input-sm`} value={filters.regionFilter} onChange={(e) => updateFilter("regionFilter", e.target.value)}>
                    <option>All</option>
                    <option>NA</option>
                    <option>EMEA</option>
                    <option>APAC</option>
                  </select>
                </div>
                <div className={`${ui["ui-form-group"]} ${styles["analytics-mb-sm"]}`}>
                  <label className={`${ui["ui-label"]} ${styles["analytics-text-xs"]}`}>Custom Fields</label>
                  <input
                    className={`${ui["ui-input"]} ui-input-sm`}
                    placeholder="Any custom value..."
                    value={filters.customFieldsFilter}
                    onChange={(e) => updateFilter("customFieldsFilter", e.target.value)}
                  />
                </div>
                <button
                  className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]} ${ui["ui-btn-sm"]} ${styles["analytics-w-full"]}`}
                  onClick={() => {
                    setShowAdvancedFilters(false);
                    setToastMsg("Filters applied.");
                  }}
                >
                  Apply
                </button>
              </div>
            )}
          </div>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]} ${ui["ui-btn-sm"]}`} onClick={() => setIsCreating(true)}>
            <Plus size={16} /> Create Report
          </button>
        </div>
      </div>

      <div className={`${ui["ui-tabs"]} ${styles["analytics-tabs-row"]}`}>
        <button className={`${ui["ui-tab"]} ${subTab === "all" ? "active" : ""}`} onClick={() => setSubTab("all")}>
          All Reports
        </button>
        <button className={`${ui["ui-tab"]} ${subTab === "saved" ? "active" : ""}`} onClick={() => setSubTab("saved")}>
          Saved Reports
        </button>
        <button className={`${ui["ui-tab"]} ${subTab === "pinned" ? "active" : ""}`} onClick={() => setSubTab("pinned")}>
          Pinned Reports
        </button>
      </div>

      <div className={ui["ui-table-container"]}>
        <table className={ui["ui-table"]}>
          <thead>
            <tr>
              <th onClick={() => handleSort("name")} className={styles["analytics-cursor-pointer"]}>
                Report Name <ArrowUpDown size={14} className={styles["analytics-inline-icon"]} />
              </th>
              <th onClick={() => handleSort("type")} className={styles["analytics-cursor-pointer"]}>
                Type <ArrowUpDown size={14} className={styles["analytics-inline-icon"]} />
              </th>
              <th onClick={() => handleSort("date")} className={styles["analytics-cursor-pointer"]}>
                Last Updated <ArrowUpDown size={14} className={styles["analytics-inline-icon"]} />
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {subTab === "saved"
              ? visibleSavedReports.map((savedReport) => {
                  const baseReport = reports.find((report) => report.id === savedReport.baseReportId);
                  return (
                    <tr key={savedReport.id}>
                      <td>
                        <div className={styles["analytics-flex-row-center-gap"]}>
                          {savedReport.name}
                          {savedReport.pinned && (
                            <span title="Pinned">
                              <Pin size={14} className={styles["analytics-pinned-icon"]} />
                            </span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={`${ui["ui-badge"]} ui-badge-secondary`}>{baseReport?.type || "Custom"}</span>
                      </td>
                      <td>Saved</td>
                      <td>
                        <div className={styles["analytics-flex-gap-sm"]}>
                          <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]} ${ui["ui-btn-sm"]} ${styles["analytics-px-sm"]}`} onClick={() => openSavedReport(savedReport.id)}>
                            View
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              : filteredReports.map((report) => (
                  <tr key={report.id}>
                    <td>
                      <div className={styles["analytics-flex-row-center-gap"]}>
                        {report.name}
                        {report.pinned && (
                          <span title="Pinned">
                            <Pin size={14} className={styles["analytics-pinned-icon"]} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`${ui["ui-badge"]} ui-badge-secondary`}>{report.type}</span>
                    </td>
                    <td>{report.date}</td>
                    <td>
                      <div className={styles["analytics-flex-gap-sm"]}>
                        <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]} ${ui["ui-btn-sm"]} ${styles["analytics-px-sm"]}`} onClick={() => openReport(report.id)}>
                          View
                        </button>
                        <button
                          className={`${ui["ui-btn"]} ${report.pinned ? ui["ui-btn-primary"] : ui["ui-btn-secondary"]} ${ui["ui-btn-sm"]} ${styles["analytics-p-sm"]}`}
                          title={report.pinned ? "Unpin Report" : "Pin Report"}
                          onClick={() => pinReport(report.id, !report.pinned)}
                        >
                          <Pin size={14} />
                        </button>
                        <button
                          className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]} ${ui["ui-btn-sm"]} ${styles["analytics-p-sm"]}`}
                          title="Export"
                          onClick={() => setExportingReportId(report.id)}
                        >
                          <Download size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            {visibleRowsCount === 0 && (
              <tr>
                <td colSpan={4} className={styles["analytics-table-empty"]}>
                  No reports found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isCreating && (
        <div className={ui["ui-modal-overlay"]}>
          <div className={ui["ui-modal"]}>
            <div className={ui["ui-modal-header"]}>
              <h2 className={ui["ui-modal-title"]}>Create New Report</h2>
              <button className={ui["ui-modal-close"]} onClick={() => setIsCreating(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="ui-modal-content">
              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>Report Name</label>
                <input className={ui["ui-input"]} value={newReportName} onChange={(e) => setNewReportName(e.target.value)} placeholder="e.g., Q3 Sales Pipeline" />
              </div>
              <div className={`${ui["ui-form-group"]} ${styles["analytics-mt-md"]}`}>
                <label className={ui["ui-label"]}>Report Type</label>
                <select className={ui["ui-input"]} value={newReportType} onChange={(e) => setNewReportType(e.target.value)}>
                  <option value="Summary">Summary</option>
                  <option value="Pipeline">Pipeline</option>
                  <option value="Performance">Performance</option>
                  <option value="Activity">Activity</option>
                  <option value="Financial">Financial</option>
                </select>
              </div>
            </div>
            <div className={ui["ui-modal-footer"]}>
              <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={() => setIsCreating(false)}>
                Cancel
              </button>
              <button
                className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`}
                disabled={!newReportName}
                onClick={() => {
                  saveReport({
                    id: createAnalyticsId("report", [newReportName, newReportType, userId, reports.length]),
                    name: newReportName,
                    type: newReportType,
                    date: new Date().toISOString().split("T")[0],
                    pinned: false,
                    ownerId: userId,
                    isTeamReport: dashboardMode === "team",
                    ownerLabel: "Me",
                    teamId: dashboardMode === "team" ? userContext.teamId : undefined,
                    groupId: userContext.groupId,
                    roleAccess: [user?.role || "EMPLOYEE"],
                    stage: filters.stageFilter === "All" ? "Created" : filters.stageFilter,
                    source: filters.sourceFilter === "All" ? "Organic" : filters.sourceFilter,
                    status: filters.statusFilter === "All" ? "Active" : filters.statusFilter,
                    activityType: filters.activityTypeFilter === "All" ? "Call" : filters.activityTypeFilter,
                    dealStage: filters.dealStageFilter === "All" ? "Discovery" : filters.dealStageFilter,
                    region: filters.regionFilter === "All" ? "NA" : filters.regionFilter,
                    customFields: [newReportType.toLowerCase(), filters.customFieldsFilter || "custom"],
                    data: {},
                  });
                  setIsCreating(false);
                  setNewReportName("");
                }}
              >
                Create Report
              </button>
            </div>
          </div>
        </div>
      )}

      {renderExportModal(filters)}
      {toastMsg && <Toast message={toastMsg} onClose={() => setToastMsg(null)} />}
    </div>
  );
}
