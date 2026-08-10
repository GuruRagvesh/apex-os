"use client";

import { useMemo, useState } from "react";
import { Download, Expand, LayoutGrid, Maximize2, Pin, RefreshCw, X } from "lucide-react";
import Chart, { ChartDataPoint, ChartType } from "@/components/sales-crm/ui/Chart";
import { useAnalyticsStore } from "@/lib/sales-crm/analytics-store";
import { downloadReportExport } from "@/lib/sales-crm/report-output";
import Toast from "@apex/sales-crm-shared/components/Toast";
import styles from "@/styles/sales-crm/analytics.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

type DashboardMode = "personal" | "team";
type Density = "compact" | "comfortable";
type ColumnCount = 2 | 3 | 4;

type AnalyticsFilters = {
  dateRange: string;
  owner: string;
  team: string;
  department: string;
  region: string;
  leadSource: string;
  leadStatus: string;
  dealStage: string;
  activityType: string;
};

type ChartSpec = {
  id: string;
  title: string;
  dashboard: string;
  type: ChartType;
  metric: string;
  trend: string;
  trendDirection: "up" | "down" | "flat";
  context: string;
  owner: string;
  team: string;
  department: string;
  region: string;
  leadSource: string;
  leadStatus: string;
  dealStage: string;
  activityType: string;
  lastUpdated: string;
  data: ChartDataPoint[];
};

const DASHBOARD_LAYOUTS = ["Sales Overview", "Lead Analytics", "Deal Analytics", "Activity Analytics", "Manager View"];

const DEFAULT_FILTERS: AnalyticsFilters = {
  dateRange: "Last 90 Days",
  owner: "All",
  team: "All",
  department: "All",
  region: "All",
  leadSource: "All",
  leadStatus: "All",
  dealStage: "All",
  activityType: "All",
};

