"use client";

import { useState, useRef } from "react";
import { CollectionType, getSchema, DatabaseRecord } from "../lib/database-schema";
import styles from "../styles/database.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

interface ImportDataModalProps {
  onClose: () => void;
  onImport: (collection: CollectionType, validRows: DatabaseRecord[]) => void;
}

const EXCEL_DISABLED_MESSAGE = "Excel import is disabled until the import package is approved";

function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx + 1).toLowerCase() : "";
}

// Manual CSV parser (RFC 4180-ish): handles quoted fields, escaped quotes
// ("" inside a quoted field), commas inside quotes, and CRLF/CR/LF line
// endings. No external dependency — xlsx is disabled for this step.
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];

    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function parseCsv(text: string): Record<string, unknown>[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell !== ""))
    .map((row) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((header, i) => {
        obj[header] = row[i] ?? "";
      });
      return obj;
    });
}

export default function ImportDataModal({ onClose, onImport }: ImportDataModalProps) {
  const [collection, setCollection] = useState<CollectionType | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [summary, setSummary] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isExcelFile = file ? ["xlsx", "xls"].includes(getFileExtension(file.name)) : false;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const normalizeStr = (str: unknown) => {
    if (!str) return "";
    return String(str).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  };

  const handleImport = async () => {
    if (!collection || !file) return;

    if (isExcelFile) {
      setSummary({ imported: 0, skipped: 0, errors: [EXCEL_DISABLED_MESSAGE] });
      return;
    }

    setIsProcessing(true);

    try {
      const text = await file.text();
      const rows: Record<string, unknown>[] = parseCsv(text);

      const schema = getSchema(collection as CollectionType);

      const validRows: DatabaseRecord[] = [];
      let skipped = 0;
      const errors: string[] = [];

      rows.forEach((row, index) => {
        const rowNumber = index + 2; // Assuming header is row 1
        const parsedRow: DatabaseRecord = {};
        let isValid = true;
        const rowErrors: string[] = [];

        // Map schema
        schema.forEach((field) => {
          // Find matching key in the CSV row (by exact name or human label normalized)
          const fieldNorm = normalizeStr(field.name);
          const labelNorm = normalizeStr(field.label);

          const matchedKey = Object.keys(row).find((k) => {
            const kNorm = normalizeStr(k);
            return kNorm === fieldNorm || kNorm === labelNorm;
          });

          let val = matchedKey ? row[matchedKey] : undefined;

          // Apply defaults if missing
          if (val === undefined || val === null || val === "") {
            if (field.name === "status") {
              val = "Active";
            }
          }

          if (field.required && (val === undefined || val === null || val === "")) {
            isValid = false;
            rowErrors.push(`Missing required field '${field.label}'`);
          }

          if (val !== undefined) {
            parsedRow[field.name] = val;
          }
        });

        if (isValid) {
          // Additional dataset-level defaults
          const str = JSON.stringify(parsedRow);
          let hash = 0;
          for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i);
            hash |= 0;
          }
          parsedRow.id = parsedRow.id || `${collection.slice(0, 2).toLowerCase()}-${Math.abs(hash).toString(36)}-${index}`;
          parsedRow.archived = parsedRow.archived || "No";
          parsedRow.status = parsedRow.status || "Active";

          validRows.push(parsedRow);
        } else {
          skipped++;
          errors.push(`Row ${rowNumber}: ${rowErrors.join(", ")}`);
        }
      });

      if (validRows.length > 0) {
        onImport(collection as CollectionType, validRows);
      }

      setSummary({ imported: validRows.length, skipped, errors: errors.slice(0, 10) }); // show max 10 errors
    } catch (err) {
      console.error(err);
      setSummary({ imported: 0, skipped: 0, errors: ["Failed to parse file. Please ensure it is a valid CSV file."] });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className={ui["ui-modal-overlay"]}>
      <div className={`${ui["ui-modal"]} ${styles["db-modal-md"]}`}>
        <div className={ui["ui-modal-header"]}>
          <h3>Import Data</h3>
          <button className={styles["db-modal-close"]} onClick={onClose}>
            &times;
          </button>
        </div>

        <div className={ui["ui-modal-body"]}>
          {!summary ? (
            <div className={`${ui["ui-form-grid"]} ${styles["db-form-row-single"]}`}>
              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>
                  Select Dataset <span className={styles["db-required"]}>*</span>
                </label>
                <select className={ui["ui-select"]} value={collection} onChange={(e) => setCollection(e.target.value as CollectionType)}>
                  <option value="">-- Choose Dataset --</option>
                  <option value="Clients">Clients</option>
                  <option value="Leads Master">Leads Master</option>
                  <option value="Vendors">Vendors</option>
                  <option value="Trainers">Trainers</option>
                  <option value="Service Database">Service Database</option>
                </select>
              </div>

              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>
                  Upload File (.csv, .xlsx, .xls) <span className={styles["db-required"]}>*</span>
                </label>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".csv, .xlsx, .xls, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                  onChange={handleFileChange}
                  className={`${ui["ui-input"]} ${styles["db-file-input"]}`}
                />
              </div>

              {isExcelFile && <p className={styles["db-error-text"]}>{EXCEL_DISABLED_MESSAGE}</p>}

              {!collection && file && <p className={styles["db-error-text"]}>Please select a dataset to proceed.</p>}
            </div>
          ) : (
            <div className={styles["db-summary-stack"]}>
              <div className={`${ui["ui-notice"]} ${summary.imported > 0 ? ui["ui-notice-success"] : ui["ui-notice-error"]}`}>
                <h4 className={styles["db-import-stats-title"]}>Import Complete</h4>
                <p className={styles["db-import-stats-subtitle"]}>
                  <strong>{summary.imported}</strong> rows imported successfully into {collection}.
                  <br />
                  <strong>{summary.skipped}</strong> rows skipped.
                </p>
              </div>

              {summary.errors.length > 0 && (
                <div>
                  <h5 className={styles["db-import-errors-title"]}>Validation Errors:</h5>
                  <ul className={styles["db-error-list"]}>
                    {summary.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                    {summary.skipped > 10 && <li>...and {summary.skipped - 10} more.</li>}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={ui["ui-modal-footer"]}>
          {!summary ? (
            <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={handleImport} disabled={!collection || !file || isProcessing || isExcelFile}>
              {isProcessing ? "Importing..." : "Run Import"}
            </button>
          ) : (
            <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
