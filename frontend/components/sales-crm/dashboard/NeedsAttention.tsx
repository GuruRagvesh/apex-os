"use client";

import { DashboardData, filterLeadsFromDashboard } from "@/lib/sales-crm/dashboard-calculations";
import styles from "@/styles/sales-crm/dashboard.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";
import { AlertTriangle, AlertCircle } from "lucide-react";

export default function NeedsAttention({ data }: { data: DashboardData["needsAttention"] }) {
  return (
    <div className={ui["ui-card"]}>
      <div className={ui["ui-card-header"]}>
        <div>
          <h3 className={ui["ui-card-title"]}>Needs Attention</h3>
          <span className={ui["ui-card-subtitle"]}>Urgent actions required</span>
        </div>
      </div>
      <div className={ui["ui-card-body"]}>
        <div className={styles["dash-attention-list"]}>
          {data.length === 0 ? (
            <div className={ui["ui-empty-state"]}>
              <p>All caught up! No urgent alerts.</p>
            </div>
          ) : (
            data.map((alert) => (
              <div
                key={alert.id}
                className={`${ui["ui-notice"]} ${ui[`ui-notice-${alert.type}`]} ${ui["ui-card-interactive"]} ${styles["dash-attention-item"]}`}
                onClick={() => filterLeadsFromDashboard("alert", alert.leadId)}
              >
                <div className={ui["ui-notice-icon"]}>
                  {alert.type === "error" ? <AlertCircle size={20} /> : <AlertTriangle size={20} />}
                </div>
                <div className={styles["dash-attention-text-col"]}>
                  <span className={styles["dash-attention-title"]}>{alert.title}</span>
                  <span className={styles["dash-attention-instruction"]}>{alert.instruction}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
