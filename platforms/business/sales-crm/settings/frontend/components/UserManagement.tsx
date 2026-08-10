"use client";

// SalesCRM — User Management component

import { useState } from "react";
import { useAuth, Role, ROLE_LABELS } from "@apex/sales-crm-shared";
import { useSettingsStore } from "@/lib/sales-crm/settings-store";
import { SettingsUser } from "@/lib/sales-crm/types/settings";
import UserFormModal from "./UserFormModal";
import ConfirmModal from "@/components/sales-crm/ui/ConfirmModal";
import styles from "../styles/settings.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

const MANAGER_ROLES: Role[] = [Role.SUPERADMIN, Role.ADMIN, Role.MANAGER];

export default function UserManagement() {
  const { user: authUser } = useAuth();
  const { state, addUser, updateUser, deactivateUser } = useSettingsStore();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<SettingsUser | null>(null);
  const [deactivatingUser, setDeactivatingUser] = useState<SettingsUser | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "inactive">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Access check
  if (!authUser || !MANAGER_ROLES.includes(authUser.role as Role)) {
    return (
      <div className={styles["settings-access-denied"]}>
        <div className={styles["settings-access-denied-icon"]}>!</div>
        <h3>Access Restricted</h3>
        <p>User management is available to Managers, Admins, and Super Admins only.</p>
      </div>
    );
  }

  const filteredUsers = state.users.filter((u) => {
    if (filterStatus !== "all" && u.status !== filterStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return u.first_name.toLowerCase().includes(q) || u.last_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.department.toLowerCase().includes(q);
    }
    return true;
  });

  const handleSaveUser = (data: Omit<SettingsUser, "id">) => {
    if (editingUser) {
      updateUser(editingUser.id, data, authUser.name, authUser.id);
      setEditingUser(null);
    } else {
      addUser(data, authUser.name, authUser.id);
      setShowAddModal(false);
    }
  };

  const handleDeactivate = () => {
    if (deactivatingUser) {
      deactivateUser(deactivatingUser.id, authUser.name, authUser.id);
      setDeactivatingUser(null);
    }
  };

  const permissionPills = (u: SettingsUser) => {
    const perms = [];
    if (u.permissions_view) perms.push("View");
    if (u.permissions_add) perms.push("Add");
    if (u.permissions_edit) perms.push("Edit");
    if (u.permissions_delete) perms.push("Delete");
    if (u.permissions_export) perms.push("Export");
    return perms;
  };

  return (
    <div className={ui["ui-card"]}>
      {/* Header */}
      <div className={ui["ui-card-header"]}>
        <div>
          <h2 className={ui["ui-card-title"]}>User Management</h2>
          <p className={ui["ui-card-subtitle"]}>Manage team members, roles, and permissions</p>
        </div>
        <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={() => setShowAddModal(true)}>
          <span>+</span> Add User
        </button>
      </div>

      {/* Filters */}
      <div className={styles["settings-filter-bar"]}>
        <div className={styles["settings-search-wrapper"]}>
          <span className={styles["settings-search-icon"]}>Q</span>
          <input type="text" className={styles["settings-search-input"]} placeholder="Search users..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <div className={styles["settings-filter-pills"]}>
          {(["all", "active", "inactive"] as const).map((s) => (
            <button key={s} className={`${styles["settings-filter-pill"]} ${filterStatus === s ? styles["settings-filter-pill-active"] : ""}`} onClick={() => setFilterStatus(s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
              {s !== "all" && <span className={styles["settings-filter-count"]}>{state.users.filter((u) => u.status === s).length}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* User Table */}
      <div className={ui["ui-table-container"]}>
        <table className={ui["ui-table"]}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Department</th>
              <th>Team</th>
              <th>Status</th>
              <th>Permissions</th>
              <th className={styles["settings-text-right"]}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={8} className={ui["ui-table-empty"]}>
                  <div className={styles["settings-empty-state"]}>
                    <span className={styles["settings-empty-icon"]}>USERS</span>
                    <p>No users found matching your filters</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => (
                <tr key={u.id} className="ui-table-row">
                  <td>
                    <div className={styles["settings-user-cell"]}>
                      <div className={`${styles["settings-user-avatar-sm"]} ${styles[`settings-role-badge-${u.role}`]}`}>
                        {u.first_name.charAt(0)}
                        {u.last_name.charAt(0)}
                      </div>
                      <span className={styles["settings-user-name-cell"]}>
                        {u.first_name} {u.last_name}
                      </span>
                    </div>
                  </td>
                  <td className={styles["settings-text-muted"]}>{u.email}</td>
                  <td>
                    <span className={`${styles["settings-role-badge"]} ${styles[`settings-role-badge-${u.role}`]}`}>{ROLE_LABELS[u.role]}</span>
                  </td>
                  <td>{u.department}</td>
                  <td className={styles["settings-text-muted"]}>{u.team_id}</td>
                  <td>
                    <span className={`${styles["settings-status-badge"]} ${styles[`settings-status-${u.status}`]}`}>{u.status}</span>
                  </td>
                  <td>
                    <div className={styles["settings-perm-pills"]}>
                      {permissionPills(u).map((p) => (
                        <span key={p} className={styles["settings-perm-pill"]}>
                          {p}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className={styles["settings-action-btns"]}>
                      <button className={`${styles["settings-action-btn"]} ${styles["settings-action-edit"]}`} onClick={() => setEditingUser(u)} title="Edit user">
                        Edit
                      </button>
                      {u.status === "active" && (
                        <button className={`${styles["settings-action-btn"]} ${styles["settings-action-deactivate"]}`} onClick={() => setDeactivatingUser(u)} title="Deactivate user">
                          Deactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      {showAddModal && <UserFormModal onSave={handleSaveUser} onClose={() => setShowAddModal(false)} />}
      {editingUser && <UserFormModal user={editingUser} onSave={handleSaveUser} onClose={() => setEditingUser(null)} />}
      {deactivatingUser && (
        <ConfirmModal
          title="Deactivate User"
          message={`Are you sure you want to deactivate ${deactivatingUser.first_name} ${deactivatingUser.last_name}? They will no longer be able to access the system.`}
          confirmLabel="Deactivate"
          variant="danger"
          onConfirm={handleDeactivate}
          onCancel={() => setDeactivatingUser(null)}
        />
      )}
    </div>
  );
}
