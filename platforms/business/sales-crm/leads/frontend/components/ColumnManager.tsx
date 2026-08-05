"use client";

import { useState, useEffect } from "react";
import { ColumnConfig, logAction, useAuth } from "@apex/sales-crm-shared";
import { X, ArrowUp, ArrowDown, Plus, Trash2 } from "lucide-react";
import styles from "@/styles/sales-crm/leads.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

interface ColumnManagerProps {
  columns: ColumnConfig[];
  setColumns: (columns: ColumnConfig[]) => void;
  onClose: () => void;
}

export default function ColumnManager({
  columns,
  setColumns,
  onClose,
}: ColumnManagerProps) {
  const { user } = useAuth();

  const [newColLabel, setNewColLabel] = useState("");
  const [newColType, setNewColType] = useState<
    "text" | "number" | "date" | "select"
  >("text");
  const [newColOptions, setNewColOptions] = useState("");
  const [error, setError] = useState("");

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const moveUp = (index: number) => {
    if (index === 0) return;
    const newCols = [...columns];
    [newCols[index - 1], newCols[index]] = [
      newCols[index],
      newCols[index - 1],
    ];
    setColumns(newCols);

    logAction({
      userId: user?.id || "system",
      userName: user?.name || "System",
      userRole: user?.role || "SYSTEM",
      action: "column_reorder",
      collection: "Leads",
      details: `Reordered column "${columns[index].label}" up`,
      metadata: { columnId: columns[index].id, newIndex: index - 1 },
    });
  };

  const moveDown = (index: number) => {
    if (index === columns.length - 1) return;
    const newCols = [...columns];
    [newCols[index + 1], newCols[index]] = [
      newCols[index],
      newCols[index + 1],
    ];
    setColumns(newCols);

    logAction({
      userId: user?.id || "system",
      userName: user?.name || "System",
      userRole: user?.role || "SYSTEM",
      action: "column_reorder",
      collection: "Leads",
      details: `Reordered column "${columns[index].label}" down`,
      metadata: { columnId: columns[index].id, newIndex: index + 1 },
    });
  };

  const toggleVisibility = (index: number) => {
    const newCols = [...columns];
    newCols[index] = {
      ...newCols[index],
      visible: !newCols[index].visible,
    };
    setColumns(newCols);

    logAction({
      userId: user?.id || "system",
      userName: user?.name || "System",
      userRole: user?.role || "SYSTEM",
      action: "column_visibility_toggle",
      collection: "Leads",
      details: `${newCols[index].visible ? "Showed" : "Hid"} column "${columns[index].label}"`,
      metadata: {
        columnId: columns[index].id,
        visible: newCols[index].visible,
      },
    });
  };

  const deleteColumn = (index: number) => {
    const colToDelete = columns[index];
    if (!colToDelete.isCustom) return;

    const newCols = columns.filter((_, i) => i !== index);
    setColumns(newCols);

    logAction({
      userId: user?.id || "system",
      userName: user?.name || "System",
      userRole: user?.role || "SYSTEM",
      action: "custom_column_delete",
      collection: "Leads",
      details: `Deleted custom column "${colToDelete.label}"`,
      metadata: { columnId: colToDelete.id },
    });
  };

  const handleAddCustomColumn = () => {
    setError("");
    if (!newColLabel.trim()) {
      setError("Label is required.");
      return;
    }

    const id =
      "custom_" +
      newColLabel
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "_");
    if (columns.some((c) => c.id === id)) {
      setError("A column with a similar name already exists.");
      return;
    }

    const newCol: ColumnConfig = {
      id,
      label: newColLabel.trim(),
      visible: true,
      isCustom: true,
      type: newColType,
      options:
        newColType === "select"
          ? newColOptions
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
    };

    setColumns([...columns, newCol]);

    logAction({
      userId: user?.id || "system",
      userName: user?.name || "System",
      userRole: user?.role || "SYSTEM",
      action: "custom_column_create",
      collection: "Leads",
      details: `Created custom column "${newCol.label}" (${newCol.type})`,
      metadata: { columnId: newCol.id, type: newCol.type },
    });

    setNewColLabel("");
    setNewColType("text");
    setNewColOptions("");
  };

  return (
    <div className={ui["ui-modal-overlay"]} onClick={onClose}>
      <div
        className={`${ui["ui-modal"]} ${styles["lead-colmgr-modal"]}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={ui["ui-modal-header"]}>
          <h2 className={ui["ui-modal-title"]}>Manage Columns</h2>
          <button
            className={ui["ui-modal-close"]}
            onClick={onClose}
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className={ui["ui-modal-body"]}>
          {/* Active Columns Section */}
          <section className={styles["lead-colmgr-section"]}>
            <h3 className={styles["lead-colmgr-section-title"]}>Active Columns</h3>
            <p className={`${styles["lead-text-sm"]} ${styles["lead-text-muted"]} ${styles["lead-mb-3"]}`}>
              Reorder columns or toggle their visibility.
            </p>

            <div className={styles["lead-colmgr-list"]}>
              {columns.map((col, idx) => (
                <div key={col.id} className={styles["lead-colmgr-row"]}>
                  <div className={styles["lead-colmgr-row-left"]}>
                    <input
                      type="checkbox"
                      checked={col.visible}
                      onChange={() => toggleVisibility(idx)}
                      title={`Toggle visibility for ${col.label}`}
                    />
                    <span
                      className={
                        col.visible
                          ? styles["lead-font-medium"]
                          : styles["lead-text-muted"]
                      }
                    >
                      {col.label}
                    </span>
                    {col.isCustom && (
                      <span className={`${ui["ui-badge"]} ui-badge-secondary ${styles["lead-text-xs"]}`}>
                        Custom
                      </span>
                    )}
                  </div>
                  <div className={styles["lead-colmgr-row-right"]}>
                    <button
                      className={`${ui["ui-btn"]} ui-btn-icon ${ui["ui-btn-sm"]}`}
                      onClick={() => moveUp(idx)}
                      disabled={idx === 0}
                      title="Move Up"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      className={`${ui["ui-btn"]} ui-btn-icon ${ui["ui-btn-sm"]}`}
                      onClick={() => moveDown(idx)}
                      disabled={idx === columns.length - 1}
                      title="Move Down"
                    >
                      <ArrowDown size={14} />
                    </button>
                    {col.isCustom && (
                      <button
                        className={`${ui["ui-btn"]} ui-btn-icon ${ui["ui-btn-sm"]} ${styles["lead-text-error"]}`}
                        onClick={() => deleteColumn(idx)}
                        title="Delete Custom Column"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Divider */}
          <hr className={styles["lead-colmgr-divider"]} />

          {/* Add Custom Column Section */}
          <section className={styles["lead-colmgr-section"]}>
            <h3 className={styles["lead-colmgr-section-title"]}>
              Add Custom Column
            </h3>

            <div className={styles["lead-colmgr-form"]}>
              <div className="lead-field">
                <label className={styles["lead-field-label"]}>Column Label</label>
                <input
                  type="text"
                  className={ui["ui-input"]}
                  value={newColLabel}
                  onChange={(e) => setNewColLabel(e.target.value)}
                  placeholder="e.g. Project Size"
                />
              </div>
              <div className="lead-field">
                <label className={styles["lead-field-label"]}>Data Type</label>
                <select
                  className={ui["ui-select"]}
                  value={newColType}
                  onChange={(e) =>
                    setNewColType(
                      e.target.value as
                        | "text"
                        | "number"
                        | "date"
                        | "select"
                    )
                  }
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                  <option value="select">Dropdown / Select</option>
                </select>
              </div>
            </div>

            {newColType === "select" && (
              <div className={`lead-field ${styles["lead-mt-3"]}`}>
                <label className={styles["lead-field-label"]}>
                  Options (comma separated)
                </label>
                <input
                  type="text"
                  className={ui["ui-input"]}
                  value={newColOptions}
                  onChange={(e) => setNewColOptions(e.target.value)}
                  placeholder="e.g. Small, Medium, Large"
                />
              </div>
            )}

            {error && (
              <div className={`${styles["lead-text-error"]} ${styles["lead-text-sm"]} ${styles["lead-mt-2"]}`}>
                {error}
              </div>
            )}

            <div className={`${styles["lead-mt-3"]} ${styles["lead-flex"]} ${styles["lead-justify-end"]}`}>
              <button
                className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]} ${styles["lead-flex"]} ${styles["lead-align-center"]} ${styles["lead-gap-2"]}`}
                onClick={handleAddCustomColumn}
              >
                <Plus size={16} /> Add Column
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
