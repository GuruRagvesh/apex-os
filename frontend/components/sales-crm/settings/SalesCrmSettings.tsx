"use client";

// SalesCRM — Settings page
// Replaces the placeholder with a full settings management module

import { useState } from "react";
import ProfileSettings from "./ProfileSettings";
import UserManagement from "./UserManagement";
import RolePermissions from "./RolePermissions";
import CRMConfiguration from "./CRMConfiguration";
import ImportData from "./ImportData";
import AuditLogs from "./AuditLogs";
import BackupRestore from "./BackupRestore";
import Integrations from "./Integrations";
import styles from "@/styles/sales-crm/settings.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

type SettingsSection = "profile" | "users" | "roles" | "audit" | "integrations" | "backup" | "import" | "crm";

const SETTINGS_SECTIONS: { id: SettingsSection; label: string; icon: string }[] = [
  { id: "profile", label: "Profile", icon: "P" },
  { id: "users", label: "User Management", icon: "U" },
  { id: "roles", label: "Role Permissions", icon: "R" },
  { id: "audit", label: "Activity Logs", icon: "A" },
  { id: "integrations", label: "Integrations", icon: "V" },
  { id: "backup", label: "Backup & Restore", icon: "B" },
  { id: "import", label: "Import Data", icon: "I" },
  { id: "crm", label: "Advanced Configuration", icon: "C" },
];

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("profile");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSections = SETTINGS_SECTIONS.filter((section) => section.label.toLowerCase().includes(searchQuery.toLowerCase()));

  const renderSettingsContent = () => {
    switch (activeSection) {
      case "profile":
        return <ProfileSettings />;
      case "users":
        return <UserManagement />;
      case "roles":
        return <RolePermissions />;
      case "audit":
        return <AuditLogs />;
      case "integrations":
        return <Integrations />;
      case "backup":
        return <BackupRestore />;
      case "import":
        return <ImportData />;
      case "crm":
        return <CRMConfiguration />;
      default:
        return null;
    }
  };

  return (
    <div className={styles["settings-page"]}>
      <div className={styles["settings-admin-header"]}>
        <div>
          <h1 className={styles["settings-admin-title"]}>Settings & Administration</h1>
          <p className={styles["settings-admin-subtitle"]}>Manage workspace preferences, users, and integrations.</p>
        </div>
      </div>
      <div className={styles["settings-layout"]}>
        {/* Left sidebar navigation */}
        <nav className={styles["settings-sidebar-nav"]}>
          <div className={styles["settings-search-container"]}>
            <input className={`${ui["ui-input"]} ui-input-sm ${styles["settings-search-input"]}`} placeholder="Search Settings..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
          {filteredSections.map((section) => (
            <button
              key={section.id}
              className={`${styles["settings-sidebar-item"]} ${activeSection === section.id ? styles["settings-sidebar-item-active"] : ""}`}
              onClick={() => setActiveSection(section.id)}
            >
              <span className={styles["settings-sidebar-item-icon"]}>{section.icon}</span>
              <span className={styles["settings-sidebar-item-label"]}>{section.label}</span>
            </button>
          ))}
        </nav>

        {/* Content panel */}
        <div className={styles["settings-content-panel"]}>{renderSettingsContent()}</div>
      </div>
    </div>
  );
}
