"use client";

import { DashboardData, filterLeadsFromDashboard } from "@apex/sales-crm-shared/lib/dashboard-calculations";
import styles from "@apex/sales-crm-shared/styles/dashboard.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";
import { AlertTriangle } from "lucide-react";

export default function LeadFunnel({ data }: { data: DashboardData["leadFunnel"] }) {
  const maxCount = Math.max(...data.map(d => d.count), 1); // Avoid division by zero

  return (
    <div className={ui["ui-card"]}>
      <div className={ui["ui-card-header"]}>
        <div>
          <h3 className={ui["ui-card-title"]}>Lead Funnel</h3>
          <span className={ui["ui-card-subtitle"]}>Distribution across stages</span>
        </div>
      </div>
      <div className={ui["ui-card-body"]}>
        <div className={styles["dash-funnel"]}>
          {data.map((row) => (
            <div
              key={row.groupName}
              className={`${styles["dash-funnel-row"]} ${row.isBottleneck ? styles["dash-funnel-row--bottleneck"] : ""} ${ui["ui-card-interactive"]}`}
              onClick={() => filterLeadsFromDashboard("stageGroup", row.groupName)}
            >
              <div className={styles["dash-funnel-label"]}>
                <span className={styles["dash-funnel-name"]}>{row.groupName}</span>
                <span className={styles["dash-funnel-meaning"]}>{row.meaning}</span>
              </div>
              <div className={styles["dash-funnel-bar-col"]}>
                <div
                  className={styles["dash-funnel-bar"]}
                  style={Object.assign({}, { width: `${(row.count / maxCount) * 100}%`, backgroundColor: row.color })}
                />
              </div>
              <div className={styles["dash-funnel-count-col"]}>
                <span className={styles["dash-funnel-count"]} style={Object.assign({}, { color: row.color })}>
                  {row.count}
                </span>
              </div>
              {row.isBottleneck && (
                <div className={styles["dash-funnel-indicator"]} title="Highest stuck count">
                  <AlertTriangle size={16} color="var(--color-warning)" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
