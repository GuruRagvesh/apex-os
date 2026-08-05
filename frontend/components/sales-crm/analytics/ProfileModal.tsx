"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { ReportProfile } from "@/lib/sales-crm/analytics-store";
import { Role } from "@apex/sales-crm-shared";
import styles from "@/styles/sales-crm/analytics.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

interface ProfileModalProps {
  profile?: ReportProfile;
  onClose: () => void;
  onSave: (updates: Partial<ReportProfile>) => void;
}

export default function ProfileModal({ profile, onClose, onSave }: ProfileModalProps) {
  const [name, setName] = useState(profile?.name || "");
  const [role, setRole] = useState(profile?.role || Role.EMPLOYEE);
  const [accessibleReports, setAccessibleReports] = useState(profile?.accessibleReports?.join(", ") || "");
  const [accessibleDashboards, setAccessibleDashboards] = useState(profile?.accessibleDashboards?.join(", ") || "");
  const [homeDashboard, setHomeDashboard] = useState(profile?.homeDashboard || "Sales Dashboard");
  const [canShare, setCanShare] = useState(profile?.sharingRules?.canShare || false);

  const handleSave = () => {
    onSave({
      name,
      role,
      accessibleReports: accessibleReports.split(",").map((s) => s.trim()).filter(Boolean),
      accessibleDashboards: accessibleDashboards.split(",").map((s) => s.trim()).filter(Boolean),
      pinnedReports: profile?.pinnedReports || [],
      homeDashboard,
      sharingRules: { canShare },
    });
    onClose();
  };

  return (
    <div className={ui["ui-modal-overlay"]}>
      <div className={ui["ui-modal"]}>
        <div className={ui["ui-modal-header"]}>
          <h2 className={ui["ui-modal-title"]}>{profile ? "Edit Profile" : "Create Profile"}</h2>
          <button className={ui["ui-modal-close"]} onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="ui-modal-content">
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Profile Name</label>
            <input className={ui["ui-input"]} value={name} onChange={(e) => setName(e.target.value)} placeholder="E.g., Sales Manager Dashboard" />
          </div>
          <div className={`${ui["ui-form-group"]} ${styles["analytics-mt-md"]}`}>
            <label className={ui["ui-label"]}>Target Role</label>
            <select className={ui["ui-input"]} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value={Role.SUPERADMIN}>Superadmin</option>
              <option value={Role.ADMIN}>Admin</option>
              <option value={Role.MANAGER}>Manager</option>
              <option value={Role.TL}>Team Leader</option>
              <option value={Role.EMPLOYEE}>Employee</option>
            </select>
          </div>
          <div className={`${ui["ui-form-group"]} ${styles["analytics-mt-md"]}`}>
            <label className={ui["ui-label"]}>Accessible Reports (Comma separated IDs)</label>
            <input className={ui["ui-input"]} value={accessibleReports} onChange={(e) => setAccessibleReports(e.target.value)} />
          </div>
          <div className={`${ui["ui-form-group"]} ${styles["analytics-mt-md"]}`}>
            <label className={ui["ui-label"]}>Accessible Dashboards (Comma separated names)</label>
            <input className={ui["ui-input"]} value={accessibleDashboards} onChange={(e) => setAccessibleDashboards(e.target.value)} />
          </div>
          <div className={`${ui["ui-form-group"]} ${styles["analytics-mt-md"]}`}>
            <label className={ui["ui-label"]}>Home Dashboard</label>
            <select className={ui["ui-input"]} value={homeDashboard} onChange={(e) => setHomeDashboard(e.target.value)}>
              <option value="Sales Dashboard">Sales Dashboard</option>
              <option value="Lead Dashboard">Lead Dashboard</option>
              <option value="Deals Dashboard">Deals Dashboard</option>
              <option value="Activity Dashboard">Activity Dashboard</option>
            </select>
          </div>
          <div className={`${ui["ui-form-group"]} ${styles["analytics-mt-md"]}`}>
            <label className={styles["analytics-radio-label"]}>
              <input type="checkbox" checked={canShare} onChange={(e) => setCanShare(e.target.checked)} />
              Can Share Reports
            </label>
          </div>
        </div>
        <div className={ui["ui-modal-footer"]}>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={onClose}>
            Cancel
          </button>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={handleSave} disabled={!name}>
            Save Profile
          </button>
        </div>
      </div>
    </div>
  );
}
