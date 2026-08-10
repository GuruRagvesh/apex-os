"use client";

// SalesCRM — Audit Logs table with filters

import { useState, useMemo } from "react";
import { useAuth, useAuditLogs, Role, AuditLogRecord } from "@apex/sales-crm-shared";
import { useSettingsStore } from "../lib/settings-store";
import styles from "../styles/settings.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

const ITEMS_PER_PAGE = 20;

export interface AuditLogFilters {
  collection?: string;
  action?: string;
  user?: string;
  date_from?: string;
  date_to?: string;
  department?: string;
  pipeline_stage?: string;
  lead_status?: string;
  status?: string;
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  login: "Login",
  logout: "Logout",
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  archive: "Archived",
  import: "Imported",
  export: "Exported",
  permission_update: "Permissions Updated",
  backup: "Backup Created",
  restore: "Restored",
  stage_change: "Stage Changed",
  activity_added: "Activity Added",
  followup_added: "Follow-up Added",
  requirement_added: "Requirement Added",
  settings_update: "Settings Updated",
  status_change: "Status Changed",
};

const getLogStatus = (log: AuditLogRecord) => {
  if (log.status) return log.status;
  const meta = (log.metadata as Record<string, string | undefined>) || {};
  return meta.log_status || "";
};

export default function AuditLogs() {
  const { user: authUser } = useAuth();
  const { state } = useSettingsStore();
  const logs = useAuditLogs();
  const [filters, setFilters] = useState<AuditLogFilters>({});
  const [page, setPage] = useState(1);
  const [sortField, setSortField] = useState<keyof (typeof logs)[0]>("timestamp");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  const updateFilter = <K extends keyof AuditLogFilters>(key: K, value: AuditLogFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleSort = (field: keyof (typeof logs)[0]) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const scopedLogs = useMemo(() => {
    if (!authUser) return [];

    // Audit log access scoping rules:
    // Employee: own logs only
    // TL / Manager: logs of users in their department (frontend-only assumption for mock auth)
    // Admin / Superadmin: all logs
    if (authUser.role === Role.EMPLOYEE) {
      return logs.filter((log) => log.userId === authUser.id);
    } else if (authUser.role === Role.MANAGER) {
      const currentSettingsUser = state.users.find((u) => u.id === authUser.id);
      const currentDept = currentSettingsUser?.department;
      if (!currentDept) {
        return logs.filter((log) => log.userId === authUser.id);
      } else {
        return logs.filter((log) => {
          if (log.userId === authUser.id) return true;
          const logUser = state.users.find((u) => u.id === log.userId);
          return logUser?.department === currentDept;
        });
      }
    } else if (authUser.role === Role.TL) {
      const currentSettingsUser = state.users.find((u) => u.id === authUser.id);
      const currentTeam = currentSettingsUser?.team_id;
      if (!currentTeam) {
        return logs.filter((log) => log.userId === authUser.id);
      } else {
        return logs.filter((log) => {
          if (log.userId === authUser.id) return true;
          const logUser = state.users.find((u) => u.id === log.userId);
          return logUser?.team_id === currentTeam;
        });
      }
    }

    return logs;
  }, [logs, authUser, state.users]);

  const filteredLogs = useMemo(() => {
    return scopedLogs.filter((log) => {
      if (filters.collection && log.collection !== filters.collection) return false;
      if (filters.action && log.action !== filters.action) return false;
      if (filters.user && !log.userName.toLowerCase().includes(filters.user.toLowerCase())) return false;
      if (filters.date_from && log.timestamp < filters.date_from) return false;
      if (filters.date_to && log.timestamp > filters.date_to + "T23:59:59.999Z") return false;

      const meta = (log.metadata as Record<string, string | undefined>) || {};
      if (filters.department && meta.department !== filters.department) return false;
      if (filters.pipeline_stage && meta.pipeline_stage !== filters.pipeline_stage && meta.stage !== filters.pipeline_stage) return false;
      if (filters.lead_status && meta.lead_status !== filters.lead_status && meta.status !== filters.lead_status) return false;
      if (filters.status) {
        const logStatus = getLogStatus(log);
        if (logStatus !== filters.status) return false;
      }

      return true;
    });
  }, [filters, scopedLogs]);

  const sortedLogs = useMemo(() => {
    return [...filteredLogs].sort((a, b) => {
      let aVal = a[sortField] as string | number | undefined;
      let bVal = b[sortField] as string | number | undefined;

      // Handle undefined
      if (aVal === undefined) aVal = "";
      if (bVal === undefined) bVal = "";

      if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
      if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredLogs, sortField, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(sortedLogs.length / ITEMS_PER_PAGE));
  const paginatedLogs = sortedLogs.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const clearFilters = () => {
    setFilters({});
    setPage(1);
  };

  const hasActiveFilters = Object.values(filters).some((v) => v !== undefined && v !== "");

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleExport = () => {
    if (sortedLogs.length === 0) return;

    // Headers: Timestamp, User Name, User Role, Collection, Action, Entity Name, Previous Value, New Value, IP Address, Device/Browser, Status
    const headers = ["Timestamp", "User Name", "User Role", "Collection", "Action", "Entity Name", "Previous Value", "New Value", "IP Address", "Device/Browser", "Status", "Details"];

    const rows = sortedLogs.map((log) => [
      formatTimestamp(log.timestamp).replace(/,/g, ""),
      log.userName || "",
      log.userRole || "",
      log.collection || "",
      AUDIT_ACTION_LABELS[log.action] || log.action,
      log.entityName || "",
      log.before ? JSON.stringify(log.before).replace(/"/g, '""') : "",
      log.after ? JSON.stringify(log.after).replace(/"/g, '""') : "",
      log.ipAddress || "",
      log.device || "",
      getLogStatus(log),
      (log.details || "").replace(/"/g, '""'),
    ]);

    const csvContent = [headers.join(","), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(","))].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderSortIndicator = (field: keyof (typeof logs)[0]) => {
    if (sortField !== field) return <span className={styles["settings-sort-indicator-inactive"]}>ASC/DESC</span>;
    return <span className={styles["settings-sort-indicator"]}>{sortOrder === "asc" ? "ASC" : "DESC"}</span>;
  };

  return (
    <div className={`${ui["ui-card"]} ${styles["settings-audit-section"]}`}>
      <div className={ui["ui-card-header"]}>
        <div>
          <h2 className={ui["ui-card-title"]}>Audit Logs</h2>
          <p className={ui["ui-card-subtitle"]}>Track all system activities and changes ({filteredLogs.length} entries)</p>
        </div>
        <div className={styles["settings-header-actions"]}>
          {hasActiveFilters && (
            <button className={`${ui["ui-btn"]} ${ui["ui-btn-sm"]} ${ui["ui-btn-secondary"]}`} onClick={clearFilters}>
              X Clear Filters
            </button>
          )}
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-sm"]} ${ui["ui-btn-primary"]}`} onClick={handleExport} disabled={sortedLogs.length === 0}>
            Export Logs
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className={styles["settings-audit-filters"]}>
        <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
          <label className="ui-label-sm">Action</label>
          <select className={`${ui["ui-select"]} ui-select-sm`} value={filters.action || ""} onChange={(e) => updateFilter("action", e.target.value)}>
            <option value="">All Actions</option>
            {Object.entries(AUDIT_ACTION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
          <label className="ui-label-sm">Collection</label>
          <input className={`${ui["ui-input"]} ui-input-sm`} placeholder="Filter by collection..." value={filters.collection || ""} onChange={(e) => updateFilter("collection", e.target.value)} />
        </div>
        <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
          <label className="ui-label-sm">User</label>
          <input className={`${ui["ui-input"]} ui-input-sm`} placeholder="Filter by user..." value={filters.user || ""} onChange={(e) => updateFilter("user", e.target.value)} />
        </div>
        <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
          <label className="ui-label-sm">Department</label>
          <input className={`${ui["ui-input"]} ui-input-sm`} placeholder="Department..." value={filters.department || ""} onChange={(e) => updateFilter("department", e.target.value)} />
        </div>
        <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
          <label className="ui-label-sm">Pipeline Stage</label>
          <input className={`${ui["ui-input"]} ui-input-sm`} placeholder="Stage..." value={filters.pipeline_stage || ""} onChange={(e) => updateFilter("pipeline_stage", e.target.value)} />
        </div>
        <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
          <label className="ui-label-sm">Lead Status</label>
          <input className={`${ui["ui-input"]} ui-input-sm`} placeholder="Status..." value={filters.lead_status || ""} onChange={(e) => updateFilter("lead_status", e.target.value)} />
        </div>
        <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
          <label className="ui-label-sm">Action Status</label>
          <select className={`${ui["ui-select"]} ui-select-sm`} value={filters.status || ""} onChange={(e) => updateFilter("status", e.target.value)}>
            <option value="">All</option>
            <option value="success">Success</option>
            <option value="failed">Failed</option>
            <option value="failure">Failure</option>
          </select>
        </div>
        <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
          <label className="ui-label-sm">From Date</label>
          <input type="date" className={`${ui["ui-input"]} ui-input-sm`} value={filters.date_from || ""} onChange={(e) => updateFilter("date_from", e.target.value)} />
        </div>
        <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
          <label className="ui-label-sm">To Date</label>
          <input type="date" className={`${ui["ui-input"]} ui-input-sm`} value={filters.date_to || ""} onChange={(e) => updateFilter("date_to", e.target.value)} />
        </div>
      </div>

      {/* Audit Table */}
      <div className={ui["ui-table-container"]}>
        <table className="ui-table settings-audit-table">
          <thead>
            <tr>
              <th onClick={() => handleSort("timestamp")} className={styles["settings-table-header-sortable"]}>
                Timestamp {renderSortIndicator("timestamp")}
              </th>
              <th onClick={() => handleSort("userName")} className={styles["settings-table-header-sortable"]}>
                User Name {renderSortIndicator("userName")}
              </th>
              <th onClick={() => handleSort("userRole")} className={styles["settings-table-header-sortable"]}>
                User Role {renderSortIndicator("userRole")}
              </th>
              <th onClick={() => handleSort("collection")} className={styles["settings-table-header-sortable"]}>
                Collection {renderSortIndicator("collection")}
              </th>
              <th onClick={() => handleSort("action")} className={styles["settings-table-header-sortable"]}>
                Action {renderSortIndicator("action")}
              </th>
              <th>Entity Name</th>
              <th>Previous Value</th>
              <th>New Value</th>
              <th>IP Address</th>
              <th>Device</th>
              <th onClick={() => handleSort("status")} className={styles["settings-table-header-sortable"]}>
                Status {renderSortIndicator("status")}
              </th>
            </tr>
          </thead>
          <tbody>
            {paginatedLogs.length === 0 ? (
              <tr>
                <td colSpan={11} className={ui["ui-table-empty"]}>
                  <div className={styles["settings-empty-state"]}>
                    <span className={styles["settings-empty-icon"]}>LOG</span>
                    <p>{logs.length === 0 ? "No audit logs yet. Actions will be recorded here." : "No logs match the current filters."}</p>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedLogs.map((log) => (
                <tr key={log.id} className="ui-table-row">
                  <td className={styles["settings-audit-timestamp"]}>{formatTimestamp(log.timestamp)}</td>
                  <td>
                    <span className={styles["settings-audit-user"]}>{log.userName}</span>
                  </td>
                  <td>
                    <span className={styles["settings-text-muted"]}>{log.userRole || "-"}</span>
                  </td>
                  <td className={styles["settings-text-muted"]}>{log.collection || "-"}</td>
                  <td>
                    <span className={`${styles["settings-audit-action-badge"]} ${styles[`settings-action-badge-${log.action}`]}`} title={log.details}>
                      {AUDIT_ACTION_LABELS[log.action] || log.action}
                    </span>
                  </td>
                  <td className={styles["settings-text-muted"]}>{log.entityName || "-"}</td>
                  <td className={`${styles["settings-text-muted"]} ${styles["settings-ellipsis-150"]}`}>{log.before ? JSON.stringify(log.before) : "-"}</td>
                  <td className={`${styles["settings-text-muted"]} ${styles["settings-ellipsis-150"]}`}>{log.after ? JSON.stringify(log.after) : "-"}</td>
                  <td className={styles["settings-text-muted"]}>{log.ipAddress || "-"}</td>
                  <td className={styles["settings-text-muted"]}>{log.device || "-"}</td>
                  <td>
                    {getLogStatus(log) ? (
                      <span className={`${ui["ui-badge"]} ${getLogStatus(log) === "success" ? ui["ui-badge-success"] : ui["ui-badge-danger"]}`}>{getLogStatus(log).toUpperCase()}</span>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className={styles["settings-pagination"]}>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-sm"]} ${ui["ui-btn-secondary"]}`} onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>
            {"<-"} Prev
          </button>
          <span className={styles["settings-pagination-info"]}>
            Page {page} of {totalPages}
          </span>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-sm"]} ${ui["ui-btn-secondary"]}`} onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}>
            Next {"->"}
          </button>
        </div>
      )}
    </div>
  );
}
