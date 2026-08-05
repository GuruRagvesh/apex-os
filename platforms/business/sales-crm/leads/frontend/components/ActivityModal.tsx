"use client";

import { useState } from "react";
import { Activity, LeadStage } from "@apex/sales-crm-shared";
import { STAGE_FORMS } from "../../shared/types/stage-forms";
import { getLocalTodayISO, getLocalTomorrowISO, isStrictFutureDate, isTodayOrPastDate } from "../../shared/types/date-utils";
import styles from "@/styles/sales-crm/leads.module.css";
import ui from "@/styles/sales-crm/primitives.module.css";

const ACTIVITY_TYPES_BY_STAGE: Record<LeadStage, string[]> = {
  "Created": ["Lead Created", "Email", "SMS", "WhatsApp", "Campaign Response", "Follow-up"],
  "Cold": ["Lead Created", "Email", "SMS", "WhatsApp", "Campaign Response", "Follow-up"],
  "Level 0": ["Follow-up", "Email", "SMS", "WhatsApp", "Status Changed"],
  "Level 0(A)": ["Follow-up", "Email", "SMS", "WhatsApp", "Status Changed"],
  "Level 1": ["Follow-up", "Meeting", "Status Changed", "Lead Updated"],
  "Level 1(A)": ["Follow-up", "Meeting", "Status Changed", "Lead Updated"],
  "Level 2": ["Demo", "Follow-up", "Email", "WhatsApp", "Proposal", "Lead Updated"],
  "Level 3": ["Meeting", "Demo", "Follow-up", "Email", "WhatsApp", "Status Changed"],
  "Level 4": ["Meeting", "Proposal", "Quotation", "Deal Update", "Lead Updated"],
  "Level 4(A)": ["Proposal", "Quotation", "Deal Update", "Follow-up", "Lead Updated"],
  "Level 5": ["Deal Update", "Status Changed", "Lead Updated", "Custom"],
  "Level 6": ["Follow-up", "Meeting", "Proposal", "Quotation", "Deal Update", "Custom"],
  "Closed": ["Status Changed", "Lead Updated", "Custom"],
  "Invalid": ["Status Changed", "Lead Updated", "Owner Changed"],
  "Hold": ["Follow-up", "Status Changed", "Lead Updated", "Custom"],
};

export interface ActivityModalProps {
  onClose: () => void;
  onSave: (act: Activity) => void;
  initialStage?: LeadStage;
  noteOnlyMode?: boolean;
  stageChangeMode?: boolean;
}

