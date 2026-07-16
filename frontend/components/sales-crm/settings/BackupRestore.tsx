"use client";

// SalesCRM - Backup, Restore, and Factory Reset

import { useState, useRef } from "react";
import { useAuth } from "@/lib/sales-crm/auth-adapter";
import { useSettingsStore } from "@/lib/sales-crm/settings-store";
import ConfirmModal from "@/components/sales-crm/ui/ConfirmModal";
import styles from "@/styles/sales-crm/settings.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

export default function BackupRestore() {
  const { user: authUser } = useAuth();
  const { state, exportBackup, importBackup, factoryReset } = useSettingsStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);
  const [restoreFileName, setRestoreFileName] = useState("");
  const [restoreSummary, setRestoreSummary] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canEdit = Boolean(authUser && ["SUPERADMIN", "ADMIN"].includes(authUser.role.toUpperCase()));
  const actorName = authUser?.name || "System";
  const actorId = authUser?.id || "system";

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleExport = () => {
    if (!authUser) return;
    try {
      const data = exportBackup(actorName, actorId);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `salescrm-backup-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setSuccess("Backup exported successfully!");
      setError("");
      setTimeout(() => setSuccess(""), 3000);
    } catch {
      setError("Failed to export backup.");
      setSuccess("");
    }
  };

  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!authUser) return;
    const file = e.target.files?.[0];
    if (!file) return;

    setError("");
    setSuccess("");
    setRestoreFileName(file.name);

    if (!file.name.endsWith(".json")) {
      setError("Only JSON backup files are accepted.");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      try {
        const parsed = JSON.parse(text);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          !Array.isArray(parsed.users) ||
          !Array.isArray(parsed.auditLogs) ||
          typeof parsed.crmConfig !== "object" ||
          typeof parsed.rolePermissions !== "object"
        ) {
          setError("Invalid backup format: missing or malformed required data sections.");
          // Log failed restore
          importBackup(text, actorName, actorId, true, "Invalid backup format");
          return;
        }

        const summary = `Users: ${parsed.users.length}, Roles: ${parsed.customRoles?.length || 0}, Audit Logs: ${parsed.auditLogs.length}`;
        setPendingRestore(text);
        setRestoreSummary(summary);
        setShowRestoreConfirm(true);
      } catch {
        setError("Invalid JSON format in backup file.");
        importBackup(text, actorName, actorId, true, "Invalid JSON format");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleConfirmRestore = () => {
    if (!authUser || !pendingRestore) return;
    try {
      importBackup(pendingRestore, actorName, actorId);

      setSuccess("System restored from backup successfully!");
      setError("");
      setPendingRestore(null);
      setShowRestoreConfirm(false);
      setRestoreFileName("");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(`Restore failed: ${msg}`);
      importBackup(pendingRestore, actorName, actorId, true, msg);
      setShowRestoreConfirm(false);
    }
  };

  const handleConfirmReset = () => {
    if (!authUser) return;
    factoryReset(actorName, actorId);

    setSuccess("Factory reset completed. All data has been restored to defaults.");
    setError("");
    setShowResetConfirm(false);
    setTimeout(() => setSuccess(""), 3000);
  };

  return (
    <div className={ui["ui-card"]}>
      <div className={ui["ui-card-header"]}>
        <div>
          <h2 className={ui["ui-card-title"]}>Backup & Restore</h2>
          <p className={ui["ui-card-subtitle"]}>Export, restore, or reset system data</p>
        </div>
      </div>

      {/* Status messages */}
      {!canEdit ? (
        <div className={`${ui["ui-notice"]} ${ui["ui-notice-warning"]} ${styles["settings-notice-container"]}`}>
          You need Admin privileges to backup, restore, or reset the system. This section is restricted to SUPERADMIN and ADMIN only.
        </div>
      ) : (
        <>
          {error && (
            <div className={styles["settings-import-error"]}>
              <span className="settings-import-error-icon">X</span> {error}
            </div>
          )}
          {success && (
            <div className={styles["settings-import-success"]}>
              <span className="settings-import-success-icon">+</span> {success}
            </div>
          )}

          <div className={styles["settings-backup-grid"]}>
            {/* Backup Export */}
            <div className={styles["settings-backup-card"]}>
              <div className={styles["settings-backup-card-icon"]}>B</div>
              <h3 className={styles["settings-backup-card-title"]}>Export Backup</h3>
              <p className={styles["settings-backup-card-desc"]}>Download a complete JSON backup of all system data including users, settings, role permissions, and audit logs.</p>
              <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]} ui-btn-full`} onClick={handleExport} disabled={!canEdit}>
                Download Backup
              </button>
            </div>

            {/* Backup Import */}
            <div className={styles["settings-backup-card"]}>
              <div className={styles["settings-backup-card-icon"]}>R</div>
              <h3 className={styles["settings-backup-card-title"]}>Restore from Backup</h3>
              <p className={styles["settings-backup-card-desc"]}>Upload a previously exported JSON backup file to restore system data. This will replace all current data.</p>
              <input type="file" ref={fileInputRef} accept=".json" onChange={handleRestoreFile} className={styles["settings-file-input"]} disabled={!canEdit} />
              <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]} ui-btn-full`} onClick={() => fileInputRef.current?.click()} disabled={!canEdit}>
                Select Backup File
              </button>
              {restoreFileName && !showRestoreConfirm && <span className={`${styles["settings-file-name"]} ${styles["settings-mt-8"]}`}>{restoreFileName}</span>}
            </div>

            {/* Factory Reset */}
            <div className={`${styles["settings-backup-card"]} ${styles["settings-backup-card-danger"]}`}>
              <div className={styles["settings-backup-card-icon"]}>!</div>
              <h3 className={styles["settings-backup-card-title"]}>Factory Reset</h3>
              <p className={styles["settings-backup-card-desc"]}>Reset all settings, users, and data to factory defaults. This action is irreversible. All audit logs will be cleared.</p>
              <button className={`${ui["ui-btn"]} ${styles["settings-confirm-btn-danger"]} ui-btn-full`} onClick={() => setShowResetConfirm(true)} disabled={!canEdit}>
                Factory Reset
              </button>
            </div>
          </div>

          {/* Restore Confirmation Modal */}
          {showRestoreConfirm && (
            <ConfirmModal
              title="Restore from Backup"
              message={`This will replace ALL current system data with the contents of "${restoreFileName}". This action cannot be undone. Are you sure?\n\nBackup Contents:\n${restoreSummary}`}
              confirmLabel="Restore"
              variant="warning"
              onConfirm={handleConfirmRestore}
              onCancel={() => {
                setShowRestoreConfirm(false);
                setPendingRestore(null);
              }}
            />
          )}

          {/* Factory Reset Confirmation Modal */}
          {showResetConfirm && (
            <ConfirmModal
              title="Factory Reset"
              message="This will permanently erase ALL users, settings, audit logs, and configurations. This action is IRREVERSIBLE."
              confirmLabel="Reset Everything"
              variant="danger"
              requireType="RESET"
              onConfirm={handleConfirmReset}
              onCancel={() => setShowResetConfirm(false)}
            />
          )}

          {/* Backup History */}
          <div className={`settings-import-history ${styles["settings-mt-12"]}`}>
            <h3 className={`${ui["ui-card-title"]} ${styles["settings-mb-8"]}`}>Backup History</h3>
            {state.backupHistory.length === 0 ? (
              <div className={styles["settings-empty-state"]}>
                <span className={styles["settings-empty-icon"]}>BACKUP</span>
                <p>No backups have been generated yet.</p>
              </div>
            ) : (
              <div className={ui["ui-table-container"]}>
                <table className={ui["ui-table"]}>
                  <thead>
                    <tr>
                      <th>Date & Time</th>
                      <th>Action</th>
                      <th>Size</th>
                      <th>Status</th>
                      <th className={styles["settings-text-right"]}>User</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.backupHistory.map((entry) => (
                      <tr key={entry.id} className="ui-table-row">
                        <td>{new Date(entry.timestamp).toLocaleString()}</td>
                        <td>
                          {entry.action ? (
                            <span className={`${ui["ui-badge"]} ${ui[`ui-badge-${entry.action === "export" ? "success" : entry.action === "import" ? "warning" : "danger"}`]}`}>
                              {entry.action.toUpperCase()}
                            </span>
                          ) : (
                            <span className={`${ui["ui-badge"]} ${ui["ui-badge-success"]}`}>EXPORT</span>
                          )}
                        </td>
                        <td>{formatBytes(entry.size_bytes)}</td>
                        <td>
                          <span className={`${ui["ui-badge"]} ${ui[`ui-badge-${entry.status === "success" ? "success" : "danger"}`]}`}>{entry.status.toUpperCase()}</span>
                        </td>
                        <td>{entry.created_by}</td>
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
