"use client";

import { DashboardData } from "@/lib/sales-crm/dashboard-calculations";
import styles from "@/styles/sales-crm/dashboard.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

export default function OwnerPerformance({ data }: { data: DashboardData["ownerPerformance"] }) {
  return (
    <div className={ui["ui-card"]}>
      <div className={ui["ui-card-header"]}>
        <h3 className={ui["ui-card-title"]}>Owner Performance</h3>
      </div>
      <div className={`${ui["ui-card-body"]} ${styles["dash-owner-body"]}`}>
        <div className={styles["dash-owner-scroll"]}>
          <table className={ui["ui-table"]}>
            <thead>
              <tr>
                <th>Owner</th>
                <th>Leads</th>
                <th>Follow-ups</th>
                <th>Reqs</th>
                <th>Deals</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {data.map((owner) => (
                <tr key={owner.ownerId}>
                  <td className={styles["dash-perf-owner"]}>{owner.ownerName}</td>
                  <td>{owner.leads}</td>
                  <td>{owner.followups}</td>
                  <td>{owner.requirements}</td>
                  <td>{owner.deals}</td>
                  <td>
                    <span className={`${ui["ui-badge"]} ${owner.risk > 0 ? ui["ui-badge-danger"] : ui["ui-badge-success"]}`}>
                      {owner.risk}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