export default function ActivityModal({ onClose, onSave, initialStage, noteOnlyMode, stageChangeMode }: ActivityModalProps) {
  const currentStage = initialStage || "Created";
  const [systemDateTime] = useState(() => new Date().toISOString());
  const [normalActivityType, setNormalActivityType] = useState(() => ACTIVITY_TYPES_BY_STAGE[currentStage][0]);
  const [includeFollowup, setIncludeFollowup] = useState(false);
  const [followupDate, setFollowupDate] = useState("");
  const [followupTime, setFollowupTime] = useState("");
  const [followupNote, setFollowupNote] = useState("");
  const [activityType, setActivityType] = useState<LeadStage | "Custom">(noteOnlyMode ? "Custom" : (initialStage || "Created"));
  const [comment, setComment] = useState("");

  const [stageDetails, setStageDetails] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleStageChange = (stage: LeadStage | "Custom") => {
    setActivityType(stage);
    setStageDetails({});
    setErrors({});
  };

  const handleFieldChange = (key: string, value: string) => {
    const hiddenKeys = STAGE_FORMS[activityType].fields
      .filter(field => field.visibleWhen?.field === key && field.visibleWhen.equals !== value)
      .map(field => field.key);

    setStageDetails(prev => {
      const next = { ...prev, [key]: value };
      hiddenKeys.forEach(hiddenKey => delete next[hiddenKey]);
      return next;
    });
    setErrors(prev => {
      const next = { ...prev, [key]: "" };
      hiddenKeys.forEach(hiddenKey => delete next[hiddenKey]);
      return next;
    });
  };

  // Normal activity save (non-stage change)
  const handleNormalActivitySave = () => {
    if (!comment.trim()) return;

    let hasErr = false;
    const newErr: Record<string, string> = {};
    if (includeFollowup) {
      if (!followupDate) { newErr.followupDate = "Date is required"; hasErr = true; }
      else if (!isStrictFutureDate(followupDate)) { newErr.followupDate = "Date must be in the future"; hasErr = true; }
      if (!followupTime) { newErr.followupTime = "Time is required"; hasErr = true; }
    }

    if (hasErr) {
      setErrors(newErr);
      return;
    }

    onSave({
      id: "a-temp-modal-id",
      dateTime: systemDateTime,
      activityType: normalActivityType,
      comment: comment.trim(),
      stage: currentStage,
      createdBy: "Current User",
      message: comment.trim(),
      followupDate: includeFollowup ? followupDate : undefined,
      followupTime: includeFollowup ? followupTime : undefined,
      followupNote: includeFollowup ? followupNote.trim() : undefined,
    });
  };

  const isNormalActivity = !stageChangeMode && !noteOnlyMode;
  const canSaveNormalActivity = Boolean(comment.trim());

  // Stage change save
  const handleStageSave = () => {
    if (!comment.trim()) {
      setErrors({ _comment: "Comment is required" });
      return;
    }

    const formConfig = STAGE_FORMS[activityType];
    const newErrors: Record<string, string> = {};

    let hasErrors = false;

    // Validate fields
    formConfig.fields.forEach(field => {
      // Check visibility
      if (field.visibleWhen) {
        if (stageDetails[field.visibleWhen.field] !== field.visibleWhen.equals) {
          return; // Skip validation if not visible
        }
      }

      const val = stageDetails[field.key] || "";
      if (field.required && !val.trim()) {
        newErrors[field.key] = "This field is required";
        hasErrors = true;
      } else if (val) {
        if (field.datePolicy === "strict-future" && !isStrictFutureDate(val)) {
          newErrors[field.key] = "Date must be in the future";
          hasErrors = true;
        } else if (field.datePolicy === "today-or-past" && !isTodayOrPastDate(val)) {
          newErrors[field.key] = "Date cannot be in the future";
          hasErrors = true;
        } else if (field.type === "number" && field.min !== undefined && Number(val) < field.min) {
          newErrors[field.key] = `Value must be at least ${field.min}`;
          hasErrors = true;
        }
      }
    });

    if (hasErrors) {
      setErrors(newErrors);
      return;
    }

    // Prepare followup fields if scheduledAction exists
    let fDate, fTime, fNote;
    if (formConfig.scheduledAction) {
      const action = formConfig.scheduledAction;
      fDate = stageDetails[action.dateField];
      fTime = action.timeField ? stageDetails[action.timeField] : "09:00";
      fNote = action.noteField ? stageDetails[action.noteField] : "";
    }

    onSave({
      id: "a-temp-modal-id",
      dateTime: new Date().toISOString(),
      activityType: activityType === "Custom" ? (initialStage || "Created") : activityType,
      comment: comment.trim(),
      stage: activityType === "Custom" ? (initialStage || "Created") : activityType,
      createdBy: "Current User",
      stageDetails,
      followupDate: fDate,
      followupTime: fTime,
      followupNote: fNote
    });
  };

  const systemDateLabel = new Date(systemDateTime).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  if (isNormalActivity) {
    return (
      <div className={ui["ui-modal-overlay"]}>
        <div className={`${ui["ui-modal"]} ${styles["lead-modal-lg"]}`}>
          <div className={ui["ui-modal-header"]}>
            <div>
              <h3 className={ui["ui-modal-title"]}>Add Activity</h3>
              <p className={styles["lead-modal-subtitle"]}>Activity will be saved under the lead&apos;s current stage.</p>
            </div>
            <button className={ui["ui-modal-close"]} onClick={onClose}>X</button>
          </div>
          <div className={ui["ui-modal-body"]}>
            <div className={styles["lead-activity-create-grid"]}>
              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>Current lead stage</label>
                <input className={`${ui["ui-input"]} ${styles["lead-readonly-field"]}`} value={STAGE_FORMS[currentStage].title} readOnly />
              </div>

              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>Date & time</label>
                <input className={`${ui["ui-input"]} ${styles["lead-readonly-field"]}`} value={systemDateLabel} readOnly />
              </div>

              <div className={ui["ui-form-group"]}>
                <label className={ui["ui-label"]}>Type of activity</label>
                <select
                  className={ui["ui-select"]}
                  value={normalActivityType}
                  onChange={e => setNormalActivityType(e.target.value)}
                >
                  {ACTIVITY_TYPES_BY_STAGE[currentStage].map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>

              <div className={`${ui["ui-form-group"]} ${styles["lead-activity-full-span"]}`}>
                <label className={ui["ui-label"]}>Comment *</label>
                <textarea
                  className={`${ui["ui-textarea"]} ${styles["lead-stage-comment-textarea"]}`}
                  placeholder="Add the activity note, outcome, or next action"
                  rows={4}
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                />
              </div>

              <div className={`${ui["ui-form-group"]} ${styles["lead-activity-followup-toggle"]} ${styles["lead-activity-full-span"]}`}>
                <label className={styles["lead-checkbox-row"]}>
                  <input
                    type="checkbox"
                    checked={includeFollowup}
                    onChange={e => {
                      setIncludeFollowup(e.target.checked);
                      if (!e.target.checked) {
                        setFollowupDate("");
                        setFollowupTime("");
                        setFollowupNote("");
                        setErrors({});
                      }
                    }}
                  />
                  <span>Schedule a follow-up</span>
                </label>
              </div>

              {includeFollowup && (
                <div className={`${styles["lead-activity-followup-panel"]} ${styles["lead-activity-full-span"]} ${styles["lead-activity-create-grid"]}`} style={{ gap: 'var(--space-4)', marginTop: 0 }}>
                  <div className={ui["ui-form-group"]} style={{ marginBottom: 0 }}>
                    <label className={ui["ui-label"]} htmlFor="followupDate">Follow-up date *</label>
                    <input
                      id="followupDate"
                      type="date"
                      className={`${ui["ui-input"]} ${errors.followupDate ? styles["lead-field-error-input"] : ''}`}
                      min={getLocalTomorrowISO()}
                      value={followupDate}
                      onChange={e => {
                        setFollowupDate(e.target.value);
                        setErrors(prev => ({...prev, followupDate: ""}));
                      }}
                    />
                    {errors.followupDate && <div className={styles["lead-field-error-text"]}>{errors.followupDate}</div>}
                  </div>
                  <div className={ui["ui-form-group"]} style={{ marginBottom: 0 }}>
                    <label className={ui["ui-label"]} htmlFor="followupTime">Follow-up time *</label>
                    <input
                      id="followupTime"
                      type="time"
                      className={`${ui["ui-input"]} ${errors.followupTime ? styles["lead-field-error-input"] : ''}`}
                      value={followupTime}
                      onChange={e => {
                        setFollowupTime(e.target.value);
                        setErrors(prev => ({...prev, followupTime: ""}));
                      }}
                    />
                    {errors.followupTime && <div className={styles["lead-field-error-text"]}>{errors.followupTime}</div>}
                  </div>
                  <div className={`${ui["ui-form-group"]} ${styles["lead-activity-full-span"]}`} style={{ marginBottom: 0 }}>
                    <label className={ui["ui-label"]}>Follow-up note</label>
                    <textarea
                      className={ui["ui-textarea"]}
                      placeholder="Add follow-up note"
                      rows={3}
                      value={followupNote}
                      onChange={e => setFollowupNote(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className={ui["ui-modal-footer"]}>
            <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={onClose}>Cancel</button>
            <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={handleNormalActivitySave} disabled={!canSaveNormalActivity}>
              Save Activity
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Stage change logic rendering
  const activeConfig = STAGE_FORMS[activityType];

  return (
    <div className={ui["ui-modal-overlay"]}>
      <div className={`${ui["ui-modal"]} ${styles["lead-modal-lg"]}`}>
        <div className={ui["ui-modal-header"]}>
          <h3 className={ui["ui-modal-title"]}>{noteOnlyMode ? "Add Note" : "Update Stage & Activity"}</h3>
          <button className={ui["ui-modal-close"]} onClick={onClose}>X</button>
        </div>
        <div className={ui["ui-modal-body"]}>
          <div className={styles["lead-activity-modal-grid"]}>
            {!noteOnlyMode && (
              <div className={`${ui["ui-form-group"]} ${styles["lead-activity-full-span"]}`}>
                <label className={ui["ui-label"]} htmlFor="new-stage-select">New Stage</label>
                <select id="new-stage-select" className={ui["ui-select"]} value={activityType} onChange={e => handleStageChange(e.target.value as LeadStage | "Custom")}>
                  {Object.values(STAGE_FORMS).map(conf => (
                    <option key={conf.stage} value={conf.stage}>{conf.title}</option>
                  ))}
                </select>
              </div>
            )}

            {activeConfig.fields.map(field => {
              if (field.visibleWhen) {
                if (stageDetails[field.visibleWhen.field] !== field.visibleWhen.equals) return null;
              }

              const value = stageDetails[field.key] || "";
              const err = errors[field.key];
              const spanClass = field.fullWidth ? styles["lead-activity-full-span"] : "";

              let min, max;
              if (field.datePolicy === "strict-future") min = getLocalTomorrowISO();
              if (field.datePolicy === "today-or-past") max = getLocalTodayISO();

              return (
                <div key={field.key} className={`${ui["ui-form-group"]} ${spanClass}`} style={{ marginBottom: 0 }}>
                  <label className={ui["ui-label"]} htmlFor={field.key}>{field.label} {field.required && "*"}</label>
                  {field.type === "select" ? (
                    <select
                      id={field.key}
                      className={`${ui["ui-select"]} ${err ? styles["lead-field-error-input"] : ''}`}
                      value={value}
                      onChange={e => handleFieldChange(field.key, e.target.value)}
                    >
                      <option value="">Select {field.label}</option>
                      {field.options?.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : field.type === "textarea" ? (
                    <textarea
                      id={field.key}
                      className={`${ui["ui-textarea"]} ${err ? styles["lead-field-error-input"] : ''}`}
                      placeholder={field.placeholder || field.label}
                      rows={3}
                      value={value}
                      onChange={e => handleFieldChange(field.key, e.target.value)}
                    />
                  ) : (
                    <input
                      id={field.key}
                      type={field.type === "owner" ? "text" : field.type}
                      className={`${ui["ui-input"]} ${err ? styles["lead-field-error-input"] : ''}`}
                      placeholder={field.placeholder || field.label}
                      value={value}
                      min={field.type === "number" ? field.min : min}
                      max={max}
                      onChange={e => handleFieldChange(field.key, e.target.value)}
                    />
                  )}
                  {err && <div className={styles["lead-field-error-text"]}>{err}</div>}
                </div>
              );
            })}

            <div className={`${ui["ui-form-group"]} ${styles["lead-activity-full-span"]}`} style={{ marginTop: '16px', marginBottom: 0 }}>
              <label className={ui["ui-label"]} htmlFor="stage-comment">Stage Comment *</label>
              <textarea
                id="stage-comment"
                className={`${ui["ui-textarea"]} ${styles["lead-stage-comment-textarea"]} ${errors._comment ? styles["lead-field-error-input"] : ''}`}
                placeholder="Stage Comment *"
                rows={3}
                value={comment}
                onChange={e => {
                  setComment(e.target.value);
                  setErrors(prev => ({...prev, _comment: ""}));
                }}
              />
              {errors._comment && <div className={styles["lead-field-error-text"]}>{errors._comment}</div>}
            </div>
          </div>
        </div>
        <div className={ui["ui-modal-footer"]}>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-secondary"]}`} onClick={onClose}>Cancel</button>
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={handleStageSave}>
            Save Activity
          </button>
        </div>
      </div>
    </div>
  );
}
