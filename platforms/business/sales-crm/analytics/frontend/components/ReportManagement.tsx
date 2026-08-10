"use client";

import { useState } from "react";
import { Plus, Edit2, Trash2 } from "lucide-react";
import { useAnalyticsStore, ReportProfile, createAnalyticsId } from "@apex/sales-crm-shared/lib/analytics-store";
import ProfileModal from "./ProfileModal";
import ConfirmModal from "@apex/sales-crm-shared/components/ConfirmModal";
import styles from "../styles/analytics.module.css";
import dash from "@apex/sales-crm-shared/styles/dashboard.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

export default function ReportManagement() {
  const { profiles, createProfile, editProfile, deleteProfile } = useAnalyticsStore();
  const [editingProfile, setEditingProfile] = useState<ReportProfile | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);

  return (
    <div className={`${ui["ui-card"]} ${styles["analytics-card-padded"]}`}>
      <div className={styles["analytics-header-row"]}>
        <h2 className={ui["ui-card-title"]}>Report Profiles Management</h2>
        <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]} ${ui["ui-btn-sm"]}`} onClick={() => setIsCreating(true)}>
          <Plus size={16} /> New Profile
        </button>
      </div>

      <p className={`${dash["settings-text-muted"]} ${styles["analytics-mb-xl"]}`}>Manage which roles, teams, or groups have access to specific reports and dashboards.</p>

      <div className={ui["ui-table-container"]}>
        <table className={ui["ui-table"]}>
          <thead>
            <tr>
              <th>Profile Name</th>
              <th>Target Role</th>
              <th>Accessible Reports</th>
              <th>Accessible Dashboards</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  <span className={`${ui["ui-badge"]} ui-badge-secondary`}>{p.role}</span>
                </td>
                <td>{p.accessibleReports?.length || 0} reports</td>
                <td>{p.accessibleDashboards?.length || 0} dashboards</td>
                <td>
                  <div className={styles["analytics-flex-gap-sm"]}>
                    <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]} ${ui["ui-btn-sm"]}`} title="Edit Profile" onClick={() => setEditingProfile(p)}>
                      <Edit2 size={14} />
                    </button>
                    <button
                      className={`${ui["ui-btn"]} ${ui["ui-btn-danger"]} ${ui["ui-btn-sm"]}`}
                      title="Delete"
                      onClick={() => {
                        setDeletingProfileId(p.id);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr>
                <td colSpan={5} className={styles["analytics-table-empty"]}>
                  No profiles found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {deletingProfileId && (
        <ConfirmModal
          title="Delete Profile"
          message="Are you sure you want to delete this profile? This action cannot be undone."
          variant="danger"
          confirmLabel="Delete"
          onConfirm={() => {
            deleteProfile(deletingProfileId);
            setDeletingProfileId(null);
          }}
          onCancel={() => setDeletingProfileId(null)}
        />
      )}

      {(isCreating || editingProfile) && (
        <ProfileModal
          profile={editingProfile || undefined}
          onClose={() => {
            setIsCreating(false);
            setEditingProfile(null);
          }}
          onSave={(updates) => {
            if (isCreating) {
              createProfile({
                id: createAnalyticsId("profile", [updates.name, updates.role, profiles.length]),
                name: updates.name!,
                role: updates.role!,
                accessibleReports: updates.accessibleReports || [],
                accessibleDashboards: updates.accessibleDashboards || [],
                pinnedReports: updates.pinnedReports || [],
                homeDashboard: updates.homeDashboard || "Sales Dashboard",
                sharingRules: updates.sharingRules || { canShare: false },
              });
            } else if (editingProfile) {
              editProfile(editingProfile.id, updates);
            }
          }}
        />
      )}
    </div>
  );
}
