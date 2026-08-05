"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Lead, Activity, Role, logAction, useAuth, isSalesLeadsBackendEnabled } from "@apex/sales-crm-shared";
import { salesCrmLeadsApi } from "@apex/sales-crm-shared/api";
import ActivityTab from "./ActivityTab";
import FollowupTab from "./FollowupTab";
import RequirementTab from "./RequirementTab";
import styles from "../styles/leads.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

export default function LeadTabs({ lead, onUpdate, onBack }: { lead: Lead, onUpdate: (l: Lead) => void, onBack: () => void }) {
  const searchParams = useSearchParams();
  const queryTab = searchParams.get("tab");

  const [activeTab, setActiveTab] = useState<"Activity" | "Followup" | "Requirement">(() => {
    if (queryTab === "followup") return "Followup";
    if (queryTab === "requirement") return "Requirement";
    return "Activity";
  });
  const [prevQueryTab, setPrevQueryTab] = useState(queryTab);

  if (queryTab !== prevQueryTab) {
    setPrevQueryTab(queryTab);
    if (queryTab === "followup") setActiveTab("Followup");
    else if (queryTab === "requirement") setActiveTab("Requirement");
    else setActiveTab("Activity");
  }

  const { user } = useAuth();
  const backendEnabled = isSalesLeadsBackendEnabled();

  const handleAddActivity = async (act: Activity) => {
    if (backendEnabled) {
      try {
        await salesCrmLeadsApi.addActivity(lead.id, {
          activityType: act.activityType,
          comment: act.comment,
          occurredAt: act.dateTime,
          followupDate: act.followupDate,
          followupTime: act.followupTime,
          followupNote: act.followupNote,
        });
      } catch (err: any) {
        alert(err?.message || "Failed to add activity.");
        return;
      }
    }

    const followupIdBase = `${lead.id}-${lead.followups.length}-${act.activityType}-${act.comment}`.replace(/[^a-zA-Z0-9]/g, "").slice(0, 36);
    const followup = act.followupDate && act.followupTime ? {
      id: `f-${followupIdBase || lead.followups.length}`,
      followupDate: act.followupDate,
      followupTime: act.followupTime,
      followupType: act.activityType,
      status: "Pending" as const,
      nextAction: act.followupNote || act.comment,
      comment: act.followupNote || act.comment,
    } : undefined;

    logAction({
      userId: user?.id || "system",
      userName: user ? user.name : "System",
      userRole: (user?.role || "SYSTEM") as Role | "SYSTEM",
      action: "update",
      collection: "Leads",
      entityId: lead.id,
      details: `Added new activity: ${act.activityType}`,
      metadata: {
        pipeline_stage: lead.leadStage,
        stage: lead.leadStage,
        lead_status: lead.leadStage,
        company: lead.company,
        leadOwner: lead.leadOwner,
        department: lead.department,
        poc: lead.poc
      }
    });

    onUpdate({
      ...lead,
      activities: [act, ...lead.activities],
      followups: followup ? [followup, ...lead.followups] : lead.followups,
      nextFollowUpDate: followup ? followup.followupDate : lead.nextFollowUpDate,
      lastActivityDate: act.dateTime,
    });
  };

  return (
    <div className={`${ui["ui-card"]} ${styles["lead-tabs-panel"]} ui-flex-1`}>
      <div className={ui["ui-card-header"]}>
        <div className={ui["ui-tabs"]}>
          <div className={ui["ui-tab-list"]}>
            <button
              className={`${ui["ui-tab"]} ${activeTab === "Activity" ? ui["ui-tab-active"] : ""}`}
              onClick={() => setActiveTab("Activity")}
            >
              Activity Dashboard
            </button>
            <button
              className={`${ui["ui-tab"]} ${activeTab === "Followup" ? ui["ui-tab-active"] : ""}`}
              onClick={() => setActiveTab("Followup")}
            >
              Followup
            </button>
            <button
              className={`${ui["ui-tab"]} ${activeTab === "Requirement" ? ui["ui-tab-active"] : ""}`}
              onClick={() => setActiveTab("Requirement")}
            >
              Requirement
            </button>
          </div>
        </div>
        <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={onBack}>
          &larr; Back
        </button>
      </div>

      <div className={`${ui["ui-card-body"]} ${ui["ui-tab-panel"]} ui-flex-col`}>
        {activeTab === "Activity" && <ActivityTab activities={lead.activities} currentStage={lead.leadStage} onAddActivity={handleAddActivity} />}
        {activeTab === "Followup" && <FollowupTab lead={lead} onUpdate={onUpdate} />}
        {activeTab === "Requirement" && <RequirementTab lead={lead} onUpdate={onUpdate} />}
      </div>
    </div>
  );
}
