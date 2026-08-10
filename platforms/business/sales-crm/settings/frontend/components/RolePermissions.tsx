"use client";

// SalesCRM — Role Permissions matrix editor

import { useState } from "react";
import { useAuth, Role, ROLE_LABELS } from "@apex/sales-crm-shared";
import { useSettingsStore } from "../lib/settings-store";
import { RolePermissionDefaults, RolePermissionSet } from "../lib/types/settings";
import styles from "../styles/settings.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

const PERMISSION_KEYS: (keyof RolePermissionSet)[] = ["view", "add", "edit", "delete", "export"];
const PERMISSION_LABELS: Record<keyof RolePermissionSet, string> = {
  view: "View",
  add: "Add",
  edit: "Edit",
  delete: "Delete",
  export: "Export",
};

const PERMISSION_ICONS: Record<keyof RolePermissionSet, string> = {
  view: "V",
  add: "+",
  edit: "E",
  delete: "X",
  export: "->",
};

export default function RolePermissions() {
  const { user: authUser } = useAuth();
  const { state, updateRolePermissions, addCustomRole, updateCustomRole, deleteCustomRole } = useSettingsStore();
  const [draft, setDraft] = useState<RolePermissionDefaults>({ ...state.rolePermissions });
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<"base" | "custom">("base");

  const [newCustomRoleName, setNewCustomRoleName] = useState("");
  const [newCustomRoleBase, setNewCustomRoleBase] = useState<Role>(Role.EMPLOYEE);

  const roles = Object.values(Role);

  const canEdit = authUser && ["SUPERADMIN", "ADMIN"].includes(authUser.role.toUpperCase());

  const togglePermission = (role: Role, perm: keyof RolePermissionSet) => {
    if (!canEdit) return;
    setDraft((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        [perm]: !prev[role][perm],
      },
    }));
    setSaved(false);
  };

  const handleSave = () => {
    if (!authUser) return;
    updateRolePermissions(draft, authUser.name, authUser.id);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleAddCustomRole = () => {
    if (!authUser || !canEdit || !newCustomRoleName.trim()) return;

    addCustomRole(
      {
        name: newCustomRoleName.trim(),
        description: `Custom role based on ${newCustomRoleBase}`,
        base_role: newCustomRoleBase,
        permissions: { ...draft[newCustomRoleBase] },
      },
      authUser.name,
      authUser.id
    );

    setNewCustomRoleName("");
  };

  const toggleCustomRolePermission = (roleId: string, perm: keyof RolePermissionSet, currentPerms: RolePermissionSet) => {
    if (!authUser || !canEdit) return;
    updateCustomRole(
      roleId,
      {
        permissions: {
          ...currentPerms,
          [perm]: !currentPerms[perm],
        },
      },
      authUser.name,
      authUser.id
    );
  };

  const hasChanges = JSON.stringify(draft) !== JSON.stringify(state.rolePermissions);

  return (
    <div className={ui["ui-card"]}>
      <div className={ui["ui-card-header"]}>
        <div>
          <h2 className={ui["ui-card-title"]}>Role Permissions</h2>
          <p className={ui["ui-card-subtitle"]}>Configure default permissions for each role</p>
        </div>
        <div className={styles["settings-header-actions"]}>
          {saved && <span className={styles["settings-save-indicator"]}>Saved</span>}
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={handleSave} disabled={!hasChanges || !canEdit}>
            Save Permissions
          </button>
        </div>
      </div>

      <div className={`${ui["ui-tabs"]} ${styles["settings-tabs-container"]}`}>
        <button
          className={`${ui["ui-tab"]} ${styles["settings-tab-btn"]} ${activeTab === "base" ? `active ${styles["settings-tab-btn-active"]}` : styles["settings-tab-btn-inactive"]}`}
          onClick={() => setActiveTab("base")}
        >
          Base Roles
        </button>
        <button
          className={`${ui["ui-tab"]} ${styles["settings-tab-btn"]} ${activeTab === "custom" ? `active ${styles["settings-tab-btn-active"]}` : styles["settings-tab-btn-inactive"]}`}
          onClick={() => setActiveTab("custom")}
        >
          Custom Roles
        </button>
      </div>

      {!canEdit && <div className={`${ui["ui-notice"]} ${ui["ui-notice-warning"]} ${styles["settings-notice-container"]}`}>You need Admin privileges to modify role permissions.</div>}

      {activeTab === "base" && (
        <>
          <div className={styles["settings-permissions-matrix"]}>
            <table className={`${ui["ui-table"]} ${styles["settings-permissions-table"]}`}>
              <thead>
                <tr>
                  <th className={styles["settings-perm-role-col"]}>Role</th>
                  {PERMISSION_KEYS.map((perm) => (
                    <th key={perm} className={styles["settings-perm-header"]}>
                      <span className={styles["settings-perm-header-icon"]}>{PERMISSION_ICONS[perm]}</span>
                      <span>{PERMISSION_LABELS[perm]}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role} className="ui-table-row">
                    <td>
                      <div className={styles["settings-role-cell"]}>
                        <div className={`${styles["settings-role-dot"]} ${styles[`settings-role-bg-${role}`]}`} />
                        <span className={styles["settings-role-name"]}>{ROLE_LABELS[role]}</span>
                      </div>
                    </td>
                    {PERMISSION_KEYS.map((perm) => (
                      <td key={perm} className={styles["settings-perm-toggle-cell"]}>
                        <button
                          className={`${styles["settings-toggle"]} ${draft[role][perm] ? styles["settings-toggle-on"] : styles["settings-toggle-off"]} ${!canEdit ? styles["settings-toggle-disabled"] : ""}`}
                          onClick={() => togglePermission(role, perm)}
                          aria-label={`${PERMISSION_LABELS[perm]} for ${ROLE_LABELS[role]}`}
                          disabled={!canEdit}
                        >
                          <span className={styles["settings-toggle-knob"]} />
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles["settings-permissions-legend"]}>
            <p className={styles["settings-legend-text"]}>
              Note: Changes will apply to new users and be referenced during permission checks. Existing user permissions can be overridden individually via User Management.
            </p>
          </div>
        </>
      )}

      {activeTab === "custom" && (
        <div className={styles["settings-custom-role-container"]}>
          <div className={`${ui["ui-card"]} settings-mb-12 ${styles["settings-custom-role-card"]}`}>
            <h3 className={`${ui["ui-card-title"]} ${styles["settings-mb-8"]}`}>Create Custom Role</h3>
            <div className={styles["settings-custom-role-row"]}>
              <div className={`${ui["ui-form-group"]} ui-form-group-sm ${styles["settings-flex-1"]} ${styles["settings-mb-0"]}`}>
                <label className="ui-label-sm">Role Name</label>
                <input
                  className={`${ui["ui-input"]} ui-input-sm`}
                  placeholder="e.g. Senior Manager"
                  value={newCustomRoleName}
                  onChange={(e) => setNewCustomRoleName(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div className={`${ui["ui-form-group"]} ui-form-group-sm ${styles["settings-flex-1"]} ${styles["settings-mb-0"]}`}>
                <label className="ui-label-sm">Base Role</label>
                <select className={`${ui["ui-select"]} ui-select-sm`} value={newCustomRoleBase} onChange={(e) => setNewCustomRoleBase(e.target.value as Role)} disabled={!canEdit}>
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
              <button className={`${ui["ui-btn"]} ${ui["ui-btn-sm"]} ${ui["ui-btn-primary"]}`} onClick={handleAddCustomRole} disabled={!canEdit || !newCustomRoleName.trim()}>
                Create Role
              </button>
            </div>
          </div>

          <div className={styles["settings-permissions-matrix"]}>
            {state.customRoles.length === 0 ? (
              <div className={styles["settings-empty-state"]}>
                <span className={styles["settings-empty-icon"]}>ROLES</span>
                <p>No custom roles defined.</p>
              </div>
            ) : (
              <table className={`${ui["ui-table"]} ${styles["settings-permissions-table"]}`}>
                <thead>
                  <tr>
                    <th className={styles["settings-perm-role-col"]}>Role</th>
                    {PERMISSION_KEYS.map((perm) => (
                      <th key={perm} className={styles["settings-perm-header"]}>
                        <span className={styles["settings-perm-header-icon"]}>{PERMISSION_ICONS[perm]}</span>
                        <span>{PERMISSION_LABELS[perm]}</span>
                      </th>
                    ))}
                    <th className={styles["settings-text-right"]}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {state.customRoles.map((crole) => (
                    <tr key={crole.id} className="ui-table-row">
                      <td>
                        <div className={styles["settings-role-cell"]}>
                          <span className={styles["settings-role-name"]}>{crole.name}</span>
                          <span className={`${styles["settings-text-muted"]} ${styles["settings-text-xs-block"]}`}>Base: {ROLE_LABELS[crole.base_role]}</span>
                        </div>
                      </td>
                      {PERMISSION_KEYS.map((perm) => (
                        <td key={perm} className={styles["settings-perm-toggle-cell"]}>
                          <button
                            className={`${styles["settings-toggle"]} ${crole.permissions[perm] ? styles["settings-toggle-on"] : styles["settings-toggle-off"]} ${!canEdit ? styles["settings-toggle-disabled"] : ""}`}
                            onClick={() => toggleCustomRolePermission(crole.id, perm, crole.permissions)}
                            aria-label={`${PERMISSION_LABELS[perm]} for ${crole.name}`}
                            disabled={!canEdit}
                          >
                            <span className={styles["settings-toggle-knob"]} />
                          </button>
                        </td>
                      ))}
                      <td>
                        <button
                          className="ui-btn-icon ui-btn-icon-danger"
                          onClick={() => {
                            if (authUser && canEdit) {
                              deleteCustomRole(crole.id, authUser.name, authUser.id);
                            }
                          }}
                          disabled={!canEdit}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
