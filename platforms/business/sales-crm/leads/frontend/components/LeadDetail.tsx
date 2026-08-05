"use client";

import { useState } from "react";
import { Lead, Role, useAuth, canDeleteRecord } from "@apex/sales-crm-shared";
import LeadInfoPanel from "./LeadInfoPanel";
import LeadTabs from "./LeadTabs";
import styles from "../styles/leads.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

interface LeadDetailProps {
  lead: Lead;
  onBack: () => void;
  onUpdate: (updatedLead: Lead) => void;
  onDelete?: (leadId: string) => void;
  assignableUsers?: { id: string; name: string; role: Role }[];
}

export default function LeadDetail({ lead, onBack, onUpdate, onDelete, assignableUsers }: LeadDetailProps) {
  const { user } = useAuth();
  const userRole = (user?.role as Role | undefined) ?? Role.EMPLOYEE;
  const canDelete = canDeleteRecord(userRole);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <div className={`${styles["lead-detail-layout"]} ${styles["lead-relative"]}`}>
      {canDelete && onDelete && (
        <div className={styles["lead-absolute-top-right"]}>
          {/* NOTE: Backend API enforcement is still required for production security. */}
          <button className={`${ui["ui-btn"]} ui-btn-outline ${styles["lead-text-error"]} ${styles["lead-border-error"]}`} onClick={() => setShowDeleteConfirm(true)}>
            Delete Lead
          </button>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="lead-modal-overlay">
          <div className="lead-modal-content">
            <h3 className="lead-text-lg lead-font-medium">Confirm Delete</h3>
            <p className="ui-text-muted ui-mb-4">Are you sure you want to delete this lead? This action cannot be undone.</p>
            <div className={`${styles["lead-flex"]} ${styles["lead-gap-4"]} ${styles["lead-justify-end"]}`}>
              <button className={`${ui["ui-btn"]} ui-btn-outline`} onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
              <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]} ${styles["lead-bg-error"]}`} onClick={() => {
                onDelete?.(lead.id);
                setShowDeleteConfirm(false);
              }}>Delete</button>
            </div>
          </div>
        </div>
      )}
      <LeadInfoPanel lead={lead} onUpdate={onUpdate} assignableUsers={assignableUsers} />
      <LeadTabs lead={lead} onUpdate={onUpdate} onBack={onBack} />
    </div>
  );
}
