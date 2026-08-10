"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { ReportSchedule } from "@/lib/sales-crm/analytics-store";
import styles from "../styles/analytics.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

interface ScheduleModalProps {
  schedule?: ReportSchedule;
  onClose: () => void;
  onSave: (schedule: Partial<ReportSchedule>) => void;
}

export default function ScheduleModal({ schedule, onClose, onSave }: ScheduleModalProps) {
  const [name, setName] = useState(schedule?.name || "");
  const [frequency, setFrequency] = useState<"Daily" | "Weekly" | "Monthly">(schedule?.frequency || "Weekly");
  const [format, setFormat] = useState<"Excel" | "PDF">(schedule?.format || "Excel");
  const [emailRecipients, setEmailRecipients] = useState(schedule?.emailRecipients || "");

  const handleSave = () => {
    onSave({ name, frequency, format, emailRecipients });
    onClose();
  };

  return (
    <div className={ui["ui-modal-overlay"]}>
      <div className={ui["ui-modal"]}>
        <div className={ui["ui-modal-header"]}>
          <h2 className={ui["ui-modal-title"]}>{schedule ? "Edit Schedule" : "Create Schedule"}</h2>
          <button className={ui["ui-modal-close"]} onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="ui-modal-content">
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Schedule Name</label>
            <input className={ui["ui-input"]} value={name} onChange={(e) => setName(e.target.value)} placeholder="E.g., Weekly Sales Update" />
          </div>
          <div className={`${ui["ui-form-group"]} ${styles["analytics-mt-md"]}`}>
            <label className={ui["ui-label"]}>Frequency</label>
            <select className={ui["ui-input"]} value={frequency} onChange={(e) => setFrequency(e.target.value as "Daily" | "Weekly" | "Monthly")}>
              <option value="Daily">Daily</option>
              <option value="Weekly">Weekly</option>
              <option value="Monthly">Monthly</option>
            </select>
          </div>
          <div className={`${ui["ui-form-group"]} ${styles["analytics-mt-md"]}`}>
            <label className={ui["ui-label"]}>Delivery Format</label>
            <select className={ui["ui-input"]} value={format} onChange={(e) => setFormat(e.target.value as "Excel" | "PDF")}>
              <option value="Excel">Excel (.xlsx)</option>
              <option value="PDF">PDF (.pdf)</option>
            </select>
          </div>
          <div className={`${ui["ui-form-group"]} ${styles["analytics-mt-md"]}`}>
            <label className={ui["ui-label"]}>Email Recipients (comma separated)</label>
            <input
              className={ui["ui-input"]}
              value={emailRecipients}
              onChange={(e) => setEmailRecipients(e.target.value)}
              placeholder="e.g., team@salescrm.io, manager@salescrm.io"
            />
          </div>
        </div>
        <div className={ui["ui-modal-footer"]}>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={onClose}>
            Cancel
          </button>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={handleSave} disabled={!name}>
            Save Schedule
          </button>
        </div>
      </div>
    </div>
  );
}
