"use client";

import { useState } from "react";
import { Lead, LeadStage, Activity, Role } from "@/lib/sales-crm/types";
import ActivityModal from "./ActivityModal";
import { useAuth } from "@/lib/sales-crm/auth-adapter";
import { canEditRecord, canChangeLeadOwner, isContactFieldVisible } from "@/lib/sales-crm/permissions";
import { logAction } from "@/lib/sales-crm/audit-log";
import { AuditCollection } from "@/lib/sales-crm/types/audit";
import { MOCK_USERS } from "@/lib/sales-crm/constants";
import { isSalesLeadsBackendEnabled } from "@/lib/sales-crm/api-connector";
import { salesCrmLeadsApi } from "@/lib/api";
import { Phone, Mail, MoreHorizontal, Activity as ActivityIcon, Edit3 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { getLocalTomorrowISO, isStrictFutureDate } from "../../shared/types/date-utils";
import styles from "@/styles/sales-crm/leads.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

interface LeadInfoPanelProps {
  lead: Lead;
  onUpdate: (updatedLead: Lead) => void;
  assignableUsers?: { id: string; name: string; role: Role }[];
}

export default function LeadInfoPanel({ lead, onUpdate, assignableUsers }: LeadInfoPanelProps) {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const userRole = (user?.role as Role | undefined) ?? Role.EMPLOYEE;
  const currentUserId = user?.id || "";
  const backendEnabled = isSalesLeadsBackendEnabled();
  const ownerDirectory = assignableUsers ?? MOCK_USERS;

  const canEdit = canEditRecord(userRole, lead.leadOwner, currentUserId);
  const canChangeOwner = canChangeLeadOwner(currentUserId, lead.leadOwner);
  const canViewContacts = isContactFieldVisible(userRole, lead.leadOwner, currentUserId);

  const initialAction = searchParams.get("action") === "add-activity";
  const [isActivityModalOpen, setActivityModalOpen] = useState(initialAction);
  const [pendingStage, setPendingStage] = useState<LeadStage | undefined>(undefined);
  const [pendingNoteOnly, setPendingNoteOnly] = useState(false);

  // Quick Actions Menu
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // Edit State
  const [isEditingPrimary, setIsEditingPrimary] = useState(false);
  const [isEditingSecondary, setIsEditingSecondary] = useState(false);
  const [editLead, setEditLead] = useState<Lead>(lead);
  const [primaryError, setPrimaryError] = useState("");

  // Property Filters
  const propertyGroups = ["Personal Information", "Contact Information", "Source Information", "Sales Information"];
  const [selectedGroups, setSelectedGroups] = useState<string[]>(["Personal Information"]);
  const [showGroupSelector, setShowGroupSelector] = useState(false);

  const toggleGroup = (group: string) => {
    setSelectedGroups(prev => {
      if (prev.includes(group)) {
        const next = prev.filter(g => g !== group);
        return next.length === 0 ? ["Personal Information"] : next;
      }
      return [...prev, group];
    });
  };

  const toggleAllGroups = () => {
    if (selectedGroups.length === propertyGroups.length) {
      setSelectedGroups(["Personal Information"]);
    } else {
      setSelectedGroups(propertyGroups);
    }
  };

  const reminderClass = (value: unknown) => {
    if (value === undefined || value === null) return styles["lead-field-reminder"];
    return String(value).trim() ? "" : styles["lead-field-reminder"];
  };

  const generateLocalId = (prefix: string, baseString: string) => {
    // Deterministic ID generation based on lead ID, list length, and a sanitized string
    const sanitized = baseString.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10);
    const activityCount = lead.activities ? lead.activities.length : 0;
    return `${prefix}-${lead.id}-${activityCount}-${sanitized}`;
  };

  const handleStageChangeClick = (newStage: LeadStage) => {
    if (!canEdit) return;
    setPendingStage(newStage);
    setPendingNoteOnly(false);
    setActivityModalOpen(true);
  };

  const handleSaveActivity = async (act: Activity) => {
    const isStageUpdate = Boolean(pendingStage && !pendingNoteOnly);
    const finalStage = isStageUpdate ? act.stage : lead.leadStage;
    const isStageChange = isStageUpdate && finalStage !== lead.leadStage;

    if (backendEnabled) {
      try {
        await salesCrmLeadsApi.addActivity(lead.id, {
          activityType: act.activityType,
          comment: act.comment,
          stage: isStageChange ? finalStage : undefined,
          occurredAt: act.dateTime,
          followupDate: act.followupDate,
          followupTime: act.followupTime,
          followupNote: act.followupNote,
        });
      } catch (err: any) {
        alert(err?.message || "Failed to save activity.");
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

    // Ensure deterministic ID if it was generated inside the modal with a temporary ID
    const savedActivity: Activity = {
      ...act,
      id: act.id.includes("temp") || act.id.length < 10 ? generateLocalId('a', act.comment) : act.id,
      stage: finalStage,
      previousStage: isStageChange ? lead.leadStage : undefined,
    };

    onUpdate({
      ...lead,
      leadStage: finalStage,
      activities: [savedActivity, ...lead.activities],
      followups: followup ? [followup, ...lead.followups] : lead.followups,
      nextFollowUpDate: followup ? followup.followupDate : lead.nextFollowUpDate,
      lastActivityDate: savedActivity.dateTime,
    });

    const baseLog = {
      userId: user?.id || "system",
      userName: user ? user.name : "System",
      userRole: (user?.role || "SYSTEM") as Role | "SYSTEM",
      collection: "Leads" as AuditCollection,
      entityId: lead.id,
    };

    if (isStageChange) {
      logAction({
        ...baseLog,
        action: "stage_change",
        details: `Stage changed from ${lead.leadStage} to ${finalStage}`,
        before: { leadStage: lead.leadStage },
        after: { leadStage: finalStage },
        metadata: {
          pipeline_stage: finalStage,
          stage: finalStage,
          lead_status: finalStage,
          company: lead.company,
          leadOwner: lead.leadOwner,
          department: lead.department,
          poc: lead.poc
        }
      });
    } else {
      logAction({
        ...baseLog,
        action: "activity_added",
        details: `Added ${pendingNoteOnly ? "note" : "activity"} "${act.activityType}" for ${lead.company}`,
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
    }

    setActivityModalOpen(false);
    setPendingStage(undefined);
    setPendingNoteOnly(false);
    setShowMoreMenu(false);
  };

  const generateEditActivity = (oldLead: Lead, newLead: Lead): Activity | null => {
    const changes: string[] = [];
    const keysToCheck: (keyof Lead)[] = [
      "company", "poc", "designation", "phone", "email", "location", "linkedin", "website", "leadOwner",
      "headquarters", "department", "companySize", "industry", "serviceInterest", "leadSource", "priority", "groupOwner", "initialNotes", "gender", "age", "customerSegment", "alternateNumber", "partnerName", "qualificationResult", "nextFollowUpDate", "branch", "incomeRange"
    ];

    for (const key of keysToCheck) {
      if (oldLead[key] !== newLead[key]) {
        changes.push(`${key} from "${oldLead[key] || '-'}" to "${newLead[key] || '-'}"`);
      }
    }

    if (changes.length === 0) return null;

    const comment = `User changed ${changes.join(", ")}`;
    return {
      id: generateLocalId('a-edit', comment),
      dateTime: new Date().toISOString(),
      activityType: "Custom",
      comment: comment,
      stage: newLead.leadStage,
      createdBy: "Current User"
    };
  };

  const handleSavePrimary = async () => {
    if (!canEdit) return;
    const nextFollowUpChanged = editLead.nextFollowUpDate !== lead.nextFollowUpDate;
    if (nextFollowUpChanged && editLead.nextFollowUpDate && !isStrictFutureDate(editLead.nextFollowUpDate)) {
      setPrimaryError("Next follow-up date must be after today.");
      return;
    }
    setPrimaryError("");

    if (backendEnabled) {
      try {
        if (editLead.leadOwner !== lead.leadOwner) {
          await salesCrmLeadsApi.reassignOwner(lead.id, editLead.leadOwner);
        }
        const fieldsChanged =
          editLead.company !== lead.company || editLead.poc !== lead.poc || editLead.designation !== lead.designation ||
          editLead.phone !== lead.phone || editLead.email !== lead.email || editLead.location !== lead.location ||
          editLead.leadScore !== lead.leadScore;
        if (fieldsChanged) {
          await salesCrmLeadsApi.update(lead.id, {
            company: editLead.company,
            poc: editLead.poc,
            designation: editLead.designation,
            phone: editLead.phone,
            email: editLead.email,
            location: editLead.location,
            score: editLead.leadScore,
          });
        }
      } catch (err: any) {
        setPrimaryError(err?.message || "Failed to save changes.");
        return;
      }
    }

    const act = generateEditActivity(lead, editLead);
    const updatedLead = { ...editLead };
    if (act) {
      updatedLead.activities = [act, ...updatedLead.activities];
    }

    logAction({
      userId: user?.id || "system",
      userName: user ? user.name : "System",
      userRole: (user?.role || "SYSTEM") as Role | "SYSTEM",
      action: "update",
      collection: "Leads",
      entityId: lead.id,
      details: `Updated lead primary info for ${lead.company}`,
      before: { company: lead.company, poc: lead.poc, designation: lead.designation },
      after: { company: updatedLead.company, poc: updatedLead.poc, designation: updatedLead.designation },
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
    onUpdate(updatedLead);
    setIsEditingPrimary(false);
  };

  const handleSaveSecondary = async () => {
    if (!canEdit) return;

    if (backendEnabled) {
      const fieldsChanged =
        editLead.alternateNumber !== lead.alternateNumber || editLead.linkedin !== lead.linkedin ||
        editLead.website !== lead.website || editLead.leadSource !== lead.leadSource ||
        editLead.companySize !== lead.companySize || editLead.industry !== lead.industry ||
        editLead.priority !== lead.priority || editLead.serviceInterest !== lead.serviceInterest ||
        editLead.initialNotes !== lead.initialNotes;
      if (fieldsChanged) {
        try {
          await salesCrmLeadsApi.update(lead.id, {
            alternatePhone: editLead.alternateNumber,
            linkedin: editLead.linkedin,
            website: editLead.website,
            leadSource: editLead.leadSource,
            companySize: editLead.companySize,
            industry: editLead.industry,
            priority: editLead.priority,
            serviceInterest: editLead.serviceInterest,
            initialNotes: editLead.initialNotes,
          });
        } catch (err: any) {
          alert(err?.message || "Failed to save changes.");
          return;
        }
      }
    }

    const act = generateEditActivity(lead, editLead);
    const updatedLead = { ...editLead };
    if (act) {
      updatedLead.activities = [act, ...updatedLead.activities];
    }

    logAction({
      userId: user?.id || "system",
      userName: user ? user.name : "System",
      userRole: (user?.role || "SYSTEM") as Role | "SYSTEM",
      action: "update",
      collection: "Leads",
      entityId: lead.id,
      details: `Updated lead secondary info for ${lead.company}`,
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

    onUpdate(updatedLead);
    setIsEditingSecondary(false);
  };

  const getInitials = (name: string) => name ? name.charAt(0).toUpperCase() + name.charAt(name.indexOf(' ') + 1 || 1).toUpperCase() : "?";

  const calculateAge = (createdDate?: string) => {
    if (!createdDate) return "-";
    const diff = new Date().getTime() - new Date(createdDate).getTime();
    return Math.floor(diff / (1000 * 3600 * 24)) + " Days";
  };

  return (
    <div className={styles["lead-info-panel"]}>
      {/* Identity Card (Primary) */}
      <div className={`${ui["ui-card"]} ${styles["lead-header-info"]} ${styles["lead-profile-card"]} ${styles["lead-panel-primary-border"]}`} onDoubleClick={() => { if(canEdit) setIsEditingPrimary(true); }}>
        <div className={`lead-summary-identity-row ${styles["lead-profile-identity"]}`}>
          <div className={`${styles["lead-avatar"]} ${styles["lead-panel-avatar-lg"]}`}>
            {getInitials(canViewContacts ? editLead.poc : "***")}
          </div>
          <div className={`${styles["lead-title-area"]} ${styles["lead-profile-heading"]}`}>
            {isEditingPrimary ? (
              <input className={`${ui["ui-input"]} lead-title-input`} value={editLead.company} onChange={e => setEditLead({...editLead, company: e.target.value})} />
            ) : (
              <h2 className={`${styles["lead-company"]} ${styles["lead-panel-company-title"]}`}>{editLead.company}</h2>
            )}
          </div>
        </div>

        {/* Quick Actions Row */}
        <div className={styles["lead-profile-actions"]}>
           <a href={canViewContacts && editLead.phone ? `tel:${editLead.phone}` : "#"} className={styles["lead-profile-action"]}>
              <Phone size={14} className={styles["lead-mr-2"]} /> Phone
           </a>
           <a href={canViewContacts && editLead.email ? `mailto:${editLead.email}` : "#"} className={styles["lead-profile-action"]}>
              <Mail size={14} className={styles["lead-mr-2"]} /> Email
           </a>
           <div className={styles["lead-relative"]}>
             <button className={`${styles["lead-profile-action"]} ${styles["lead-profile-action-button"]}`} onClick={() => setShowMoreMenu(!showMoreMenu)}>
                <MoreHorizontal size={14} className={styles["lead-mr-2"]} /> More
             </button>
             {showMoreMenu && (
               <div className={`${ui["ui-card"]} ${styles["lead-absolute"]} ${styles["lead-panel-more-menu"]}`}>
                 <button className={`${ui["ui-btn"]} ${ui["ui-btn-ghost"]} ${ui["ui-btn-sm"]} ${styles["lead-w-full"]} ${styles["lead-text-left"]}`} onClick={() => { setPendingNoteOnly(false); setActivityModalOpen(true); }}>
                   <ActivityIcon size={14} className={styles["lead-mr-2"]} /> Add Activity
                 </button>
                 <button className={`${ui["ui-btn"]} ${ui["ui-btn-ghost"]} ${ui["ui-btn-sm"]} ${styles["lead-w-full"]} ${styles["lead-text-left"]}`} onClick={() => { setPendingNoteOnly(true); setActivityModalOpen(true); }}>
                   <Edit3 size={14} className={styles["lead-mr-2"]} /> Add Note
                 </button>
                 <button className={`${ui["ui-btn"]} ${ui["ui-btn-ghost"]} ${ui["ui-btn-sm"]} ${styles["lead-w-full"]} ${styles["lead-text-left"]}`} onClick={() => handleStageChangeClick(editLead.leadStage)}>
                   <ActivityIcon size={14} className={styles["lead-mr-2"]} /> Change Stage
                 </button>
               </div>
             )}
           </div>
        </div>

        {/* Primary Editable details block */}
        <div className={`lead-primary-fields-block ${styles["lead-p-8"]} ${styles["lead-mt-2"]}`}>
            <div className={styles["lead-field-grid"]}>
              <div className={styles["lead-field-row"]}>
                <span className={styles["lead-field-label"]}>Stage</span>
                <select
                  className={`${ui["ui-select"]} ui-select-sm ${styles["lead-flex-1"]}`}
                  disabled={!canEdit}
                  value={editLead.leadStage}
                  onChange={e => handleStageChangeClick(e.target.value as LeadStage)}
                >
                  <option value="Created">Created</option><option value="Cold">Cold</option><option value="Level 0">Level 0</option><option value="Level 0(A)">Level 0(A)</option><option value="Level 1">Level 1</option><option value="Level 1(A)">Level 1(A)</option><option value="Level 2">Level 2</option><option value="Level 3">Level 3</option><option value="Level 4">Level 4</option><option value="Level 4(A)">Level 4(A)</option><option value="Level 5">Level 5</option><option value="Level 6">Level 6</option><option value="Closed">Closed</option><option value="Invalid">Invalid</option><option value="Hold">Hold</option>
                </select>
              </div>

              <div className={styles["lead-field-row"]}>
                <span className={styles["lead-field-label"]}>POC</span>
                {isEditingPrimary ? (
                  <input className={`${ui["ui-input"]} ui-input-sm ${styles["lead-flex-1"]}`} value={editLead.poc} onChange={e => setEditLead({...editLead, poc: e.target.value})} />
                ) : (
                  <span className={styles["lead-field-value"]}>{canViewContacts ? editLead.poc : "***"}</span>
                )}
              </div>

              <div className={styles["lead-field-row"]}>
                <span className={styles["lead-field-label"]}>Role</span>
                {isEditingPrimary ? (
                  <input className={`${ui["ui-input"]} ui-input-sm ${styles["lead-flex-1"]} ${reminderClass(editLead.designation)}`} value={editLead.designation} onChange={e => setEditLead({...editLead, designation: e.target.value})} />
                ) : (
                  <span className={`${styles["lead-field-value"]} ${canViewContacts ? reminderClass(editLead.designation) : ""}`}>{canViewContacts ? editLead.designation : "***"}</span>
                )}
              </div>

              <div className={styles["lead-field-row"]}>
                <span className={styles["lead-field-label"]}>Phone</span>
                {isEditingPrimary ? (
                  <input className={`${ui["ui-input"]} ui-input-sm ${styles["lead-flex-1"]}`} value={editLead.phone} onChange={e => setEditLead({...editLead, phone: e.target.value})} />
                ) : (
                  <span className={styles["lead-field-value"]}>{canViewContacts ? (editLead.phone || "-") : "***"}</span>
                )}
              </div>

              <div className={styles["lead-field-row"]}>
                <span className={styles["lead-field-label"]}>Email</span>
                {isEditingPrimary ? (
                  <input className={`${ui["ui-input"]} ui-input-sm ${styles["lead-flex-1"]}`} value={editLead.email} onChange={e => setEditLead({...editLead, email: e.target.value})} />
                ) : (
                  <span className={`${styles["lead-field-value"]} ${styles["lead-word-break-all"]}`}>{canViewContacts ? (editLead.email || "-") : "***"}</span>
                )}
              </div>

              <div className={styles["lead-field-row"]}>
                <span className={styles["lead-field-label"]}>Location</span>
                {isEditingPrimary ? (
                  <input className={`${ui["ui-input"]} ui-input-sm ${styles["lead-flex-1"]} ${reminderClass(editLead.location)}`} value={editLead.location} onChange={e => setEditLead({...editLead, location: e.target.value})} />
                ) : (
                  <span className={`${styles["lead-field-value"]} ${reminderClass(editLead.location)}`}>{editLead.location || "-"}</span>
                )}
              </div>

              <div className={styles["lead-field-row"]}>
                <span className={styles["lead-field-label"]}>Next FollowUp</span>
                {isEditingPrimary ? (
                  <div className={styles["lead-flex-1"]}>
                    <input className={`${ui["ui-input"]} ui-input-sm ${styles["lead-w-full"]} ${primaryError ? styles["lead-field-error-input"] : ""}`} type="date" min={getLocalTomorrowISO()} value={editLead.nextFollowUpDate || ""} onChange={e => { setEditLead({...editLead, nextFollowUpDate: e.target.value}); setPrimaryError(""); }} />
                    {primaryError && <div className={styles["lead-field-error-text"]}>{primaryError}</div>}
                  </div>
                ) : (
                  <span className={styles["lead-field-value"]}>{editLead.nextFollowUpDate || "-"}</span>
                )}
              </div>

              <div className={styles["lead-field-row"]}>
                <span className={styles["lead-field-label"]}>Lead Score</span>
                {isEditingPrimary ? (
                   <input type="number" className={`${ui["ui-input"]} ui-input-sm ${styles["lead-flex-1"]}`} value={editLead.leadScore || ""} onChange={e => setEditLead({...editLead, leadScore: parseInt(e.target.value) || undefined})} />
                ) : (
                   <span className={styles["lead-field-value"]}>{editLead.leadScore || "-"}</span>
                )}
              </div>

              <div className={styles["lead-field-row"]}>
                <span className={styles["lead-field-label"]}>Lead Age</span>
                <span className={styles["lead-field-value"]}>{calculateAge(editLead.createdDate)}</span>
              </div>

              <div className={styles["lead-field-row"]}>
                <span className={styles["lead-field-label"]}>Owner</span>
                {isEditingPrimary && canChangeOwner ? (
                  <select className={`${ui["ui-select"]} ui-select-sm ${styles["lead-flex-1"]}`} value={editLead.leadOwner} onChange={e => setEditLead({...editLead, leadOwner: e.target.value})}>
                    {ownerDirectory.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                ) : (
                  <span className={styles["lead-field-value"]}>
                    {ownerDirectory.find(u => u.id === editLead.leadOwner)?.name || editLead.leadOwner}
                    <span className={`${styles["lead-text-muted"]} ${styles["lead-text-xs"]} lead-ml-1`}>
                      ({ownerDirectory.find(u => u.id === editLead.leadOwner)?.role || "Unknown"})
                    </span>
                  </span>
                )}
              </div>
            </div>
        </div>

        {isEditingPrimary && (
          <div className={`${styles["lead-mt-3"]} lead-pt-3 lead-border-top ${styles["lead-p-8"]}`}>
             <button
               className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]} ${ui["ui-btn-sm"]} ${styles["lead-w-full"]}`}
               onClick={handleSavePrimary}
               disabled={editLead.company === lead.company && editLead.poc === lead.poc && editLead.designation === lead.designation && editLead.leadOwner === lead.leadOwner && editLead.leadStage === lead.leadStage && editLead.phone === lead.phone && editLead.email === lead.email && editLead.location === lead.location && editLead.nextFollowUpDate === lead.nextFollowUpDate && editLead.leadScore === lead.leadScore}
             >
               Save Primary Details
             </button>
          </div>
        )}
      </div>

      {/* Properties Accordion / Dropdown */}
      <div className={`${ui["ui-card"]} ${styles["lead-mt-4"]}`}>
        <div className={`${ui["ui-card-header"]} ${styles["lead-flex"]} ${styles["lead-justify-between"]} ${styles["lead-align-center"]} ${styles["lead-cursor-pointer"]}`} onClick={() => setShowGroupSelector(!showGroupSelector)}>
          <div className={`${styles["lead-flex-row"]} ${styles["lead-align-center"]}`}>
            <h3 className={`${ui["ui-card-title"]} ${styles["lead-mr-2"]}`}>Lead Properties</h3>
            <Edit3 size={14} className={styles["lead-text-muted"]} />
          </div>
          <span className={`${styles["lead-text-xs"]} ${styles["lead-text-muted"]}`}>{selectedGroups.length} Selected</span>
        </div>

        {showGroupSelector && (
          <div className={`${ui["ui-card-body"]} ${styles["lead-bg-hover"]} lead-border-bottom ${styles["lead-panel-scroll-200"]}`}>
            <div className={`${styles["lead-grid"]} ${styles["lead-panel-grid-2"]}`}>
              <label className={`${styles["lead-flex"]} ${styles["lead-align-center"]} ${styles["lead-gap-2"]} ${styles["lead-cursor-pointer"]} ${styles["lead-mb-2"]}`}>
                <input type="checkbox" checked={selectedGroups.length === propertyGroups.length} onChange={toggleAllGroups} />
                <span className={`${styles["lead-text-sm"]} ${styles["lead-font-medium"]}`}>Select All</span>
              </label>
              {propertyGroups.map(g => (
                <label key={g} className={`${styles["lead-flex"]} ${styles["lead-align-center"]} ${styles["lead-gap-2"]} ${styles["lead-cursor-pointer"]} ${styles["lead-mb-2"]}`}>
                  <input type="checkbox" checked={selectedGroups.includes(g)} onChange={() => toggleGroup(g)} />
                  <span className={styles["lead-text-sm"]}>{g}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className={ui["ui-card-body"]} onDoubleClick={() => { if(canEdit) setIsEditingSecondary(true); }}>
          {isEditingSecondary && (
            <div className={`${styles["lead-mb-4"]} ${styles["lead-flex"]} ${styles["lead-justify-end"]}`}>
               <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]} ${ui["ui-btn-sm"]}`} onClick={handleSaveSecondary}>Save Properties</button>
            </div>
          )}

          <div className={styles["lead-field-grid"]}>
            {selectedGroups.includes("Personal Information") && (
              <>
                <div className={`${styles["lead-field-row"]} ${styles["lead-mb-2"]} ${styles["lead-grid-col-full"]}`}><span className={`${styles["lead-text-xs"]} ${styles["lead-text-muted"]} ${styles["lead-font-medium"]}`}>Personal Information</span></div>
                <div className={styles["lead-field-row"]}>
                  <span className={styles["lead-field-label"]}>Gender</span>
                  {isEditingSecondary ? <input className={`${ui["ui-input"]} ${styles["lead-field-edit-sm"]}`} value={editLead.gender || ""} onChange={e => setEditLead({...editLead, gender: e.target.value})} /> : <span className={styles["lead-field-value"]}>{editLead.gender || "-"}</span>}
                </div>
              </>
            )}

            {selectedGroups.includes("Contact Information") && (
              <>
                <div className={`${styles["lead-field-row"]} ${styles["lead-mb-2"]} ${styles["lead-mt-2"]} ${styles["lead-grid-col-full"]}`}><span className={`${styles["lead-text-xs"]} ${styles["lead-text-muted"]} ${styles["lead-font-medium"]}`}>Contact Information</span></div>
                <div className={styles["lead-field-row"]}>
                  <span className={styles["lead-field-label"]}>Alternate No</span>
                  {isEditingSecondary ? <input className={`${ui["ui-input"]} ${styles["lead-field-edit-sm"]}`} value={editLead.alternateNumber || ""} onChange={e => setEditLead({...editLead, alternateNumber: e.target.value})} /> : <span className={styles["lead-field-value"]}>{canViewContacts ? (editLead.alternateNumber || "-") : "***"}</span>}
                </div>
                <div className={styles["lead-field-row"]}>
                  <span className={styles["lead-field-label"]}>LinkedIn</span>
                  {isEditingSecondary ? <input className={`${ui["ui-input"]} ${styles["lead-field-edit-sm"]} ${reminderClass(editLead.linkedin)}`} value={editLead.linkedin || ""} onChange={e => setEditLead({...editLead, linkedin: e.target.value})} /> : <span className={`${styles["lead-field-value"]} ${canViewContacts ? reminderClass(editLead.linkedin) : ""}`}>{canViewContacts ? (editLead.linkedin || "-") : "***"}</span>}
                </div>
                <div className={styles["lead-field-row"]}>
                  <span className={styles["lead-field-label"]}>Website</span>
                  {isEditingSecondary ? <input className={`${ui["ui-input"]} ${styles["lead-field-edit-sm"]} ${reminderClass(editLead.website)}`} value={editLead.website || ""} onChange={e => setEditLead({...editLead, website: e.target.value})} /> : <span className={`${styles["lead-field-value"]} ${reminderClass(editLead.website)}`}>{editLead.website || "-"}</span>}
                </div>
              </>
            )}

            {selectedGroups.includes("Source Information") && (
              <>
                <div className={`${styles["lead-field-row"]} ${styles["lead-mb-2"]} ${styles["lead-mt-2"]} ${styles["lead-grid-col-full"]}`}><span className={`${styles["lead-text-xs"]} ${styles["lead-text-muted"]} ${styles["lead-font-medium"]}`}>Source Information</span></div>
                <div className={styles["lead-field-row"]}>
                  <span className={styles["lead-field-label"]}>Lead Source</span>
                  {isEditingSecondary ? <input className={`${ui["ui-input"]} ${styles["lead-field-edit-sm"]} ${reminderClass(editLead.leadSource)}`} value={editLead.leadSource || ""} onChange={e => setEditLead({...editLead, leadSource: e.target.value})} /> : <span className={`${styles["lead-field-value"]} ${reminderClass(editLead.leadSource)}`}>{editLead.leadSource || "-"}</span>}
                </div>
                <div className={styles["lead-field-row"]}>
                  <span className={styles["lead-field-label"]}>Partner Name</span>
                  {isEditingSecondary ? <input className={`${ui["ui-input"]} ${styles["lead-field-edit-sm"]}`} value={editLead.partnerName || ""} onChange={e => setEditLead({...editLead, partnerName: e.target.value})} /> : <span className={styles["lead-field-value"]}>{editLead.partnerName || "-"}</span>}
                </div>
                <div className={styles["lead-field-row"]}>
                  <span className={styles["lead-field-label"]}>Branch</span>
                  {isEditingSecondary ? <input className={`${ui["ui-input"]} ${styles["lead-field-edit-sm"]}`} value={editLead.branch || ""} onChange={e => setEditLead({...editLead, branch: e.target.value})} /> : <span className={styles["lead-field-value"]}>{editLead.branch || "-"}</span>}
                </div>
              </>
            )}

            {selectedGroups.includes("Sales Information") && (
              <>
                <div className={`${styles["lead-field-row"]} ${styles["lead-mb-2"]} ${styles["lead-mt-2"]} ${styles["lead-grid-col-full"]}`}><span className={`${styles["lead-text-xs"]} ${styles["lead-text-muted"]} ${styles["lead-font-medium"]}`}>Sales Information</span></div>
                <div className={styles["lead-field-row"]}>
                  <span className={styles["lead-field-label"]}>Company Size</span>
                  {isEditingSecondary ? <input className={`${ui["ui-input"]} ${styles["lead-field-edit-sm"]} ${reminderClass(editLead.companySize)}`} value={editLead.companySize || ""} onChange={e => setEditLead({...editLead, companySize: e.target.value})} /> : <span className={`${styles["lead-field-value"]} ${reminderClass(editLead.companySize)}`}>{editLead.companySize || "-"}</span>}
                </div>
                <div className={styles["lead-field-row"]}>
                  <span className={styles["lead-field-label"]}>Industry</span>
                  {isEditingSecondary ? <input className={`${ui["ui-input"]} ${styles["lead-field-edit-sm"]}`} value={editLead.industry || ""} onChange={e => setEditLead({...editLead, industry: e.target.value})} /> : <span className={styles["lead-field-value"]}>{editLead.industry || "-"}</span>}
                </div>
                <div className={styles["lead-field-row"]}>
                  <span className={styles["lead-field-label"]}>Priority</span>
                  {isEditingSecondary ? <select className={`${ui["ui-select"]} ${styles["lead-field-edit-sm"]}`} value={editLead.priority} onChange={e => setEditLead({...editLead, priority: e.target.value as "High" | "Medium" | "Low"})}><option>High</option><option>Medium</option><option>Low</option></select> : <span className={styles["lead-field-value"]}>{editLead.priority}</span>}
                </div>
                <div className={styles["lead-field-row"]}>
                  <span className={styles["lead-field-label"]}>Qualification Result</span>
                  {isEditingSecondary ? <input className={`${ui["ui-input"]} ${styles["lead-field-edit-sm"]}`} value={editLead.qualificationResult || ""} onChange={e => setEditLead({...editLead, qualificationResult: e.target.value})} /> : <span className={styles["lead-field-value"]}>{editLead.qualificationResult || "-"}</span>}
                </div>
                <div className={styles["lead-field-row"]}>
                  <span className={styles["lead-field-label"]}>Service Interest</span>
                  {isEditingSecondary ? <input className={`${ui["ui-input"]} ${styles["lead-field-edit-sm"]}`} value={editLead.serviceInterest || ""} onChange={e => setEditLead({...editLead, serviceInterest: e.target.value})} /> : <span className={styles["lead-field-value"]}>{editLead.serviceInterest || "-"}</span>}
                </div>
                <div className={styles["lead-field-row"]}>
                  <span className={styles["lead-field-label"]}>Technologies</span>
                  {isEditingSecondary ? <input className={`${ui["ui-input"]} ${styles["lead-field-edit-sm"]}`} value={editLead.technologies?.join(", ") || ""} onChange={e => setEditLead({...editLead, technologies: e.target.value.split(", ")})} /> : <span className={styles["lead-field-value"]}>{editLead.technologies?.join(", ") || "-"}</span>}
                </div>
                <div className={styles["lead-field-row"]}>
                  <span className={styles["lead-field-label"]}>Group Owner</span>
                  {isEditingSecondary ? <input className={`${ui["ui-input"]} ${styles["lead-field-edit-sm"]}`} value={editLead.groupOwner || ""} onChange={e => setEditLead({...editLead, groupOwner: e.target.value})} /> : <span className={styles["lead-field-value"]}>{editLead.groupOwner || "-"}</span>}
                </div>
                <div className={styles["lead-field-row"]}>
                  <span className={styles["lead-field-label"]}>Initial Notes</span>
                  {isEditingSecondary ? <textarea className={`${ui["ui-input"]} ${styles["lead-field-edit-sm"]}`} value={editLead.initialNotes || ""} onChange={e => setEditLead({...editLead, initialNotes: e.target.value})} /> : <span className={styles["lead-field-value"]}>{editLead.initialNotes || "-"}</span>}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {isActivityModalOpen && (
        <ActivityModal
          onClose={() => { setActivityModalOpen(false); setPendingStage(undefined); setPendingNoteOnly(false); }}
          onSave={handleSaveActivity}
          initialStage={pendingStage || lead.leadStage}
          noteOnlyMode={pendingNoteOnly}
          stageChangeMode={Boolean(pendingStage)}
        />
      )}
    </div>
  );
}
