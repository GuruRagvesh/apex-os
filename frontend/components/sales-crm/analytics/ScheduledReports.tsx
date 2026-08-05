"use client";

import { useState } from "react";
import { Plus, Edit2, Pause, Trash2, Play } from "lucide-react";
import { useAnalyticsStore, ReportSchedule, canViewItem, createAnalyticsId, getUserAnalyticsContext } from "@/lib/sales-crm/analytics-store";
import { useAuth } from "@apex/sales-crm-shared";
import ScheduleModal from "./ScheduleModal";
import styles from "@/styles/sales-crm/analytics.module.css";
import dash from "@/styles/sales-crm/dashboard.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

export default function ScheduledReports({ dashboardMode, userId }: { dashboardMode: "personal" | "team"; userId: string }) {
  const { schedules, profiles, deleteSchedule, toggleScheduleStatus, createSchedule, editSchedule } = useAnalyticsStore();
  const { user } = useAuth();
  const [editingSchedule, setEditingSchedule] = useState<ReportSchedule | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const userContext = getUserAnalyticsContext(user, profiles);

  const filteredSchedules = schedules.filter((s) => {
    if (!canViewItem(userContext, s, profiles)) return false;

    if (dashboardMode === "team" && !s.isTeamSchedule) return false;
    if (dashboardMode === "personal" && s.isTeamSchedule) return false;
    return true;
  });

  return (
    <div className={`${ui["ui-card"]} ${styles["analytics-card-padded"]}`}>
      <div className={styles["analytics-header-row"]}>
        <h2 className={ui["ui-card-title"]}>Scheduled Reports ({dashboardMode === "personal" ? "My Schedules" : "Team Schedules"})</h2>
        <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]} ${ui["ui-btn-sm"]}`} onClick={() => setIsCreating(true)}>
          <Plus size={16} /> Create Schedule
        </button>
      </div>

      <div className={ui["ui-table-container"]}>
        <table className={ui["ui-table"]}>
          <thead>
            <tr>
              <th>Schedule Name</th>
              <th>Frequency</th>
              <th>Format</th>
              <th>Status</th>
              <th>Recipients</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredSchedules.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.frequency}</td>
                <td>{s.format}</td>
                <td>
                  <span className={`${ui["ui-badge"]} ${s.status === "Active" ? ui["ui-badge-success"] : "ui-badge-secondary"}`}>{s.status}</span>
                </td>
                <td className={styles["analytics-table-cell-ellipsis"]} title={s.emailRecipients}>
                  {s.emailRecipients || <span className={dash["settings-text-muted"]}>None</span>}
                </td>
                <td>
                  <div className={styles["analytics-flex-row-gap"]}>
                    <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]} ${ui["ui-btn-sm"]}`} title="Edit" onClick={() => setEditingSchedule(s)}>
                      <Edit2 size={14} />
                    </button>
                    {s.status === "Active" ? (
                      <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]} ${ui["ui-btn-sm"]}`} title="Pause" onClick={() => toggleScheduleStatus(s.id)}>
                        <Pause size={14} />
                      </button>
                    ) : (
                      <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]} ${ui["ui-btn-sm"]}`} title="Resume" onClick={() => toggleScheduleStatus(s.id)}>
                        <Play size={14} />
                      </button>
                    )}
                    <button className={`${ui["ui-btn"]} ${ui["ui-btn-danger"]} ${ui["ui-btn-sm"]}`} title="Delete" onClick={() => deleteSchedule(s.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filteredSchedules.length === 0 && (
              <tr>
                <td colSpan={5} className={styles["analytics-table-empty"]}>
                  No scheduled reports found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(isCreating || editingSchedule) && (
        <ScheduleModal
          schedule={editingSchedule || undefined}
          onClose={() => {
            setIsCreating(false);
            setEditingSchedule(null);
          }}
          onSave={(updates) => {
            if (isCreating) {
              createSchedule({
                id: createAnalyticsId("schedule", [updates.name, updates.frequency, userId, schedules.length]),
                name: updates.name!,
                frequency: updates.frequency!,
                format: updates.format!,
                status: "Active",
                ownerId: userId,
                isTeamSchedule: dashboardMode === "team",
                teamId: dashboardMode === "team" ? userContext.teamId : undefined,
                groupId: userContext.groupId,
                roleAccess: [user?.role || "EMPLOYEE"],
                emailRecipients: updates.emailRecipients || "",
              });
            } else if (editingSchedule) {
              editSchedule(editingSchedule.id, updates);
            }
          }}
        />
      )}
    </div>
  );
}
