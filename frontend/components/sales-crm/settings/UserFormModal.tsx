"use client";

// SalesCRM — Add/Edit user modal

import { useState, useEffect } from "react";
import { Role } from "@/lib/sales-crm/types";
import { SettingsUser } from "@/lib/sales-crm/types/settings";
import { ROLE_LABELS } from "@/lib/sales-crm/constants";
import styles from "@/styles/sales-crm/settings.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

interface UserFormModalProps {
  user?: SettingsUser; // undefined = create mode
  onSave: (data: Omit<SettingsUser, "id">) => void;
  onClose: () => void;
}

const DEPARTMENTS = ["Management", "Sales", "Pre-Sales", "Engineering", "Marketing", "Support", "HR", "Finance"];
const TEAMS = ["team-1", "team-2", "team-3", "team-4", "team-5"];

function getEmptyForm(): Omit<SettingsUser, "id"> {
  return {
    first_name: "",
    last_name: "",
    email: "",
    role: Role.EMPLOYEE,
    department: "",
    team_id: "",
    status: "active",
    permissions_view: true,
    permissions_add: true,
    permissions_edit: true,
    permissions_delete: false,
    permissions_export: false,
    assignable_to_leads: false,
    assignable_to_requirements: false,
    assignable_to_deals: false,
    password_reset_required: true,
  };
}