const CHARTS: ChartSpec[] = [
  {
    id: "lead-status-distribution",
    title: "Lead Status Distribution",
    dashboard: "Lead Analytics",
    type: "donut",
    metric: "1,248 leads",
    trend: "+8.4%",
    trendDirection: "up",
    context: "Open vs qualified lead mix",
    owner: "All",
    team: "North Sales",
    department: "Sales",
    region: "West",
    leadSource: "All",
    leadStatus: "Active",
    dealStage: "All",
    activityType: "All",
    lastUpdated: "08 Jul 2026, 09:20",
    data: [
      { label: "New", value: 320 },
      { label: "Qualified", value: 410 },
      { label: "Proposal", value: 270 },
      { label: "Closed", value: 248 },
    ],
  },
  {
    id: "lead-source-performance",
    title: "Lead Source Performance",
    dashboard: "Lead Analytics",
    type: "column",
    metric: "34.6% conversion",
    trend: "+3.1%",
    trendDirection: "up",
    context: "Source to qualified rate",
    owner: "All",
    team: "North Sales",
    department: "Marketing",
    region: "All",
    leadSource: "Organic",
    leadStatus: "Active",
    dealStage: "All",
    activityType: "All",
    lastUpdated: "08 Jul 2026, 09:18",
    data: [
      { label: "Organic", value: 46 },
      { label: "Paid", value: 31 },
      { label: "Referral", value: 38 },
      { label: "Events", value: 29 },
    ],
  },
  {
    id: "pipeline-stage-conversion",
    title: "Pipeline Stage Conversion",
    dashboard: "Sales Overview",
    type: "bar",
    metric: "62.2% stage yield",
    trend: "-1.7%",
    trendDirection: "down",
    context: "Stage-to-stage movement",
    owner: "All",
    team: "Enterprise",
    department: "Sales",
    region: "North",
    leadSource: "All",
    leadStatus: "Qualified",
    dealStage: "Proposal",
    activityType: "All",
    lastUpdated: "08 Jul 2026, 09:16",
    data: [
      { label: "L0", value: 82 },
      { label: "L1", value: 74 },
      { label: "L2", value: 58 },
      { label: "L3", value: 43 },
      { label: "Won", value: 31 },
    ],
  },
  {
    id: "monthly-lead-trend",
    title: "Monthly Lead Trend",
    dashboard: "Sales Overview",
    type: "area",
    metric: "412 new this month",
    trend: "+12.8%",
    trendDirection: "up",
    context: "Lead inflow by month",
    owner: "All",
    team: "All",
    department: "Sales",
    region: "All",
    leadSource: "All",
    leadStatus: "Active",
    dealStage: "All",
    activityType: "All",
    lastUpdated: "08 Jul 2026, 09:14",
    data: [
      { label: "Feb", value: 260 },
      { label: "Mar", value: 310 },
      { label: "Apr", value: 290 },
      { label: "May", value: 360 },
      { label: "Jun", value: 388 },
      { label: "Jul", value: 412 },
    ],
  },
  {
    id: "deal-value-by-stage",
    title: "Deal Value by Stage",
    dashboard: "Deal Analytics",
    type: "column",
    metric: "INR 4.8 Cr open",
    trend: "+5.6%",
    trendDirection: "up",
    context: "Weighted value by stage",
    owner: "All",
    team: "Enterprise",
    department: "Sales",
    region: "West",
    leadSource: "All",
    leadStatus: "All",
    dealStage: "Negotiation",
    activityType: "All",
    lastUpdated: "08 Jul 2026, 09:12",
    data: [
      { label: "Discovery", value: 80 },
      { label: "Proposal", value: 140 },
      { label: "Negotiate", value: 190 },
      { label: "Won", value: 70 },
    ],
  },
  {
    id: "revenue-forecast",
    title: "Revenue Forecast",
    dashboard: "Deal Analytics",
    type: "line",
    metric: "INR 7.2 Cr forecast",
    trend: "+9.2%",
    trendDirection: "up",
    context: "Forecast vs target",
    owner: "All",
    team: "Enterprise",
    department: "Finance",
    region: "All",
    leadSource: "All",
    leadStatus: "All",
    dealStage: "Won",
    activityType: "All",
    lastUpdated: "08 Jul 2026, 09:10",
    data: [
      { label: "Jul", value: 110 },
      { label: "Aug", value: 132 },
      { label: "Sep", value: 148 },
      { label: "Oct", value: 170 },
      { label: "Nov", value: 196 },
    ],
  },
  {
    id: "activity-completion-trend",
    title: "Activity Completion Trend",
    dashboard: "Activity Analytics",
    type: "area",
    metric: "87% completed",
    trend: "+4.0%",
    trendDirection: "up",
    context: "Tasks and sales activities",
    owner: "Me",
    team: "North Sales",
    department: "Pre-Sales",
    region: "North",
    leadSource: "All",
    leadStatus: "Active",
    dealStage: "All",
    activityType: "Meeting",
    lastUpdated: "08 Jul 2026, 09:08",
    data: [
      { label: "Mon", value: 78 },
      { label: "Tue", value: 84 },
      { label: "Wed", value: 81 },
      { label: "Thu", value: 89 },
      { label: "Fri", value: 87 },
    ],
  },
  {
    id: "follow-up-overdue-trend",
    title: "Follow-up Overdue Trend",
    dashboard: "Activity Analytics",
    type: "line",
    metric: "46 overdue",
    trend: "-11.5%",
    trendDirection: "up",
    context: "Lower is better",
    owner: "Me",
    team: "North Sales",
    department: "Pre-Sales",
    region: "West",
    leadSource: "Referral",
    leadStatus: "Active",
    dealStage: "All",
    activityType: "Call",
    lastUpdated: "08 Jul 2026, 09:06",
    data: [
      { label: "W1", value: 78 },
      { label: "W2", value: 68 },
      { label: "W3", value: 55 },
      { label: "W4", value: 46 },
    ],
  },
  {
    id: "owner-performance",
    title: "Owner Performance",
    dashboard: "Manager View",
    type: "bar",
    metric: "Top owner 142 pts",
    trend: "+6.8%",
    trendDirection: "up",
    context: "Composite activity score",
    owner: "All",
    team: "North Sales",
    department: "Sales",
    region: "North",
    leadSource: "All",
    leadStatus: "Qualified",
    dealStage: "All",
    activityType: "All",
    lastUpdated: "08 Jul 2026, 09:04",
    data: [
      { label: "Priya", value: 142 },
      { label: "Rahul", value: 128 },
      { label: "Anita", value: 116 },
      { label: "Sneha", value: 105 },
    ],
  },
  {
    id: "team-performance",
    title: "Team Performance",
    dashboard: "Manager View",
    type: "column",
    metric: "North +14%",
    trend: "+2.9%",
    trendDirection: "up",
    context: "Team target attainment",
    owner: "All",
    team: "North Sales",
    department: "Sales",
    region: "North",
    leadSource: "All",
    leadStatus: "All",
    dealStage: "All",
    activityType: "All",
    lastUpdated: "08 Jul 2026, 09:02",
    data: [
      { label: "North", value: 114 },
      { label: "West", value: 96 },
      { label: "South", value: 88 },
      { label: "East", value: 93 },
    ],
  },
  {
    id: "region-performance",
    title: "Region Performance",
    dashboard: "Manager View",
    type: "donut",
    metric: "West 38% share",
    trend: "Flat",
    trendDirection: "flat",
    context: "Revenue contribution",
    owner: "All",
    team: "All",
    department: "Sales",
    region: "West",
    leadSource: "All",
    leadStatus: "All",
    dealStage: "Won",
    activityType: "All",
    lastUpdated: "08 Jul 2026, 09:00",
    data: [
      { label: "North", value: 24 },
      { label: "West", value: 38 },
      { label: "South", value: 20 },
      { label: "East", value: 18 },
    ],
  },
  {
    id: "sla-breach-overview",
    title: "SLA Breach Overview",
    dashboard: "Activity Analytics",
    type: "bar",
    metric: "18 breach risks",
    trend: "-7.3%",
    trendDirection: "up",
    context: "Profile, sourcing, payment SLA",
    owner: "All",
    team: "All",
    department: "Operations",
    region: "All",
    leadSource: "All",
    leadStatus: "Active",
    dealStage: "All",
    activityType: "Email",
    lastUpdated: "08 Jul 2026, 08:58",
    data: [
      { label: "Profile", value: 7 },
      { label: "Sourcing", value: 5 },
      { label: "Payment", value: 3 },
      { label: "Follow-up", value: 3 },
    ],
  },
];

