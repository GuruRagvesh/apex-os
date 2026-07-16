"use client";

import { useState } from "react";
import { CheckCircle, AlertCircle, CalendarClock } from "lucide-react";
import { Lead, Role } from "@/lib/sales-crm/types";
import { useAuth } from "@/lib/sales-crm/auth-adapter";
import { logAction } from "@/lib/sales-crm/audit-log";
import { getLocalTomorrowISO, isStrictFutureDate } from "@/lib/sales-crm/date-utils";
import styles from "@/styles/sales-crm/leads.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

export default function FollowupTab({ lead, onUpdate }: { lead: Lead, onUpdate: (l: Lead) => void }) {
  const { user } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [type, setType] = useState("Email");
  const [nextAction, setNextAction] = useState("");
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSave = () => {
    let hasErr = false;
    const newErr: Record<string, string> = {};
    if (!date) { newErr.date = "Date is required"; hasErr = true; }
    else if (!isStrictFutureDate(date)) { newErr.date = "Date must be in the future"; hasErr = true; }
    if (!time) { newErr.time = "Time is required"; hasErr = true; }

    if (hasErr) {
      setErrors(newErr);
      return;
    }

    const newFollowup = {
      id: `f-${lead.followups?.length || 0}-${nextAction.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10)}`,
      followupDate: date,
      followupTime: time,
      followupType: type,
      status: "Pending" as const,
      nextAction,
      comment
    };

    onUpdate({
      ...lead,
      followups: [newFollowup, ...(lead.followups || [])]
    });
    logAction({
      userId: user?.id || "system",
      userName: user ? user.name : "System",
      userRole: (user?.role || "SYSTEM") as Role | "SYSTEM",
      action: "followup_added",
      collection: "Follow-ups",
      entityId: lead.id,
      details: `Added follow-up ${type} for ${lead.company}: ${nextAction || comment}`,
      metadata: {
        lead_status: lead.leadStage,
        pipeline_stage: lead.leadStage,
        status: "Pending",
        followupType: type,
        company: lead.company,
        department: lead.department,
        poc: lead.poc,
        leadOwner: lead.leadOwner
      }
    });

    setShowForm(false);
    setDate("");
    setTime("");
    setType("Email");
    setNextAction("");
    setComment("");
    setErrors({});
  };

  const sortedFollowups = [...(lead.followups || [])].sort((a, b) => {
    const timeA = new Date(`${a.followupDate}T${a.followupTime || '00:00'}`).getTime();
    const timeB = new Date(`${b.followupDate}T${b.followupTime || '00:00'}`).getTime();
    return isNaN(timeA) || isNaN(timeB) ? 0 : timeB - timeA;
  });

  const formatGroupDate = (dateString: string) => {
    if (!dateString) return "No Date";
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const formatted = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    if (d.toDateString() === today.toDateString()) return "Today, " + formatted;
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday, " + formatted;
    if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow, " + formatted;

    return formatted;
  };

  const groupedFollowups = sortedFollowups.reduce((acc, f) => {
    const groupKey = formatGroupDate(f.followupDate);
    const group = acc.find(g => g.date === groupKey);
    if (group) {
      group.items.push(f);
    } else {
      acc.push({ date: groupKey, items: [f] });
    }
    return acc;
  }, [] as { date: string, items: typeof sortedFollowups }[]);

  const getStatusIcon = (status: string) => {
    if (status === "Completed") return <CheckCircle size={14} />;
    if (status === "Overdue") return <AlertCircle size={14} />;
    return <CalendarClock size={14} />;
  };

  const getStatusClass = (status: string) => {
    if (status === "Completed") return "success";
    if (status === "Overdue") return "danger";
    return "active";
  };

  return (
    <div>
      <div className={styles["lead-tab-header"]}>
        <h3 className={styles["lead-tab-title"]}>Follow-up tracker</h3>
        <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={() => setShowForm(true)}>
          + Add Follow-up
        </button>
      </div>

      {showForm && (
        <div className={ui["ui-modal-overlay"]}>
          <div className={ui["ui-modal"]}>
            <div className={ui["ui-modal-header"]}>
              <h3 className={ui["ui-modal-title"]}>Add Follow-up</h3>
              <button className={ui["ui-modal-close"]} onClick={() => setShowForm(false)}>X</button>
            </div>
            <div className={ui["ui-modal-body"]}>
              <div className={ui["ui-form-grid"]} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
                <div className={ui["ui-form-group"]} style={{marginBottom: 0}}>
                  <label className={ui["ui-label"]} htmlFor="followup-date">Follow-up date *</label>
                  <input id="followup-date" type="date" className={`${ui["ui-input"]} ${errors.date ? styles["lead-field-error-input"] : ''}`} min={getLocalTomorrowISO()} value={date} onChange={e => {setDate(e.target.value); setErrors(prev => ({...prev, date: ""}))}} />
                  {errors.date && <div className={styles["lead-field-error-text"]}>{errors.date}</div>}
                </div>
                <div className={ui["ui-form-group"]} style={{marginBottom: 0}}>
                  <label className={ui["ui-label"]} htmlFor="followup-time">Follow-up time *</label>
                  <input id="followup-time" type="time" className={`${ui["ui-input"]} ${errors.time ? styles["lead-field-error-input"] : ''}`} value={time} onChange={e => {setTime(e.target.value); setErrors(prev => ({...prev, time: ""}))}} />
                  {errors.time && <div className={styles["lead-field-error-text"]}>{errors.time}</div>}
                </div>
                <div className={ui["ui-form-group"]} style={{marginBottom: 0}}>
                  <label className={ui["ui-label"]} htmlFor="followup-type">Follow-up type</label>
                  <select id="followup-type" className={ui["ui-select"]} value={type} onChange={e => setType(e.target.value)}>
                    <option value="Email">Email</option>
                    <option value="Call">Call</option>
                    <option value="Meeting">Meeting</option>
                  </select>
                </div>
              </div>

              <div className={`${ui["ui-form-group"]} ui-col-span-2`}>
                <input type="text" className={ui["ui-input"]} placeholder="Next Action" value={nextAction} onChange={e => setNextAction(e.target.value)} />
              </div>
              <div className={`${ui["ui-form-group"]} ui-col-span-2`}>
                <input type="text" className={ui["ui-input"]} placeholder="Comment" value={comment} onChange={e => setComment(e.target.value)} />
              </div>
            </div>
            <div className={ui["ui-modal-footer"]}>
              <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={() => setShowForm(false)}>Cancel</button>
              <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={handleSave}>Save Follow-up</button>
            </div>
          </div>
        </div>
      )}

      {sortedFollowups.length === 0 ? (
        <div className={ui["ui-empty-state"]}>
          No follow-up activity yet.
        </div>
      ) : (
        <div className={styles["lead-timeline"]}>
          {groupedFollowups.map(group => (
            <div key={group.date} className={styles["lead-timeline-group"]}>
              <div className={styles["lead-timeline-date"]}>{group.date}</div>
              <div className={styles["lead-timeline-items"]}>
                {group.items.map(f => {
                  const statusClass = getStatusClass(f.status);

                  return (
                    <div key={f.id} className={styles["lead-timeline-item"]}>
                      <div className={`${styles["lead-timeline-marker"]} ${styles[statusClass]}`}>
                        {getStatusIcon(f.status)}
                      </div>
                      <div className={styles["lead-timeline-content"]}>
                        <div className={`${styles["lead-timeline-card"]} ${statusClass === "danger" ? styles["danger"] : ""}`}>
                          <div className={styles["lead-timeline-card-header"]}>
                            <h4 className={styles["lead-timeline-title"]}>
                              {f.followupType}
                            </h4>
                            <span className={styles["lead-timeline-time"]}>
                              {f.followupTime || ""}
                            </span>
                          </div>

                          {(f.nextAction || f.comment) && (
                            <div className={styles["lead-timeline-message"]}>
                              {f.nextAction && <strong>Action: </strong>}
                              {f.nextAction}
                              {f.nextAction && f.comment && <br />}
                              {f.comment && <strong>Notes: </strong>}
                              {f.comment}
                            </div>
                          )}

                          <div className={styles["lead-timeline-meta"]}>
                            <div className={styles["lead-timeline-meta-item"]}>
                              <span className="ui-text-muted">Status:</span>
                              <span className={statusClass === "danger" ? "ui-text-danger" : statusClass === "success" ? "ui-text-success" : ""}>
                                {f.status}
                              </span>
                            </div>
                            <div className={styles["lead-timeline-meta-item"]}>
                              <span className="ui-text-muted">Context:</span> {lead.company}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
