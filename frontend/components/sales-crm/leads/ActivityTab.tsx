"use client";

import { useState } from "react";
import { Settings, CheckCircle, ArrowRight } from "lucide-react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Activity, LeadStage, Role } from "@/lib/sales-crm/types";
import ActivityModal from "./ActivityModal";
import ActivityTabManager, { CustomTab } from "./ActivityTabManager";
import { useAuth } from "@/lib/sales-crm/auth-adapter";
import { canManageActivityTabs } from "@/lib/sales-crm/permissions";
import { STAGE_FORMS } from "./stage-forms";
import styles from "@/styles/sales-crm/leads.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

export default function ActivityTab({ activities, currentStage, onAddActivity }: { activities: Activity[], currentStage: LeadStage, onAddActivity: (act: Activity) => void }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryAction = searchParams.get("action");
  const { user } = useAuth();
  const userRole = (user?.role as Role | undefined) ?? Role.EMPLOYEE;
  const canManageTabs = canManageActivityTabs(userRole);

  const [isModalOpen, setModalOpen] = useState(queryAction === "add-activity");
  const [prevQueryAction, setPrevQueryAction] = useState(queryAction);
  const [isManagerOpen, setManagerOpen] = useState(false);


  const [tabOrder, setTabOrder] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("salescrm_activity_tab_order");
        if (stored) return JSON.parse(stored);
      } catch {}
    }
    return []; // Empty means default order: "all", then custom tabs
  });

  const [customTabs, setCustomTabs] = useState<CustomTab[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("salescrm_activity_tabs");
        if (stored) return JSON.parse(stored);
      } catch (e) {
        console.error(e);
      }
    }
    return [];
  });

  const [defaultTabId, setDefaultTabId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("salescrm_default_activity_tab") || "all";
    }
    return "all";
  });

  const [activeTabId, setActiveTabId] = useState<string>(defaultTabId);

  const handleSetTabs = (newTabs: CustomTab[]) => {
    setCustomTabs(newTabs);
    localStorage.setItem("salescrm_activity_tabs", JSON.stringify(newTabs));
  };


  const handleSetTabOrder = (newOrder: string[]) => {
    setTabOrder(newOrder);
    localStorage.setItem("salescrm_activity_tab_order", JSON.stringify(newOrder));
  };

  const handleSetDefault = (id: string) => {
    setDefaultTabId(id);
    setActiveTabId(id);
    localStorage.setItem("salescrm_default_activity_tab", id);
  };

  if (queryAction !== prevQueryAction) {
    setPrevQueryAction(queryAction);
    if (queryAction === "add-activity") {
      setModalOpen(true);
    }
  }

  const handleCloseModal = () => {
    setModalOpen(false);
    if (queryAction === "add-activity") {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("action");
      params.delete("tab");
      router.replace(`${pathname}?${params.toString()}`);
    }
  };

  const handleSaveModal = (act: Activity) => {
    onAddActivity(act);
    handleCloseModal();
  };

  // Filter activities based on active tab
  let visibleActivities = activities;
  if (activeTabId !== "all") {
    const tabDef = customTabs.find(t => t.id === activeTabId);
    if (tabDef) {
      visibleActivities = activities.filter(act => {
        const typeMatch = tabDef.activityTypes.length === 0 || tabDef.activityTypes.some(t => act.activityType.toLowerCase().includes(t.toLowerCase()));
        const stageMatch = tabDef.stages.length === 0 || tabDef.stages.some(s => act.stage.toLowerCase().includes(s.toLowerCase()));
        return typeMatch && stageMatch;
      });
    }
  }

  // Sort activities newest-first
  visibleActivities = [...visibleActivities].sort((a, b) => new Date(b.dateTime).getTime() - new Date(a.dateTime).getTime());

  const formatGroupDate = (dateString: string) => {
    const d = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const formatted = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    if (d.toDateString() === today.toDateString()) return "Today, " + formatted;
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday, " + formatted;

    return formatted;
  };

  const groupedActivities = visibleActivities.reduce((acc, act) => {
    const groupKey = formatGroupDate(act.dateTime);
    const group = acc.find(g => g.date === groupKey);
    if (group) {
      group.items.push(act);
    } else {
      acc.push({ date: groupKey, items: [act] });
    }
    return acc;
  }, [] as { date: string, items: Activity[] }[]);

  return (
    <div>
      <div className={styles["lead-tab-header"]}>
        <h3 className={styles["lead-tab-title"]}>Lead activity history</h3>
        <div className={styles["lead-flex-row"]}>
          {canManageTabs && (
            <button className={`${ui["ui-btn"]} ui-btn-outline`} onClick={() => setManagerOpen(true)}>
              <Settings size={16} /> Manage Tabs
            </button>
          )}
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={() => setModalOpen(true)}>
            + Add Activity
          </button>
        </div>
      </div>

      {customTabs.length > 0 && (
        <div className={styles["lead-tab-custom-container"]}>
          {(() => {
            const allAvailable = ["all", ...customTabs.map(t => t.id)];
            let displayOrder = tabOrder.length > 0 ? [...tabOrder] : ["all", ...customTabs.map(t => t.id)];
            // ensure any newly added tabs that aren't in tabOrder are appended
            const missing = allAvailable.filter(id => !displayOrder.includes(id));
            displayOrder = [...displayOrder, ...missing];
            // remove deleted tabs
            displayOrder = displayOrder.filter(id => allAvailable.includes(id));

            return displayOrder.map(id => {
              if (id === "all") {
                return (
                  <button key="all" className={`${styles["lead-tab-custom"]} ${activeTabId === "all" ? "active" : ""}`} onClick={() => setActiveTabId("all")}>
                    All Activities
                  </button>
                );
              }
              const t = customTabs.find(tab => tab.id === id);
              if (!t) return null;
              return (
                <button key={t.id} className={`${styles["lead-tab-custom"]} ${activeTabId === t.id ? "active" : ""}`} onClick={() => setActiveTabId(t.id)}>
                  {t.name}
                </button>
              );
            });
          })()}
        </div>
      )}

      {isModalOpen && (
        <ActivityModal
          onClose={handleCloseModal}
          onSave={handleSaveModal}
          initialStage={currentStage}
        />
      )}

      {isManagerOpen && (
        <ActivityTabManager
          isOpen={isManagerOpen}
          onClose={() => setManagerOpen(false)}
          tabs={customTabs}
          setTabs={handleSetTabs}
          tabOrder={tabOrder}
          setTabOrder={handleSetTabOrder}
          defaultTabId={defaultTabId}
          setDefaultTabId={handleSetDefault}
          user={user}
        />
      )}

      {visibleActivities.length === 0 ? (
        <div className={ui["ui-empty-state"]}>
          No activities found for this tab.
        </div>
      ) : (
        <div className={styles["lead-timeline"]}>
          {groupedActivities.map(group => (
            <div key={group.date} className={styles["lead-timeline-group"]}>
              <div className={styles["lead-timeline-date"]}>{group.date}</div>
              <div className={styles["lead-timeline-items"]}>
                {group.items.map(act => (
                  <div key={act.id} className={styles["lead-timeline-item"]}>
                    <div className={styles["lead-timeline-marker"]}>
                      <CheckCircle size={14} />
                    </div>
                    <div className={styles["lead-timeline-content"]}>
                      <div className={styles["lead-timeline-card"]}>
                        <div className={styles["lead-timeline-card-header"]}>
                          <h4 className={styles["lead-timeline-title"]}>
                            {act.activityType}
                          </h4>
                          <span className={styles["lead-timeline-time"]}>
                            {new Date(act.dateTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        {(act.comment || act.message) && (
                          <div className={styles["lead-timeline-message"]}>
                            {act.comment || act.message}
                          </div>
                        )}

                        {act.stageDetails && Object.keys(act.stageDetails).length > 0 && (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px', padding: '12px', background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-md)', margin: '8px 0', border: '1px solid var(--color-border)' }}>
                            {Object.entries(act.stageDetails).map(([key, value]) => {
                              if (!value) return null;
                              const stageConfig = STAGE_FORMS[act.stage as LeadStage | "Custom"];
                              const fieldConfig = stageConfig?.fields.find(f => f.key === key);
                              const label = fieldConfig ? fieldConfig.label : key;
                              return (
                                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 500 }}>{label}</span>
                                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>{value}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className={styles["lead-timeline-meta"]}>
                          {act.previousStage && act.previousStage !== act.stage ? (
                            <div className={styles["lead-timeline-stage-change"]}>
                              <span className={`${ui["ui-badge"]} ui-badge-neutral`}>{act.previousStage}</span>
                              <ArrowRight size={12} className="ui-text-muted" />
                              <span className={`${ui["ui-badge"]} ${ui["ui-badge-primary"]}`}>{act.stage}</span>
                            </div>
                          ) : (
                            <div className={styles["lead-timeline-meta-item"]}>
                              <span className="ui-text-muted">Stage:</span> {act.stage}
                            </div>
                          )}
                          <div className={styles["lead-timeline-meta-item"]}>
                            <span className="ui-text-muted">By:</span> {act.createdBy}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
