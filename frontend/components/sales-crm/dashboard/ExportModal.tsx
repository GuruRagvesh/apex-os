"use client";

import { useState } from "react";
import { X, Download, FileText } from "lucide-react";
import styles from "@/styles/sales-crm/dashboard.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

interface ExportModalProps {
  onClose: () => void;
  onExport: (action: { format: "excel" | "pdf"; fileName: string }) => void | Promise<void>;
}

export default function ExportModal({ onClose, onExport }: ExportModalProps) {
  const [format, setFormat] = useState<"excel" | "pdf">("pdf");
  const [fileName, setFileName] = useState("Analytics_Export");
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await onExport({ format, fileName });
      onClose();
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className={styles["ui-modal-overlay"]}>
      <div className={styles["ui-modal"]}>
        <div className={styles["ui-modal-header"]}>
          <h2 className={styles["ui-modal-title"]}>Export Report</h2>
          <button className={styles["ui-modal-close"]} onClick={onClose}><X size={20} /></button>
        </div>
        <div className={styles["ui-modal-content"]}>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>File Name</label>
            <input
              className={ui["ui-input"]}
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
            />
          </div>
          <div className={ui["ui-form-group"]}>
            <label className={ui["ui-label"]}>Format</label>
            <div className={`${styles["analytics-flex-gap-md"]} ${styles["analytics-mt-sm"]}`}>
              <label className={styles["analytics-radio-label"]}>
                <input type="radio" name="format" checked={format === "excel"} onChange={() => setFormat("excel")} />
                <FileText size={16} /> Excel (.xlsx)
              </label>
              <label className={styles["analytics-radio-label"]}>
                <input type="radio" name="format" checked={format === "pdf"} onChange={() => setFormat("pdf")} />
                <Download size={16} /> PDF (.pdf)
              </label>
            </div>
            {format === "excel" && (
              <p className={`${styles["settings-text-muted"]} ${styles["analytics-text-sm"]} ${styles["analytics-mt-sm"]}`}>
                Excel export is disabled until the import/export package is approved. Use PDF for now.
              </p>
            )}
          </div>
          <p className={`${styles["settings-text-muted"]} ${styles["analytics-text-sm"]} ${styles["analytics-mt-md"]}`}>
            The export will preserve all currently applied filters and sorting.
          </p>
        </div>
        <div className={styles["ui-modal-footer"]}>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={onClose} disabled={isExporting}>Cancel</button>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={handleExport} disabled={isExporting}>
            {isExporting ? "Generating..." : "Download File"}
          </button>
        </div>
      </div>
    </div>
  );
}
