"use client";

import { useState } from "react";
import { CollectionType, getSchema, DatabaseRecord } from "@/lib/sales-crm/database-schema";
import styles from "@/styles/sales-crm/database.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

interface DatabaseModalProps {
  collection: CollectionType;
  record?: DatabaseRecord | null;
  onClose: () => void;
  onSave: (record: DatabaseRecord) => void;
}

function generateId(collection: string, data: Record<string, unknown>) {
  const str = JSON.stringify(data);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return `${collection.slice(0, 2).toLowerCase()}-${Math.abs(hash).toString(36)}`;
}

export default function DatabaseModal({ collection, record, onClose, onSave }: DatabaseModalProps) {
  const schema = getSchema(collection);

  const [formData, setFormData] = useState<DatabaseRecord>(() => {
    return { ...record };
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => {
        const newErrs = { ...prev };
        delete newErrs[name];
        return newErrs;
      });
    }
  };

  const handleSave = () => {
    const newErrors: Record<string, string> = {};
    let valid = true;

    schema.forEach((field) => {
      if (field.required && !formData[field.name]) {
        newErrors[field.name] = "Required field";
        valid = false;
      }
    });

    if (!valid) {
      setErrors(newErrors);
      return;
    }

    const newId = formData.id || generateId(collection, formData);

    onSave({
      ...formData,
      id: newId,
      status: formData.status || "Active",
      archived: formData.archived || "No",
    });
  };

  return (
    <div className={ui["ui-modal-overlay"]}>
      <div className={`${ui["ui-modal"]} ${styles["db-modal-md"]}`}>
        <div className={ui["ui-modal-header"]}>
          <h3>{record ? `Update ${collection} Profile` : `Add ${collection}`}</h3>
          <button className={styles["db-modal-close"]} onClick={onClose}>
            &times;
          </button>
        </div>

        <div className={`${ui["ui-modal-body"]} ${styles["db-modal-form"]}`}>
          <div className={ui["ui-form-grid"]}>
            {schema
              .filter((f) => f.name !== "owner_id")
              .map((field) => (
                <div key={field.name} className={ui["ui-form-group"]}>
                  <label className={ui["ui-label"]}>
                    {field.label} {field.required && <span className={styles["db-required"]}>*</span>}
                  </label>

                  {field.type === "select" ? (
                    <select
                      className={`${ui["ui-select"]} ${errors[field.name] ? styles["db-input-error"] : ""}`}
                      value={String(formData[field.name] || "")}
                      onChange={(e) => handleChange(field.name, e.target.value)}
                    >
                      <option value="">Select {field.label}</option>
                      {field.options?.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      className={`${ui["ui-input"]} ${styles["db-textarea-no-resize"]} ${errors[field.name] ? styles["db-input-error"] : ""}`}
                      value={String(formData[field.name] || "")}
                      onChange={(e) => handleChange(field.name, e.target.value)}
                    />
                  ) : (
                    <input
                      type={field.type === "date" ? "date" : "text"}
                      className={`${ui["ui-input"]} ${errors[field.name] ? styles["db-input-error"] : ""}`}
                      value={String(formData[field.name] || "")}
                      onChange={(e) => handleChange(field.name, e.target.value)}
                      placeholder={`Enter ${field.label}`}
                    />
                  )}
                  {errors[field.name] && <span className={styles["db-error-text"]}>{errors[field.name]}</span>}
                </div>
              ))}
          </div>
        </div>

        <div className={`${ui["ui-modal-footer"]} ${styles["db-action-row"]}`}>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={onClose}>
            Cancel
          </button>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={handleSave}>
            {record ? "Save Changes" : "Add Record"}
          </button>
        </div>
      </div>
    </div>
  );
}
