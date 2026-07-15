"use client";

import { useState } from "react";
import { X, Users, User, LayoutGrid, AlertCircle } from "lucide-react";
import { useAnalyticsStore } from "@/lib/sales-crm/analytics-store";
import { useAuth } from "@/lib/sales-crm/auth-adapter";
import styles from "@/styles/sales-crm/dashboard.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

interface ShareModalProps {
  onClose: () => void;
  onShare: (action: { targetType: "Individual" | "Team" | "Group"; targetName: string }) => void | Promise<void>;
}

export default function ShareModal({ onClose, onShare }: ShareModalProps) {
  const [targetType, setTargetType] = useState<"Individual" | "Team" | "Group">("Team");
  const [targetName, setTargetName] = useState("");
  const { profiles } = useAnalyticsStore();
  const { user } = useAuth();

  const userProfiles = profiles.filter(p => p.role === user?.role);
  const canShare = userProfiles.some(p => p.sharingRules.canShare) || user?.role === "SUPERADMIN" || user?.role === "ADMIN";

  const [error, setError] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  const handleShare = async () => {
    const activeProfile = userProfiles.find(p => p.sharingRules.canShare);
    const maxRoleLevel = activeProfile?.sharingRules.maxRoleLevel;

    // Validate target scope
    if (maxRoleLevel === "EMPLOYEE" && (targetType === "Group" || targetType === "Team")) {
      setError("Your profile restricts sharing to individual employees only.");
      return;
    }

    setError(null);
    setIsSharing(true);
    try {
      await onShare({ targetType, targetName });
      onClose();
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className={styles["ui-modal-overlay"]}>
      <div className={styles["ui-modal"]}>
        <div className={styles["ui-modal-header"]}>
          <h2 className={styles["ui-modal-title"]}>Share Report</h2>
          <button className={styles["ui-modal-close"]} onClick={onClose}><X size={20} /></button>
        </div>
        <div className={styles["ui-modal-content"]}>
          {!canShare && (
            <div className={styles["analytics-share-error"]}>
              <AlertCircle size={16} />
              <span className={styles["analytics-text-sm"]}>Your current role/profile does not have permission to share reports.</span>
            </div>
          )}
          {error && (
            <div className={styles["analytics-share-error"]}>
              <AlertCircle size={16} />
              <span className={styles["analytics-text-sm"]}>{error}</span>
            </div>
          )}
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Share with</label>
            <div className={`${styles["analytics-flex-gap-md"]} ${styles["analytics-mt-sm"]}`}>
              <label className={styles["analytics-radio-label"]}>
                <input type="radio" name="target" checked={targetType === "Individual"} onChange={() => setTargetType("Individual")} />
                <User size={16} /> Individual
              </label>
              <label className={styles["analytics-radio-label"]}>
                <input type="radio" name="target" checked={targetType === "Team"} onChange={() => setTargetType("Team")} />
                <Users size={16} /> Team
              </label>
              <label className={styles["analytics-radio-label"]}>
                <input type="radio" name="target" checked={targetType === "Group"} onChange={() => setTargetType("Group")} />
                <LayoutGrid size={16} /> Group
              </label>
            </div>
          </div>
          <div className={`${ui["ui-form-group"]} ${styles["analytics-mt-md"]}`}>
            <label className={ui["ui-label"]}>Name / Email</label>
            <input
              className={ui["ui-input"]}
              placeholder={`Enter ${targetType.toLowerCase()} name...`}
              value={targetName}
              onChange={(e) => setTargetName(e.target.value)}
            />
          </div>
        </div>
        <div className={styles["ui-modal-footer"]}>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={onClose} disabled={isSharing}>Cancel</button>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={handleShare} disabled={!targetName || !canShare || isSharing}>
            {isSharing ? "Sharing..." : "Share Report"}
          </button>
        </div>
      </div>
    </div>
  );
}
