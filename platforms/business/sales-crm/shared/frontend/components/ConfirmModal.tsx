"use client";

// SalesCRM — Reusable confirmation modal for destructive actions

import { useState } from "react";
import styles from "../styles/confirm-modal.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "default";
  requireType?: string; // If set, user must type this string to confirm
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  requireType,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [typed, setTyped] = useState("");

  const canConfirm = requireType ? typed === requireType : true;

  const variantClass = variant === "danger" ? ui["ui-btn-danger"] : variant === "warning" ? ui["ui-btn-danger"] : ui["ui-btn-primary"];

  return (
    <div className={ui["ui-modal-overlay"]} onClick={onCancel}>
      <div className={`${ui["ui-modal"]} ${styles["settings-confirm-modal"]}`} onClick={(e) => e.stopPropagation()}>
        <div className={ui["ui-modal-header"]}>
          <h3 className={ui["ui-modal-title"]}>
            {variant === "danger" && <span className="ui-modal-icon-danger">!</span>}
            {variant === "warning" && <span className="ui-modal-icon-warning">!</span>}
            {title}
          </h3>
        </div>

        <div className={ui["ui-modal-body"]}>
          <p className={styles["settings-confirm-message"]}>{message}</p>

          {requireType && (
            <div className={styles["settings-confirm-type-section"]}>
              <p className={styles["settings-confirm-type-label"]}>
                Type <strong>{requireType}</strong> to confirm:
              </p>
              <input type="text" className={ui["ui-input"]} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={requireType} autoFocus />
            </div>
          )}
        </div>

        <div className={ui["ui-modal-footer"]}>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={`${ui["ui-btn"]} ${variantClass}`} onClick={onConfirm} disabled={!canConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
