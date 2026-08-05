import React from "react";
import { DashboardData } from "@/lib/sales-crm/dashboard-calculations";
import TopKpiStrip from "./TopKpiStrip";
import LeadFunnel from "./LeadFunnel";
import TodayActionBoard from "./TodayActionBoard";
import OwnerPerformance from "./OwnerPerformance";
import NeedsAttention from "./NeedsAttention";
import Chart, { ChartDataPoint } from "@/components/sales-crm/ui/Chart";
import styles from "@/styles/sales-crm/dashboard.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

interface SalesDashboardProps {
  data: DashboardData;
  dashboardType: string;
}

export default function SalesDashboard({ data, dashboardType }: SalesDashboardProps) {

  const renderSalesDashboard = () => (
    <>
      <TopKpiStrip data={data} />
      <div className={`${styles["dash-row"]} ${styles["analytics-tabs-container"]}`}>
        <LeadFunnel data={data.leadFunnel} />
        <TodayActionBoard data={data.todayActionBoard} />
      </div>
      <div className={styles["dash-row"]}>
        <OwnerPerformance data={data.ownerPerformance} />
        <NeedsAttention data={data.needsAttention} />
      </div>
    </>
  );

  const renderLeadDashboard = () => {
    const leadData: ChartDataPoint[] = data.leadFunnel.map(f => ({ label: f.groupName, value: f.count }));
    const conversionData: ChartDataPoint[] = [
      { label: "New", value: data.newLeads },
      { label: "Active", value: data.activeLeads },
      { label: "Converted", value: Math.floor(data.totalLeads * (data.conversionRate / 100)) }
    ];

    return (
      <>
        <div className={`${styles["analytics-flex-gap"]} ${styles["analytics-mb-md"]}`}>
           <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]}`}><h4 className={ui["ui-label"]}>Total Leads</h4><h2 className={styles["dash-kpi-value"]}>{data.totalLeads}</h2></div>
           <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]}`}><h4 className={ui["ui-label"]}>Active Leads</h4><h2 className={styles["dash-kpi-value"]}>{data.activeLeads}</h2></div>
           <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]}`}><h4 className={ui["ui-label"]}>New Leads</h4><h2 className={styles["dash-kpi-value"]}>{data.newLeads}</h2></div>
           <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]}`}><h4 className={ui["ui-label"]}>Conversion</h4><h2 className={styles["dash-kpi-value"]}>{data.conversionRate}%</h2></div>
        </div>
        <div className={styles["dash-row"]}>
          <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]} ${styles["analytics-h-350"]}`}>
            <Chart type="column" data={leadData} title="Lead Pipeline" />
          </div>
          <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]} ${styles["analytics-h-350"]}`}>
            <Chart type="donut" data={conversionData} title="Lead Status Breakdown" />
          </div>
        </div>
      </>
    );
  };

  const renderDealsDashboard = () => {
    const revenueData: ChartDataPoint[] = [
      { label: "Q1", value: data.revenue * 0.2 },
      { label: "Q2", value: data.revenue * 0.3 },
      { label: "Q3", value: data.revenue * 0.4 },
      { label: "Q4", value: data.revenue * 0.1 },
    ];

    return (
      <>
        <div className={`${styles["analytics-flex-gap"]} ${styles["analytics-mb-md"]}`}>
           <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]}`}><h4 className={ui["ui-label"]}>Active Deals</h4><h2 className={styles["dash-kpi-value"]}>{data.activeDeals.count}</h2></div>
           <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]}`}><h4 className={ui["ui-label"]}>Pipeline Value</h4><h2 className={styles["dash-kpi-value"]}>${data.opportunityValue.toLocaleString()}</h2></div>
           <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]}`}><h4 className={ui["ui-label"]}>Revenue</h4><h2 className={styles["dash-kpi-value"]}>${data.revenue.toLocaleString()}</h2></div>
        </div>
        <div className={styles["dash-row"]}>
          <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]} ${styles["analytics-h-350"]}`}>
            <Chart type="area" data={revenueData} title="Revenue Trend" />
          </div>
        </div>
      </>
    );
  };

  const renderActivityDashboard = () => {
    const activityData: ChartDataPoint[] = [
      { label: "Calls", value: data.todayActionBoard.summary.callsDue },
      { label: "Meetings", value: data.todayActionBoard.summary.meetingsToday },
      { label: "Follow-ups", value: data.todayActionBoard.summary.followupsDue },
    ];

    return (
      <>
        <div className={`${styles["analytics-flex-gap"]} ${styles["analytics-mb-md"]}`}>
           <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]}`}><h4 className={ui["ui-label"]}>Calls Due</h4><h2 className={styles["dash-kpi-value"]}>{data.todayActionBoard.summary.callsDue}</h2></div>
           <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]}`}><h4 className={ui["ui-label"]}>Meetings</h4><h2 className={styles["dash-kpi-value"]}>{data.todayActionBoard.summary.meetingsToday}</h2></div>
           <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]}`}><h4 className={ui["ui-label"]}>Total Follow-ups</h4><h2 className={styles["dash-kpi-value"]}>{data.todayActionBoard.summary.followupsDue}</h2></div>
        </div>
        <div className={styles["dash-row"]}>
          <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]} ${styles["analytics-h-350"]}`}>
            <Chart type="bar" data={activityData} title="Today's Activity Breakdown" />
          </div>
          <div className={`${ui["ui-card"]} ${styles["analytics-card-sm"]} ${styles["analytics-h-350"]} ${styles["analytics-overflow-hidden"]}`}>
             <TodayActionBoard data={data.todayActionBoard} />
          </div>
        </div>
      </>
    );
  };

  return (
    <div className={styles["analytics-view-container"]}>
      {dashboardType === "Sales" && renderSalesDashboard()}
      {dashboardType === "Lead" && renderLeadDashboard()}
      {dashboardType === "Deals" && renderDealsDashboard()}
      {dashboardType === "Activity" && renderActivityDashboard()}
    </div>
  );
}
