"use client";

import { useState } from "react";
import { Role, User, logAction } from "@apex/sales-crm-shared";
import styles from "../styles/leads.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

export interface CustomTab {
  id: string;
  name: string;
  activityTypes: string[];
  stages: string[];
}

interface ActivityTabManagerProps {
  isOpen: boolean;
  onClose: () => void;
  tabs: CustomTab[];
  tabOrder: string[];
  setTabOrder: (order: string[]) => void;
  setTabs: (tabs: CustomTab[]) => void;
  defaultTabId: string;
  setDefaultTabId: (id: string) => void;
  user: User | null;
}

export default function ActivityTabManager({ isOpen, onClose, tabs, setTabs, tabOrder, setTabOrder, defaultTabId, setDefaultTabId, user }: ActivityTabManagerProps) {
  const [editingTab, setEditingTab] = useState<CustomTab | null>(null);

  const allAvailable = ["all", ...tabs.map(t => t.id)];
  let displayOrder = tabOrder.length > 0 ? [...tabOrder] : ["all", ...tabs.map(t => t.id)];
  const missing = allAvailable.filter(id => !displayOrder.includes(id));
  displayOrder = [...displayOrder, ...missing];
  displayOrder = displayOrder.filter(id => allAvailable.includes(id));

  const moveUp = (index: number) => {
    if (index === 0) return;
    const newOrder = [...displayOrder];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    setTabOrder(newOrder);
  };

  const moveDown = (index: number) => {
    if (index === displayOrder.length - 1) return;
    const newOrder = [...displayOrder];
    [newOrder[index + 1], newOrder[index]] = [newOrder[index], newOrder[index + 1]];
    setTabOrder(newOrder);
  };


  if (!isOpen) return null;

  const handleSaveTab = () => {
    if (!editingTab || !editingTab.name.trim()) return;

    let updatedTabs = [...tabs];
    const isNew = !updatedTabs.some(t => t.id === editingTab.id);

    if (isNew) {
      updatedTabs.push(editingTab);
    } else {
      updatedTabs = updatedTabs.map(t => t.id === editingTab.id ? editingTab : t);
    }

    setTabs(updatedTabs);

    logAction({
      userId: user?.id || "system",
      userName: user ? user.name : "System",
      userRole: (user?.role || "SYSTEM") as Role | "SYSTEM",
      action: isNew ? "create" : "update",
      collection: "Settings CRM Configuration", // Custom tabs are settings/config
      entityId: editingTab.id,
      details: `${isNew ? 'Created' : 'Updated'} custom activity tab: ${editingTab.name}`,
    });

    setEditingTab(null);
  };

  const handleDelete = (id: string) => {
    setTabs(tabs.filter(t => t.id !== id));
    if (defaultTabId === id) setDefaultTabId("all");
    setTabOrder(tabOrder.filter(tId => tId !== id));

    logAction({
      userId: user?.id || "system",
      userName: user ? user.name : "System",
      userRole: (user?.role || "SYSTEM") as Role | "SYSTEM",
      action: "delete",
      collection: "Settings CRM Configuration",
      entityId: id,
      details: `Deleted custom activity tab`,
    });
  };

  const startNewTab = () => {
    // Deterministic ID logic
    const nextNum = tabs.length > 0 ? Math.max(...tabs.map(t => parseInt(t.id.replace('tab-', '')) || 0)) + 1 : 1;
    setEditingTab({ id: `tab-${nextNum}`, name: "", activityTypes: [], stages: [] });
  };

  return (
    <div className={ui["ui-modal-overlay"]}>
      <div className={`${ui["ui-modal"]} ${styles["lead-modal-lg"]}`}>
        <div className={ui["ui-modal-header"]}>
          <h2 className={ui["ui-modal-title"]}>Manage Activity Tabs</h2>
          <button className={ui["ui-modal-close"]} onClick={onClose}>&times;</button>
        </div>
        <div className={ui["ui-modal-body"]}>
          {!editingTab ? (
            <>
              <div className={styles["lead-mb-4"]}>
                <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={startNewTab}>+ Create New Tab</button>
              </div>
              <table className={ui["ui-table"]}>
                <thead>
                  <tr>
                    <th>Tab Name</th>
                    <th>Default</th>
                    <th>Order</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayOrder.map((id, index) => {
                    const isAll = id === "all";
                    const t = isAll ? null : tabs.find(tab => tab.id === id);
                    if (!isAll && !t) return null;
                    const name = isAll ? "All Activities" : t?.name;

                    return (
                      <tr key={id}>
                        <td>{name}</td>
                        <td>
                          <input
                            type="radio"
                            checked={defaultTabId === id}
                            onChange={() => {
                              setDefaultTabId(id);
                              logAction({
                                userId: user?.id || "system",
                                userName: user ? user.name : "System",
                                userRole: (user?.role || "SYSTEM") as Role | "SYSTEM",
                                action: "update",
                                collection: "Settings CRM Configuration",
                                entityId: "default-tab",
                                details: `Set default activity tab to ${name}`,
                              });
                            }}
                          />
                        </td>
                        <td>
                          <button className={`${ui["ui-btn"]} ${ui["ui-btn-sm"]} ${ui["ui-btn-secondary"]}`} onClick={() => moveUp(index)} disabled={index === 0}>&uarr;</button>
                          <button className={`${ui["ui-btn"]} ${ui["ui-btn-sm"]} ${ui["ui-btn-secondary"]} ${styles["lead-ml-2"]}`} onClick={() => moveDown(index)} disabled={index === displayOrder.length - 1}>&darr;</button>
                        </td>
                        <td>
                          {!isAll && t && (
                            <>
                              <button className={`${ui["ui-btn"]} ${ui["ui-btn-sm"]} ${ui["ui-btn-secondary"]}`} onClick={() => setEditingTab(t)}>Edit</button>
                              <button className={`${ui["ui-btn"]} ${ui["ui-btn-sm"]} ui-btn-outline ${styles["lead-ml-2"]} ${styles["lead-text-error"]}`} onClick={() => handleDelete(t.id)}>Delete</button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : (
            <div className={styles["lead-flex-col"]}>
              <div>
                <label className={styles["lead-text-medium"]}>Tab Name</label>
                <input
                  className={ui["ui-input"]}
                  value={editingTab.name}
                  onChange={e => setEditingTab({...editingTab, name: e.target.value})}
                  placeholder="e.g. Call Logs"
                />
              </div>
              <div>
                <label className={styles["lead-text-medium"]}>Filter by Activity Types</label>
                <div className={`${styles["lead-flex"]} ${styles["lead-gap-3"]} ${styles["lead-activity-checkbox-group"]}`}>
                  {["Call", "Email", "Meeting", "WhatsApp", "Note"].map(type => (
                    <label key={type} className={`${styles["lead-flex"]} ${styles["lead-gap-2"]} ${styles["lead-align-center"]} ${styles["lead-checkbox-label"]}`}>
                      <input
                        type="checkbox"
                        checked={editingTab.activityTypes.includes(type)}
                        onChange={(e) => {
                          const newTypes = e.target.checked
                            ? [...editingTab.activityTypes, type]
                            : editingTab.activityTypes.filter(t => t !== type);
                          setEditingTab({...editingTab, activityTypes: newTypes});
                        }}
                      />
                      <span>{type}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className={styles["lead-text-medium"]}>Filter by Stages</label>
                <div className={`${styles["lead-flex"]} ${styles["lead-gap-3"]} ${styles["lead-activity-checkbox-group"]} ${styles["lead-activity-stages-group"]}`}>
                  {["Created", "Cold", "Level 0", "Level 0(A)", "Level 1", "Level 1(A)", "Level 2", "Level 3", "Level 4", "Level 4(A)", "Level 5", "Level 6", "Closed", "Invalid", "Hold"].map(stage => (
                    <label key={stage} className={`${styles["lead-flex"]} ${styles["lead-gap-2"]} ${styles["lead-align-center"]} ${styles["lead-checkbox-label"]}`}>
                      <input
                        type="checkbox"
                        checked={editingTab.stages.includes(stage)}
                        onChange={(e) => {
                          const newStages = e.target.checked
                            ? [...editingTab.stages, stage]
                            : editingTab.stages.filter(s => s !== stage);
                          setEditingTab({...editingTab, stages: newStages});
                        }}
                      />
                      <span>{stage}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className={`${styles["lead-flex-row"]} ${styles["lead-mt-3"]}`}>
                <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={handleSaveTab}>Save</button>
                <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={() => setEditingTab(null)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
