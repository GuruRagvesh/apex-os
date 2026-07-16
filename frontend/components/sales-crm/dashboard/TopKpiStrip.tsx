"use client";

import { DashboardData, filterLeadsFromDashboard } from "@/lib/sales-crm/dashboard-calculations";
import styles from "@/styles/sales-crm/dashboard.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";
import { Users, Target, ClipboardList, Handshake, Plus, Percent, Briefcase, DollarSign } from "lucide-react";

export default function TopKpiStrip({ data }: { data: DashboardData }) {
  return (
    <>
    <div className={styles["dash-kpi-strip"]}>
      {/* 1. Total Leads */}
      <div
        className={`${styles["dash-kpi-card"]} ${ui["ui-card"]} ${ui["ui-card-interactive"]}`}
        onClick={() => filterLeadsFromDashboard("view", "all")}
      >
        <div className={styles["dash-kpi-header"]}>
          <span className={styles["dash-kpi-title"]}>Total Leads</span>
          <span className={`${styles["dash-kpi-icon"]} ${styles["dash-kpi-icon-primary"]}`}><Users size={20} /></span>
        </div>
        <div className={styles["dash-kpi-body"]}>
          <span className={styles["dash-kpi-value"]}>{data.totalLeads}</span>
          <div className={styles["dash-kpi-trend"]}>
            <span className={styles["dash-kpi-trend-positive"]}>↑ 12%</span> vs last week
          </div>
        </div>
        {/* Mini trend line placeholder */}
        <div className={`${styles["dash-kpi-sparkline"]} ${styles["dash-kpi-sparkline-primary"]}`} />
      </div>

      {/* 2. Active Leads */}
      <div
        className={`${styles["dash-kpi-card"]} ${ui["ui-card"]} ${ui["ui-card-interactive"]}`}
        onClick={() => filterLeadsFromDashboard("status", "active")}
      >
        <div className={styles["dash-kpi-header"]}>
          <span className={styles["dash-kpi-title"]}>Active Leads</span>
          <span className={`${styles["dash-kpi-icon"]} ${styles["dash-kpi-icon-success"]}`}><Target size={20} /></span>
        </div>
        <div className={`${styles["dash-kpi-body"]} ${styles["dash-kpi-body--row"]}`}>
          <span className={styles["dash-kpi-value"]}>{data.activeLeads}</span>
          <div className={styles["dash-kpi-ring-container"]}>
            <div className={styles["dash-kpi-ring"]} style={Object.assign({}, { background: `conic-gradient(var(--color-success) ${data.activeLeadsPercentage}%, var(--color-border) 0)` })}>
              <div className={styles["dash-kpi-ring-inner"]}>{data.activeLeadsPercentage}%</div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Requirements Captured */}
      <div
        className={`${styles["dash-kpi-card"]} ${ui["ui-card"]} ${ui["ui-card-interactive"]}`}
        onClick={() => filterLeadsFromDashboard("has", "requirements")}
      >
        <div className={styles["dash-kpi-header"]}>
          <span className={styles["dash-kpi-title"]}>Requirements</span>
          <span className={`${styles["dash-kpi-icon"]} ${styles["dash-kpi-icon-warning"]}`}><ClipboardList size={20} /></span>
        </div>
        <div className={styles["dash-kpi-body"]}>
          <span className={styles["dash-kpi-value"]}>{data.requirementsCaptured.total}</span>
          <div className={styles["dash-kpi-split"]}>
            <span className={`${ui["ui-badge"]} ${ui["ui-badge-primary"]}`} title="New">{data.requirementsCaptured.new}</span>
            <span className={`${ui["ui-badge"]} ${ui["ui-badge-warning"]}`} title="In Progress">{data.requirementsCaptured.inProgress}</span>
            <span className={`${ui["ui-badge"]} ${ui["ui-badge-success"]}`} title="Converted">{data.requirementsCaptured.converted}</span>
          </div>
        </div>
      </div>

      {/* 4. Active Deals */}
      <div
        className={`${styles["dash-kpi-card"]} ${ui["ui-card"]} ${ui["ui-card-interactive"]}`}
        onClick={() => filterLeadsFromDashboard("has", "deals")}
      >
        <div className={styles["dash-kpi-header"]}>
          <span className={styles["dash-kpi-title"]}>Active Deals</span>
          <span className={`${styles["dash-kpi-icon"]} ${styles["dash-kpi-icon-success-soft"]}`}><Handshake size={20} /></span>
        </div>
        <div className={styles["dash-kpi-body"]}>
          <span className={styles["dash-kpi-value"]}>{data.activeDeals.count}</span>
          <span className={styles["dash-kpi-subvalue"]}>${data.activeDeals.value.toLocaleString()}</span>
        </div>
        <div className={`${styles["dash-kpi-sparkline"]} ${styles["dash-kpi-sparkline-success"]}`} />
      </div>
    </div>

    <div className={`${styles["dash-kpi-strip"]} ${styles["dash-kpi-strip-secondary"]}`}>
      {/* 5. New Leads */}
      <div className={`${styles["dash-kpi-card"]} ${ui["ui-card"]}`}>
        <div className={styles["dash-kpi-header"]}>
          <span className={styles["dash-kpi-title"]}>New Leads</span>
          <span className={`${styles["dash-kpi-icon"]} ${styles["dash-kpi-icon-primary-soft"]}`}><Plus size={20} /></span>
        </div>
        <div className={styles["dash-kpi-body"]}>
          <span className={styles["dash-kpi-value"]}>{data.newLeads}</span>
        </div>
      </div>

      {/* 6. Conversion Rate */}
      <div className={`${styles["dash-kpi-card"]} ${ui["ui-card"]}`}>
        <div className={styles["dash-kpi-header"]}>
          <span className={styles["dash-kpi-title"]}>Conversion Rate</span>
          <span className={`${styles["dash-kpi-icon"]} ${styles["dash-kpi-icon-success-soft"]}`}><Percent size={20} /></span>
        </div>
        <div className={styles["dash-kpi-body"]}>
          <span className={styles["dash-kpi-value"]}>{data.conversionRate}%</span>
        </div>
      </div>

      {/* 7. Opportunity Pipeline */}
      <div className={`${styles["dash-kpi-card"]} ${ui["ui-card"]}`}>
        <div className={styles["dash-kpi-header"]}>
          <span className={styles["dash-kpi-title"]}>Pipeline Value</span>
          <span className={`${styles["dash-kpi-icon"]} ${styles["dash-kpi-icon-warning-soft"]}`}><Briefcase size={20} /></span>
        </div>
        <div className={styles["dash-kpi-body"]}>
          <span className={styles["dash-kpi-value"]}>${data.opportunityValue.toLocaleString()}</span>
          <span className={styles["dash-kpi-subvalue"]}>{data.opportunityPipeline} active opps</span>
        </div>
      </div>

      {/* 8. Revenue */}
      <div className={`${styles["dash-kpi-card"]} ${ui["ui-card"]}`}>
        <div className={styles["dash-kpi-header"]}>
          <span className={styles["dash-kpi-title"]}>Revenue</span>
          <span className={`${styles["dash-kpi-icon"]} ${styles["dash-kpi-icon-success-soft"]}`}><DollarSign size={20} /></span>
        </div>
        <div className={styles["dash-kpi-body"]}>
          <span className={styles["dash-kpi-value"]}>${data.revenue.toLocaleString()}</span>
        </div>
      </div>
    </div>
    </>
  );
}