const filterOptions: Record<keyof AnalyticsFilters, string[]> = {
  dateRange: ["Last 30 Days", "Last 90 Days", "This Quarter", "This Year"],
  owner: ["All", "Me"],
  team: ["All", "North Sales", "Enterprise"],
  department: ["All", "Sales", "Pre-Sales", "Marketing", "Finance", "Operations"],
  region: ["All", "North", "West", "South", "East"],
  leadSource: ["All", "Organic", "Paid", "Referral"],
  leadStatus: ["All", "Active", "Qualified"],
  dealStage: ["All", "Discovery", "Proposal", "Negotiation", "Won"],
  activityType: ["All", "Call", "Email", "Meeting"],
};

function matchesFilter(value: string, filterValue: string) {
  return filterValue === "All" || value === "All" || value === filterValue;
}

function getFilteredCharts(charts: ChartSpec[], filters: AnalyticsFilters, dashboard: string) {
  return charts.filter((chart) => {
    if (dashboard !== "Sales Overview" && chart.dashboard !== dashboard) return false;
    if (!matchesFilter(chart.owner, filters.owner)) return false;
    if (!matchesFilter(chart.team, filters.team)) return false;
    if (!matchesFilter(chart.department, filters.department)) return false;
    if (!matchesFilter(chart.region, filters.region)) return false;
    if (!matchesFilter(chart.leadSource, filters.leadSource)) return false;
    if (!matchesFilter(chart.leadStatus, filters.leadStatus)) return false;
    if (!matchesFilter(chart.dealStage, filters.dealStage)) return false;
    if (!matchesFilter(chart.activityType, filters.activityType)) return false;
    return true;
  });
}

