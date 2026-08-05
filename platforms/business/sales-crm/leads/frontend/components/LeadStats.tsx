import { LeadsStatsData } from "../api/lead-calculations";
import styles from "../styles/leads.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";
import { Users, UserCheck, Clock, Award } from "lucide-react";

export default function LeadStats({ stats }: { stats: LeadsStatsData }) {
  return (
    <div className={styles["lead-stats-strip"]}>
      <div className={`${ui["ui-card"]} ${styles["lead-stat-card"]} ${styles["lead-stat-primary"]}`}>
        <div className={ui["ui-card-body"]}>
          <div className={styles["lead-stat-header"]}>
            <h3 className={ui["ui-card-subtitle"]}>Total Leads</h3>
            <Users className={styles["lead-stat-icon"]} size={20} />
          </div>
          <p className={styles["lead-stat-value"]}>{stats.totalLeads}</p>
        </div>
      </div>
      <div className={`${ui["ui-card"]} ${styles["lead-stat-card"]} ${styles["lead-stat-success"]}`}>
        <div className={ui["ui-card-body"]}>
          <div className={styles["lead-stat-header"]}>
            <h3 className={ui["ui-card-subtitle"]}>Active Leads</h3>
            <UserCheck className={styles["lead-stat-icon"]} size={20} />
          </div>
          <p className={styles["lead-stat-value"]}>{stats.activeLeads}</p>
        </div>
      </div>
      <div className={`${ui["ui-card"]} ${styles["lead-stat-card"]} ${styles["lead-stat-warning"]}`}>
        <div className={ui["ui-card-body"]}>
          <div className={styles["lead-stat-header"]}>
            <h3 className={ui["ui-card-subtitle"]}>Pending Follow-ups</h3>
            <Clock className={styles["lead-stat-icon"]} size={20} />
          </div>
          <p className={styles["lead-stat-value"]}>{stats.pendingFollowups}</p>
        </div>
      </div>
      <div className={`${ui["ui-card"]} ${styles["lead-stat-card"]} ${styles["lead-stat-info"]}`}>
        <div className={ui["ui-card-body"]}>
          <div className={styles["lead-stat-header"]}>
            <h3 className={ui["ui-card-subtitle"]}>Qualified Leads</h3>
            <Award className={styles["lead-stat-icon"]} size={20} />
          </div>
          <p className={styles["lead-stat-value"]}>{stats.qualifiedLeads}</p>
        </div>
      </div>
    </div>
  );
}
