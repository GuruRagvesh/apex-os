"use client";

import { useState } from "react";
import { Lead, Role } from "@/lib/sales-crm/types";
import { useAuth } from "@/lib/sales-crm/auth-adapter";
import { logAction } from "@/lib/sales-crm/audit-log";
import { isSalesLeadsBackendEnabled } from "@/lib/sales-crm/api-connector";
import { salesCrmLeadsApi } from "@/lib/api";
import styles from "@/styles/sales-crm/leads.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

export default function RequirementTab({ lead, onUpdate }: { lead: Lead, onUpdate: (l: Lead) => void }) {
  const { user } = useAuth();
  const backendEnabled = isSalesLeadsBackendEnabled();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState<"High" | "Medium" | "Low">("Medium");
  const [timeline, setTimeline] = useState("");
  const [status, setStatus] = useState<"New Requirement" | "In Discussion" | "Fulfillment" | "Proposal" | "Deal">("New Requirement");

  const handleSave = async () => {
    if (!title.trim()) return;

    if (backendEnabled) {
      try {
        await salesCrmLeadsApi.addRequirement(lead.id, { title, details, priority, status, timeline });
      } catch (err: any) {
        alert(err?.message || "Failed to add requirement.");
        return;
      }
    }

    const newRequirement = {
      id: `r-${lead.requirements?.length || 0}-${title.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10)}`,
      title,
      details,
      priority,
      status,
      timeline,
      fulfillmentOwner: user?.name || "Current User"
    };

    onUpdate({
      ...lead,
      requirements: [newRequirement, ...(lead.requirements || [])]
    });

    logAction({
      userId: user?.id || "system",
      userName: user ? user.name : "System",
      userRole: (user?.role || "SYSTEM") as Role | "SYSTEM",
      action: "requirement_added",
      collection: "Requirements",
      entityId: lead.id,
      details: `Added requirement "${title}" for ${lead.company}`,
      metadata: {
        lead_status: lead.leadStage,
        pipeline_stage: lead.leadStage,
        requirementStatus: status,
        company: lead.company,
        department: lead.department,
        poc: lead.poc,
        leadOwner: lead.leadOwner
      }
    });

    setShowForm(false);
    setTitle("");
    setDetails("");
    setTimeline("");
  };

  return (
    <div>
      <div className={styles["lead-tab-header"]}>
        <h3 className={styles["lead-tab-title"]}>Requirement records</h3>
        <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={() => setShowForm(true)}>
          + Add Requirement
        </button>
      </div>

      {showForm && (
        <div className={ui["ui-modal-overlay"]}>
          <div className={ui["ui-modal"]}>
            <div className={ui["ui-modal-header"]}>
              <h3 className={ui["ui-modal-title"]}>Add Requirement</h3>
              <button className={ui["ui-modal-close"]} onClick={() => setShowForm(false)}>X</button>
            </div>
            <div className={ui["ui-modal-body"]}>
              <div className={ui["ui-form-grid"]}>
              <input type="text" className={ui["ui-input"]} placeholder="Title" value={title} onChange={e => setTitle(e.target.value)} />
              <select className={ui["ui-select"]} value={priority} onChange={e => setPriority(e.target.value as "High" | "Medium" | "Low")}>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
              <input type="text" className={ui["ui-input"]} placeholder="Timeline (e.g. Q3)" value={timeline} onChange={e => setTimeline(e.target.value)} />
              <select className={ui["ui-select"]} value={status} onChange={e => setStatus(e.target.value as "New Requirement" | "In Discussion" | "Fulfillment" | "Proposal" | "Deal")}>
                <option value="New Requirement">New Requirement</option>
                <option value="In Discussion">In Discussion</option>
                <option value="Fulfillment">Fulfillment</option>
                <option value="Proposal">Proposal</option>
                <option value="Deal">Deal</option>
              </select>

              </div>

              <div className={`${ui["ui-form-group"]} ui-col-span-2`}>
                <input type="text" className={ui["ui-input"]} placeholder="Details" value={details} onChange={e => setDetails(e.target.value)} />
              </div>
            </div>
            <div className={ui["ui-modal-footer"]}>
              <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={() => setShowForm(false)}>Cancel</button>
              <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={handleSave}>Save Requirement</button>
            </div>
          </div>
        </div>
      )}

      {lead.requirements.length === 0 ? (
        <div className={ui["ui-empty-state"]}>
          No requirement captured yet.
        </div>
      ) : (
        <div className={styles["lead-inner-table-container"]}>
          <table className={`${ui["ui-table"]} ${styles["lead-inner-table"]}`}>
            <thead>
              <tr>
                <th>Requirement</th>
                <th>Details</th>
                <th>Timeline</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lead.requirements.map(req => (
                <tr key={req.id}>
                  <td className="ui-font-medium">{req.title}</td>
                  <td className="ui-text-muted">{req.details}</td>
                  <td>{req.timeline}</td>
                  <td>
                    <span className={`${ui["ui-badge"]} ui-bg-surface-hover`}>
                      {req.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