export default function DashboardGrid({ dashboardMode }: { dashboardMode: DashboardMode }) {
  const { logAction } = useAnalyticsStore();
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);
  const [activeDashboard, setActiveDashboard] = useState(DASHBOARD_LAYOUTS[0]);
  const [density, setDensity] = useState<Density>("compact");
  const [columns, setColumns] = useState<ColumnCount>(4);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set(["lead-status-distribution", "revenue-forecast"]));
  const [expandedChart, setExpandedChart] = useState<ChartSpec | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const visibleCharts = useMemo(() => {
    const base = getFilteredCharts(CHARTS, filters, activeDashboard);
    return dashboardMode === "personal" ? base.filter((chart) => chart.owner === "Me" || chart.owner === "All") : base;
  }, [activeDashboard, dashboardMode, filters]);

  const activeFilterCount = Object.entries(filters).filter(([key, value]) => (key === "dateRange" ? value !== DEFAULT_FILTERS.dateRange : value !== "All")).length;

  const totalDataPoints = visibleCharts.reduce((sum, chart) => sum + chart.data.reduce((innerSum, point) => innerSum + point.value, 0), 0);

  const updateFilter = (key: keyof AnalyticsFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const handleExport = async (chart: ChartSpec) => {
    try {
      // Adapted: intern hardcoded format: "excel" here (no format picker on
      // this one-click icon button, unlike ReportsView's ExportModal flow).
      // Since Step 3's downloadReportExport() now throws for "excel" (xlsx
      // is disabled pending package approval), that would make every
      // "Export chart" click fail with a generic error and no working
      // alternative. Defaulting to "pdf" here is the same fix already
      // applied to ExportModal.tsx's default format, applied to this
      // second, picker-less export entry point so it actually works.
      const fileName = await downloadReportExport(
        { format: "pdf", fileName: `${chart.title}_Chart` },
        {
          title: chart.title,
          subtitle: chart.context,
          generatedAt: new Date().toISOString(),
          context: {
            dashboard: chart.dashboard,
            dashboardMode,
            metric: chart.metric,
            trend: chart.trend,
            department: chart.department,
            region: chart.region,
            lastUpdated: chart.lastUpdated,
          },
          filters,
          sections: [
            {
              title: "Chart Data",
              rows: chart.data.map((point) => ({ ...point })),
            },
          ],
        }
      );
      logAction({
        type: "ExportDashboardChart",
        chartId: chart.id,
        chartTitle: chart.title,
        fileName,
        filters,
        exportedAt: new Date().toISOString(),
      });
      setToast(`${fileName} downloaded successfully.`);
    } catch {
      setToast("Chart export failed. Please try again.");
    }
  };

  const togglePin = (chartId: string) => {
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(chartId)) next.delete(chartId);
      else next.add(chartId);
      return next;
    });
  };

  return (
    <div className={styles["analytics-command-center"]}>
      <section className={styles["analytics-kpi-strip"]}>
        <div className={styles["analytics-kpi-card"]}>
          <span className={styles["analytics-kpi-label"]}>Visible Charts</span>
          <strong className={styles["analytics-kpi-value"]}>{visibleCharts.length}</strong>
          <span className={styles["analytics-kpi-note"]}>of {CHARTS.length} configured</span>
        </div>
        <div className={styles["analytics-kpi-card"]}>
          <span className={styles["analytics-kpi-label"]}>Tracked Volume</span>
          <strong className={styles["analytics-kpi-value"]}>{totalDataPoints.toLocaleString("en-IN")}</strong>
          <span className={styles["analytics-kpi-note"]}>{filters.dateRange}</span>
        </div>
        <div className={styles["analytics-kpi-card"]}>
          <span className={styles["analytics-kpi-label"]}>Pinned Views</span>
          <strong className={styles["analytics-kpi-value"]}>{pinnedIds.size}</strong>
          <span className={styles["analytics-kpi-note"]}>quick review set</span>
        </div>
        <div className={styles["analytics-kpi-card"]}>
          <span className={styles["analytics-kpi-label"]}>Active Filters</span>
          <strong className={styles["analytics-kpi-value"]}>{activeFilterCount}</strong>
          <span className={styles["analytics-kpi-note"]}>{dashboardMode === "team" ? "Team" : "Personal"} mode</span>
        </div>
      </section>

      <section className={styles["analytics-control-panel"]}>
        <div className={styles["analytics-control-main"]}>
          <div className={styles["analytics-dashboard-tabs"]}>
            {DASHBOARD_LAYOUTS.map((layout) => (
              <button
                key={layout}
                type="button"
                className={`${styles["analytics-dashboard-tab"]} ${activeDashboard === layout ? styles["analytics-dashboard-tab-active"] : ""}`}
                onClick={() => setActiveDashboard(layout)}
              >
                {layout}
              </button>
            ))}
          </div>

          <div className={styles["analytics-filter-grid"]}>
            {(Object.keys(filterOptions) as Array<keyof AnalyticsFilters>).map((key) => (
              <label key={key} className={styles["analytics-filter-field"]}>
                <span>{key.replace(/([A-Z])/g, " $1")}</span>
                <select className={`${ui["ui-select"]} ui-select-sm`} value={filters[key]} onChange={(event) => updateFilter(key, event.target.value)}>
                  {filterOptions[key].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>

        <div className={styles["analytics-layout-tools"]}>
          <div className={styles["analytics-layout-tool-group"]}>
            <span className={styles["analytics-tool-label"]}>Density</span>
            <button
              type="button"
              className={`${styles["analytics-tool-button"]} ${density === "compact" ? styles["analytics-tool-button-active"] : ""}`}
              onClick={() => setDensity("compact")}
            >
              Compact
            </button>
            <button
              type="button"
              className={`${styles["analytics-tool-button"]} ${density === "comfortable" ? styles["analytics-tool-button-active"] : ""}`}
              onClick={() => setDensity("comfortable")}
            >
              Comfortable
            </button>
          </div>

          <div className={styles["analytics-layout-tool-group"]}>
            <span className={styles["analytics-tool-label"]}>Columns</span>
            {[2, 3, 4].map((count) => (
              <button
                key={count}
                type="button"
                className={`${styles["analytics-icon-tool"]} ${columns === count ? styles["analytics-tool-button-active"] : ""}`}
                onClick={() => setColumns(count as ColumnCount)}
                title={`${count} columns`}
              >
                <LayoutGrid size={14} />
                {count}
              </button>
            ))}
          </div>

          <button type="button" className={styles["analytics-tool-button"]} onClick={() => setFilters(DEFAULT_FILTERS)}>
            <RefreshCw size={14} />
            Reset
          </button>
        </div>
      </section>

      <section className={`${styles["analytics-chart-grid"]} ${styles[`analytics-chart-grid-${columns}`]} ${styles[`analytics-density-${density}`]}`}>
        {visibleCharts.map((chart) => (
          <article key={chart.id} className={styles["analytics-chart-card"]}>
            <div className={styles["analytics-chart-card-header"]}>
              <div>
                <h3 className={styles["analytics-chart-card-title"]}>{chart.title}</h3>
                <p className={styles["analytics-chart-card-context"]}>{chart.context}</p>
              </div>
              <div className={styles["analytics-chart-card-actions"]}>
                <button
                  type="button"
                  className={`${styles["analytics-card-action"]} ${pinnedIds.has(chart.id) ? styles["analytics-card-action-active"] : ""}`}
                  title={pinnedIds.has(chart.id) ? "Unpin chart" : "Pin chart"}
                  onClick={() => togglePin(chart.id)}
                >
                  <Pin size={14} />
                </button>
                <button type="button" className={styles["analytics-card-action"]} title="Export chart" onClick={() => handleExport(chart)}>
                  <Download size={14} />
                </button>
                <button type="button" className={styles["analytics-card-action"]} title="Expand chart" onClick={() => setExpandedChart(chart)}>
                  <Expand size={14} />
                </button>
              </div>
            </div>

            <div className={styles["analytics-chart-card-meta"]}>
              <strong>{chart.metric}</strong>
              <span className={`${styles["analytics-trend"]} ${styles[`analytics-trend-${chart.trendDirection}`]}`}>{chart.trend}</span>
            </div>

            <div className={styles["analytics-chart-card-body"]}>
              <Chart type={chart.type} data={chart.data} height={density === "compact" ? 170 : 240} />
            </div>

            <div className={styles["analytics-chart-card-footer"]}>
              <span>{chart.dashboard}</span>
              <span>
                {chart.department} / {chart.region}
              </span>
              <span>Updated {chart.lastUpdated}</span>
            </div>
          </article>
        ))}

        {visibleCharts.length === 0 && (
          <div className={styles["analytics-empty-dashboard"]}>
            <Maximize2 size={28} />
            <strong>No charts match the current filters.</strong>
            <span>Reset filters or switch dashboard layout to recover the chart grid.</span>
          </div>
        )}
      </section>

      {expandedChart && (
        <div className={ui["ui-modal-overlay"]}>
          <div className={`${ui["ui-modal"]} ${styles["analytics-chart-modal"]}`}>
            <div className={ui["ui-modal-header"]}>
              <div>
                <h2 className={ui["ui-modal-title"]}>{expandedChart.title}</h2>
                <p className={styles["analytics-chart-card-context"]}>{expandedChart.context}</p>
              </div>
              <button className={ui["ui-modal-close"]} type="button" onClick={() => setExpandedChart(null)}>
                <X size={20} />
              </button>
            </div>
            <div className={`ui-modal-content ${styles["analytics-chart-modal-content"]}`}>
              <div className={styles["analytics-chart-modal-summary"]}>
                <span>{expandedChart.metric}</span>
                <span className={`${styles["analytics-trend"]} ${styles[`analytics-trend-${expandedChart.trendDirection}`]}`}>{expandedChart.trend}</span>
                <span>
                  {expandedChart.department} / {expandedChart.region}
                </span>
                <span>{filters.dateRange}</span>
              </div>
              <Chart type={expandedChart.type} data={expandedChart.data} height={360} />
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
