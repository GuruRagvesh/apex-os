"use client";

import { CollectionType, DuplicateResult } from "../lib/database-schema";
import styles from "../styles/database.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

interface DuplicateModalProps {
  collection: CollectionType;
  duplicates: DuplicateResult[];
  onClose: () => void;
}

export default function DuplicateModal({ collection, duplicates, onClose }: DuplicateModalProps) {
  return (
    <div className={ui["ui-modal-overlay"]}>
      <div className={`${ui["ui-modal"]} ${styles["db-modal-md"]}`}>
        <div className={ui["ui-modal-header"]}>
          <h3 className={styles["db-danger-text"]}>Possible Duplicates Found</h3>
          <button className={styles["db-modal-close"]} onClick={onClose}>
            &times;
          </button>
        </div>

        <div className={ui["ui-modal-body"]}>
          <p className={styles["db-mb-3"]}>
            We found {duplicates.length} existing record(s) in <strong>{collection}</strong> that might be a match based on key fields.
          </p>

          <div className={styles["db-duplicate-list"]}>
            {duplicates.map((dup) => (
              <div key={dup.record.id} className={styles["db-duplicate-card"]}>
                <strong>ID:</strong> {dup.record.id} <br />
                <strong>Matched On:</strong> <span className={styles["db-danger-text"]}>{dup.reasons.join(", ")}</span>
                <br />
                {!!dup.record.company_name && (
                  <span>
                    <strong>Company:</strong> {String(dup.record.company_name)} <br />
                  </span>
                )}
                {!!dup.record.first_name && (
                  <span>
                    <strong>Name:</strong> {String(dup.record.first_name)} {String(dup.record.last_name)} <br />
                  </span>
                )}
                {!!dup.record.email && (
                  <span>
                    <strong>Email:</strong> {String(dup.record.email)} <br />
                  </span>
                )}
                {!!dup.record.phone && (
                  <span>
                    <strong>Phone:</strong> {String(dup.record.phone)} <br />
                  </span>
                )}
                {!!dup.record.gst && (
                  <span>
                    <strong>GST:</strong> {String(dup.record.gst)} <br />
                  </span>
                )}
              </div>
            ))}
          </div>

          <p className={styles["db-duplicate-helper-text"]}>* Merge functionality is not available in this phase.</p>
        </div>

        <div className={ui["ui-modal-footer"]}>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
