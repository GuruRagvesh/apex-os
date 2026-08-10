"use client";

import { DashboardData } from "@apex/sales-crm-shared/lib/dashboard-calculations";
import styles from "@apex/sales-crm-shared/styles/dashboard.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

export default function TodayActionBoard({ data }: { data: DashboardData["todayActionBoard"] }) {
  return (
    <div className={ui["ui-card"]}>
      <div className={ui["ui-card-header"]}>
        <div>
          <h3 className={ui["ui-card-title"]}>Today&apos;s Action Board</h3>
          <span className={ui["ui-card-subtitle"]}>Your daily work summary</span>
        </div>
      </div>

      <div className={ui["ui-card-body"]}>
        {/* 4 visual summary cards */}
        <div className={styles["dash-action-grid"]}>
          <div className={styles["dash-action-box"]}>
            <span className={styles["dash-action-count"]}>{data.summary.callsDue}</span>
            <span className={styles["dash-action-label"]}>Calls Due</span>
          </div>
          <div className={styles["dash-action-box"]}>
            <span className={styles["dash-action-count"]}>{data.summary.followupsDue}</span>
            <span className={styles["dash-action-label"]}>Follow-ups</span>
          </div>
          <div className={styles["dash-action-box"]}>
            <span className={styles["dash-action-count"]}>{data.summary.meetingsToday}</span>
            <span className={styles["dash-action-label"]}>Meetings</span>
          </div>
          <div className={styles["dash-action-box"]}>
            <span className={styles["dash-action-count"]}>{data.summary.requirementsPending}</span>
            <span className={styles["dash-action-label"]}>Reqs Pending</span>
          </div>
        </div>

        {/* Time-wise work list */}
        <div className={styles["dash-action-scroll"]}>
          {data.workList.length === 0 ? (
            <div className={`${ui["ui-empty-state"]} ${styles["dash-action-empty"]}`}>
              <p>No scheduled actions for today.</p>
            </div>
          ) : (
            <ul className={styles["dash-work-list"]}>
              {data.workList.map((item) => (
                <li key={item.id} className={`${styles["dash-work-item"]} ${ui["ui-card-interactive"]}`}>
                  <div className={styles["dash-work-time"]}>{item.time}</div>
                  <div className={styles["dash-work-details"]}>
                    <span className={styles["dash-work-type"]}>{item.type}</span>
                    <span className={styles["dash-work-company"]}>{item.leadCompany}</span>
                    <span className={styles["dash-work-action"]}>{item.action}</span>
                  </div>
                  {/* Fallback owner avatar */}
                  <div className={styles["dash-work-owner"]} title={item.owner}>
                    {item.owner.slice(0, 1).toUpperCase()}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
