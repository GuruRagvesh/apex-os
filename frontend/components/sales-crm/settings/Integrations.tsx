"use client";

import styles from "@/styles/sales-crm/settings.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

export default function Integrations() {
  return (
    <div className={`${styles["settings-section"]} ${ui["ui-card"]}`}>
      <div className={ui["ui-card-header"]}>
        <h2 className={ui["ui-card-title"]}>Integrations</h2>
        <p className={ui["ui-card-subtitle"]}>Manage third-party integrations and APIs</p>
      </div>
      <div className={ui["ui-card-body"]}>
        <div className={styles["settings-empty-state"]}>
          <span className={styles["settings-empty-icon"]}>APPS</span>
          <p>No integrations have been configured yet.</p>
        </div>
      </div>
    </div>
  );
}
