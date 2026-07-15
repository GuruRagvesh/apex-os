"use client";

import { useState } from "react";
import { X, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { MOCK_LEADS } from "@/lib/sales-crm/mock-data";
import styles from "@/styles/sales-crm/dashboard.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

interface QuickAddProps {
  onClose: () => void;
}

export default function QuickAdd({ onClose }: QuickAddProps) {
  const router = useRouter();
  const [type, setType] = useState<"lead" | "activity">("lead");
  const [selectedLeadId, setSelectedLeadId] = useState("");

  const handleLeadAction = () => {
    onClose();
    router.push("/sales-crm/leads?action=add");
  };

  const handleActivityAction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLeadId) return;
    onClose();
    router.push(`/sales-crm/leads?leadId=${selectedLeadId}&tab=activity&action=add-activity`);
  };

  return (
    <div className={styles["ui-modal-overlay"]} onClick={onClose}>
      <div className={styles["ui-modal"]} onClick={e => e.stopPropagation()}>
        <div className={styles["ui-modal-header"]}>
          <h2 className={styles["ui-modal-title"]}>Quick Add</h2>
          <button className={styles["ui-modal-close"]} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className={`${styles["dash-segmented-switch"]} ${styles["dash-qa-tabs"]}`}>
          <button className={type === "lead" ? "active" : ""} onClick={() => setType("lead")}>
            New Lead
          </button>
          <button className={type === "activity" ? "active" : ""} onClick={() => setType("activity")}>
            New Activity
          </button>
        </div>

        {type === "lead" ? (
          <div className={styles["dash-qa-lead-action"]}>
            <p className={styles["dash-qa-text"]}>Create a new lead with full details.</p>
            <button type="button" className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={handleLeadAction}>
              Continue to Add Lead <ArrowRight size={16} />
            </button>
          </div>
        ) : (
          <form onSubmit={handleActivityAction}>
            <div>
              <label className={ui["ui-label"]}>Select Lead *</label>
              <select
                className={`${ui["ui-input"]} ${styles["dash-qa-select"]}`}
                value={selectedLeadId}
                onChange={(e) => setSelectedLeadId(e.target.value)}
                required
              >
                <option value="">-- Choose a lead --</option>
                {MOCK_LEADS.map(l => (
                  <option key={l.id} value={l.id}>{l.company}</option>
                ))}
              </select>
            </div>

            <div className={`${styles["ui-modal-footer"]} ${styles["dash-qa-footer"]}`}>
              <button type="button" className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} disabled={!selectedLeadId}>
                Continue <ArrowRight size={16} />
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