export default function UserFormModal({ user, onSave, onClose }: UserFormModalProps) {
  const isEdit = !!user;
  const [form, setForm] = useState<Omit<SettingsUser, "id">>(user ? { ...user } : getEmptyForm());
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.first_name.trim()) errs.first_name = "First name is required";
    if (!form.last_name.trim()) errs.last_name = "Last name is required";
    if (!form.email.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = "Invalid email format";
    if (!form.department) errs.department = "Department is required";
    if (!form.team_id) errs.team_id = "Team is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSave(form);
    }
  };

  const updateField = <K extends keyof Omit<SettingsUser, "id">>(key: K, value: Omit<SettingsUser, "id">[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  return (
    <div className={ui["ui-modal-overlay"]} onClick={onClose}>
      <div className={`${ui["ui-modal"]} ${styles["settings-user-modal"]}`} onClick={(e) => e.stopPropagation()}>
        <div className={ui["ui-modal-header"]}>
          <h3 className={ui["ui-modal-title"]}>{isEdit ? "Edit User" : "Add New User"}</h3>
          <button className={ui["ui-modal-close"]} onClick={onClose}>
            X
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={ui["ui-modal-body"]}>
            {/* Name row */}
            <div className={styles["settings-form-row"]}>
              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>First Name *</label>
                <input
                  className={`${ui["ui-input"]} ${errors.first_name ? "ui-input-error" : ""}`}
                  value={form.first_name}
                  onChange={(e) => updateField("first_name", e.target.value)}
                  placeholder="Enter first name"
                />
                {errors.first_name && <span className={styles["settings-error-text"]}>{errors.first_name}</span>}
              </div>
              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>Last Name *</label>
                <input
                  className={`${ui["ui-input"]} ${errors.last_name ? "ui-input-error" : ""}`}
                  value={form.last_name}
                  onChange={(e) => updateField("last_name", e.target.value)}
                  placeholder="Enter last name"
                />
                {errors.last_name && <span className={styles["settings-error-text"]}>{errors.last_name}</span>}
              </div>
            </div>

            {/* Email */}
            <div className={ui["ui-form-group"]}>
              <label className={ui["ui-label"]}>Email *</label>
              <input
                className={`${ui["ui-input"]} ${errors.email ? "ui-input-error" : ""}`}
                type="email"
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
                placeholder="user@company.com"
              />
              {errors.email && <span className={styles["settings-error-text"]}>{errors.email}</span>}
            </div>

            {/* Role & Department */}
            <div className={styles["settings-form-row"]}>
              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>Role</label>
                <select className={ui["ui-select"]} value={form.role} onChange={(e) => updateField("role", e.target.value as Role)}>
                  {Object.values(Role).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>Department *</label>
                <select
                  className={`${ui["ui-select"]} ${errors.department ? "ui-input-error" : ""}`}
                  value={form.department}
                  onChange={(e) => updateField("department", e.target.value)}
                >
                  <option value="">Select department</option>
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                {errors.department && <span className={styles["settings-error-text"]}>{errors.department}</span>}
              </div>
            </div>

            {/* Team & Status */}
            <div className={styles["settings-form-row"]}>
              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>Team *</label>
                <select
                  className={`${ui["ui-select"]} ${errors.team_id ? "ui-input-error" : ""}`}
                  value={form.team_id}
                  onChange={(e) => updateField("team_id", e.target.value)}
                >
                  <option value="">Select team</option>
                  {TEAMS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                {errors.team_id && <span className={styles["settings-error-text"]}>{errors.team_id}</span>}
              </div>
              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>Status</label>
                <select className={ui["ui-select"]} value={form.status} onChange={(e) => updateField("status", e.target.value as "active" | "inactive")}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            {/* Additional Fields */}
            <div className={styles["settings-form-row"]}>
              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>Location</label>
                <input className={ui["ui-input"]} value={form.location || ""} onChange={(e) => updateField("location", e.target.value)} placeholder="Enter location" />
              </div>
              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>Manager</label>
                <input className={ui["ui-input"]} value={form.manager || ""} onChange={(e) => updateField("manager", e.target.value)} placeholder="Manager name" />
              </div>
            </div>
            <div className={styles["settings-form-row"]}>
              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>User Type</label>
                <select className={ui["ui-select"]} value={form.user_type || ""} onChange={(e) => updateField("user_type", e.target.value)}>
                  <option value="">Select type</option>
                  <option value="Full-Time">Full-Time</option>
                  <option value="Part-Time">Part-Time</option>
                  <option value="Contractor">Contractor</option>
                </select>
              </div>
              <div className={ui["ui-form-group"]}>{/* Empty placeholder to keep grid layout balanced */}</div>
            </div>
            <div className={styles["settings-form-row"]}>
              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>Employee ID</label>
                <input className={ui["ui-input"]} value={form.employee_id || ""} onChange={(e) => updateField("employee_id", e.target.value)} placeholder="EMP-XXXX" />
              </div>
              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>Region</label>
                <input className={ui["ui-input"]} value={form.region || ""} onChange={(e) => updateField("region", e.target.value)} placeholder="Enter region" />
              </div>
            </div>
            <div className={styles["settings-form-row"]}>
              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>Joining Date</label>
                <input type="date" className={ui["ui-input"]} value={form.joining_date || ""} onChange={(e) => updateField("joining_date", e.target.value)} />
              </div>
              <div className={ui["ui-form-group"]}>{/* Empty placeholder to keep grid layout balanced */}</div>
            </div>

            {/* Permissions Section */}
            <div className={styles["settings-form-section"]}>
              <h4 className={styles["settings-form-section-title"]}>Permissions</h4>
              <div className={styles["settings-checkbox-grid"]}>
                {(["view", "add", "edit", "delete", "export"] as const).map((perm) => {
                  const key = `permissions_${perm}` as keyof Omit<SettingsUser, "id">;
                  return (
                    <label key={perm} className={styles["settings-checkbox-label"]}>
                      <input type="checkbox" className={styles["settings-checkbox"]} checked={form[key] as boolean} onChange={(e) => updateField(key, e.target.checked)} />
                      <span className={styles["settings-checkbox-text"]}>{perm.charAt(0).toUpperCase() + perm.slice(1)}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Assignable Section */}
            <div className={styles["settings-form-section"]}>
              <h4 className={styles["settings-form-section-title"]}>Assignable To</h4>
              <div className={styles["settings-checkbox-grid"]}>
                {(["leads", "requirements", "deals"] as const).map((entity) => {
                  const key = `assignable_to_${entity}` as keyof Omit<SettingsUser, "id">;
                  return (
                    <label key={entity} className={styles["settings-checkbox-label"]}>
                      <input type="checkbox" className={styles["settings-checkbox"]} checked={form[key] as boolean} onChange={(e) => updateField(key, e.target.checked)} />
                      <span className={styles["settings-checkbox-text"]}>{entity.charAt(0).toUpperCase() + entity.slice(1)}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Password Reset */}
            <label className={`${styles["settings-checkbox-label"]} ${styles["settings-mt-12"]}`}>
              <input type="checkbox" className={styles["settings-checkbox"]} checked={form.password_reset_required} onChange={(e) => updateField("password_reset_required", e.target.checked)} />
              <span className={styles["settings-checkbox-text"]}>Require password reset on next login</span>
            </label>
          </div>

          <div className={ui["ui-modal-footer"]}>
            <button type="button" className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`}>
              {isEdit ? "Save Changes" : "Create User"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
