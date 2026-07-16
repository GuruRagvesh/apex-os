"use client";

// SalesCRM — Data Import component with CSV/JSON support

import { useState, useRef } from "react";
import { useAuth } from "@/lib/sales-crm/auth-adapter";
import { useSettingsStore, parseCSV, parseJSONImport, validateImportData } from "@/lib/sales-crm/settings-store";
import { IMPORT_COLLECTIONS, IMPORT_SCHEMAS } from "@/lib/sales-crm/types/settings";
import type { ImportCollection, ImportPreviewResult } from "@/lib/sales-crm/types/settings";
import styles from "@/styles/sales-crm/settings.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

export default function ImportData() {
  const { user: authUser } = useAuth();
  const { state, setImportPreview, commitImport, clearImport, recordImportFailure } = useSettingsStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [targetCollection, setTargetCollection] = useState<ImportCollection>("leads");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [showInvalid, setShowInvalid] = useState(false);
  const [committed, setCommitted] = useState(false);

  const canEdit = authUser && ["SUPERADMIN", "ADMIN"].includes(authUser.role.toUpperCase());
  const actorName = authUser?.name || "System";
  const actorId = authUser?.id || "system";

  const recordFailure = (selectedFileName: string, message: string) => {
    if (!authUser) return;
    recordImportFailure(targetCollection, selectedFileName, message, actorName, actorId);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError("");
    setPreview(null);
    setCommitted(false);
    setFileName(file.name);

    // Validate file type
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "csv" && ext !== "json") {
      const message = "Unsupported file type. Only CSV and JSON files are accepted.";
      setError(message);
      recordFailure(file.name, message);
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      if (!text || !text.trim()) {
        const message = "File is empty.";
        setError(message);
        recordFailure(file.name, message);
        return;
      }

      try {
        let data: Record<string, unknown>[];

        if (ext === "csv") {
          data = await parseCSV(file);
        } else {
          data = parseJSONImport(text);
        }

        if (!data || data.length === 0) {
          const message = "No data found in file.";
          setError(message);
          recordFailure(file.name, message);
          return;
        }

        // Validate target collection
        if (!IMPORT_COLLECTIONS.includes(targetCollection)) {
          const message = "Invalid target collection.";
          setError(message);
          recordFailure(file.name, message);
          return;
        }

        // Run validation pipeline
        const existingData = state.importedData?.[targetCollection] || [];
        const result = validateImportData(data, targetCollection, existingData);
        setPreview(result);

        // Store in settings store for commit
        setImportPreview({
          targetCollection,
          fileName: file.name,
          previewResult: result,
          rawData: data,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if (ext === "json") {
          setError(`JSON error: ${message}`);
        } else {
          setError(`Parse error: ${message}`);
        }
        recordFailure(file.name, message);
      }
    };

    reader.readAsText(file);
    e.target.value = "";
  };

  const handleCommit = () => {
    if (!authUser || !preview) return;
    commitImport(authUser.name, authUser.id);
    setCommitted(true);
    setPreview(null);
    setFileName("");
    setTimeout(() => setCommitted(false), 3000);
  };

  const handleClear = () => {
    clearImport();
    setPreview(null);
    setFileName("");
    setError("");
    setCommitted(false);
  };

  const schemaFields = IMPORT_SCHEMAS[targetCollection]?.fields || [];

  const handleDownloadTemplate = () => {
    const schema = IMPORT_SCHEMAS[targetCollection];
    if (!schema) return;
    const headerRow = schema.fields.join(",");
    const blob = new Blob([headerRow], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${targetCollection}_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={ui["ui-card"]}>
      <div className={ui["ui-card-header"]}>
        <div>
          <h2 className={ui["ui-card-title"]}>Settings Import</h2>
          <p className={ui["ui-card-subtitle"]}>Import specific CRM configurations (Leads/Requirements/Deals). NOT for Database Master Lists.</p>
        </div>
      </div>

      {!canEdit ? (
        <div className={`${ui["ui-notice"]} ${ui["ui-notice-warning"]} ${styles["settings-notice-container"]}`}>
          You do not have permission to import CRM Settings data. This section is restricted to SUPERADMIN and ADMIN only.
        </div>
      ) : (
        <>
          {/* Import Controls */}
          <div className={styles["settings-import-controls"]}>
            <div className={styles["settings-import-config"]}>
              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>Target Collection</label>
                <select
                  className={ui["ui-select"]}
                  value={targetCollection}
                  onChange={(e) => {
                    setTargetCollection(e.target.value as ImportCollection);
                    setPreview(null);
                    setError("");
                  }}
                >
                  {IMPORT_COLLECTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </option>
                  ))}
                </select>
                <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]} ${styles["settings-mt-8"]}`} onClick={handleDownloadTemplate}>
                  Download Template
                </button>
              </div>

              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>Upload File</label>
                <input type="file" ref={fileInputRef} accept=".csv,.json" onChange={handleFileSelect} className={styles["settings-file-input"]} disabled={!canEdit} />
                <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]} ${styles["settings-upload-btn"]}`} onClick={() => fileInputRef.current?.click()} disabled={!canEdit}>
                  Choose File
                </button>
                {fileName && <span className={styles["settings-file-name"]}>{fileName}</span>}
              </div>
            </div>

            {/* Schema Info */}
            <div className={styles["settings-import-schema-info"]}>
              <h4 className={styles["settings-schema-title"]}>Expected Fields for &ldquo;{targetCollection}&rdquo;</h4>
              <div className={styles["settings-schema-fields"]}>
                {schemaFields.map((f) => {
                  const isRequired = IMPORT_SCHEMAS[targetCollection]?.requiredFields.includes(f);
                  return (
                    <span key={f} className={`${styles["settings-schema-field"]} ${isRequired ? styles["settings-schema-required"] : ""}`}>
                      {f}
                      {isRequired ? " *" : ""}
                    </span>
                  );
                })}
              </div>
              <p className={styles["settings-schema-note"]}>* = required. Duplicate detection on: {IMPORT_SCHEMAS[targetCollection]?.duplicateKeys.join(", ") || "none"}</p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className={styles["settings-import-error"]}>
              <span className="settings-import-error-icon">X</span>
              {error}
            </div>
          )}

          {/* Success */}
          {committed && (
            <div className={styles["settings-import-success"]}>
              <span className="settings-import-success-icon">+</span>
              Import completed successfully!
            </div>
          )}

          {/* Preview Results */}
          {preview && (
            <div className={styles["settings-import-preview"]}>
              <div className={styles["settings-import-summary"]}>
                <div className={styles["settings-import-stat"]}>
                  <span className={styles["settings-import-stat-value"]}>{preview.total}</span>
                  <span className={styles["settings-import-stat-label"]}>Total Rows</span>
                </div>
                <div className={`${styles["settings-import-stat"]} ${styles["settings-import-stat-valid"]}`}>
                  <span className={styles["settings-import-stat-value"]}>{preview.validRows.length}</span>
                  <span className={styles["settings-import-stat-label"]}>Valid</span>
                </div>
                <div className={`${styles["settings-import-stat"]} ${styles["settings-import-stat-invalid"]}`}>
                  <span className={styles["settings-import-stat-value"]}>{preview.invalidRows.length}</span>
                  <span className={styles["settings-import-stat-label"]}>Invalid</span>
                </div>
              </div>

              {/* Invalid rows detail */}
              {preview.invalidRows.length > 0 && (
                <div className="settings-import-invalid">
                  <button className={`${ui["ui-btn"]} ${ui["ui-btn-sm"]} ${ui["ui-btn-secondary"]}`} onClick={() => setShowInvalid(!showInvalid)}>
                    {showInvalid ? "Hide" : "Show"} Invalid Rows ({preview.invalidRows.length})
                  </button>
                  {showInvalid && (
                    <div className={`${ui["ui-table-container"]} ${styles["settings-mt-12"]}`}>
                      <table className={ui["ui-table"]}>
                        <thead>
                          <tr>
                            <th>Row</th>
                            <th>Reason</th>
                            <th>Data</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.invalidRows.map((row) => (
                            <tr key={row.rowNumber} className="ui-table-row">
                              <td className={styles["settings-text-muted"]}>#{row.rowNumber}</td>
                              <td>
                                <span className={styles["settings-invalid-reason"]}>{row.reason}</span>
                              </td>
                              <td className={`${styles["settings-text-muted"]} ${styles["settings-data-cell"]}`}>
                                {JSON.stringify(row.data).slice(0, 120)}
                                {JSON.stringify(row.data).length > 120 ? "..." : ""}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Valid rows preview */}
              {preview.validRows.length > 0 && (
                <div className={`settings-import-valid-preview ${styles["settings-mt-12"]}`}>
                  <h4 className={styles["settings-preview-title"]}>Valid Rows Preview (first 5)</h4>
                  <div className={ui["ui-table-container"]}>
                    <table className={ui["ui-table"]}>
                      <thead>
                        <tr>
                          {Object.keys(preview.validRows[0]).map((key) => (
                            <th key={key}>{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.validRows.slice(0, 5).map((row, i) => (
                          <tr key={i} className="ui-table-row">
                            {Object.values(row).map((val, j) => (
                              <td key={j} className={styles["settings-text-muted"]}>
                                {String(val ?? "")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className={styles["settings-import-actions"]}>
                <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={handleClear}>
                  Cancel Import
                </button>
                <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={handleCommit} disabled={preview.validRows.length === 0}>
                  Import {preview.validRows.length} Valid Records
                </button>
              </div>
            </div>
          )}

          {/* Import Format Guide */}
          <div className={styles["settings-import-guide"]}>
            <h4 className={styles["settings-guide-title"]}>Import Format Guide</h4>
            <div className={styles["settings-guide-grid"]}>
              <div className={styles["settings-guide-card"]}>
                <h5>CSV Format</h5>
                <ul>
                  <li>First row must be headers</li>
                  <li>Remaining rows map values by header order</li>
                  <li>Empty lines are ignored</li>
                </ul>
              </div>
              <div className={styles["settings-guide-card"]}>
                <h5>JSON Format</h5>
                <ul>
                  <li>Must be a JSON array of objects</li>
                  <li>Single objects are auto-wrapped into an array</li>
                  <li>Invalid JSON will be rejected</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Import History */}
          <div className={`settings-import-history ${styles["settings-mt-12"]}`}>
            <h3 className={`${ui["ui-card-title"]} ${styles["settings-mb-8"]}`}>Import History</h3>
            {state.importHistory.length === 0 ? (
              <div className={styles["settings-empty-state"]}>
                <span className={styles["settings-empty-icon"]}>IMPORT</span>
                <p>No imports have been run yet.</p>
              </div>
            ) : (
              <div className={ui["ui-table-container"]}>
                <table className={ui["ui-table"]}>
                  <thead>
                    <tr>
                      <th>Date & Time</th>
                      <th>Target Collection</th>
                      <th>File Name</th>
                      <th>Status</th>
                      <th>Imported</th>
                      <th>Invalid/Errors</th>
                      <th className={styles["settings-text-right"]}>User</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.importHistory.map((entry) => (
                      <tr key={entry.id} className="ui-table-row">
                        <td>{new Date(entry.timestamp).toLocaleString()}</td>
                        <td>{entry.target_collection}</td>
                        <td>{entry.file_name}</td>
                        <td>
                          <span className={`${ui["ui-badge"]} ${ui[`ui-badge-${entry.status === "success" ? "success" : entry.status === "partial" ? "warning" : "danger"}`]}`}>
                            {entry.status.toUpperCase()}
                          </span>
                        </td>
                        <td>{entry.imported_count}</td>
                        <td>
                          {entry.invalid_count > 0 ? (
                            <div title={entry.error_log} className={`${styles["settings-text-muted"]} ${styles["settings-ellipsis-250"]}`}>
                              {entry.invalid_count} errors: {entry.error_log}
                            </div>
                          ) : (
                            "0"
                          )}
                        </td>
                        <td>{entry.imported_by}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
