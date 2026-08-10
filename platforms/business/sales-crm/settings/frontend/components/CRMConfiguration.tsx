"use client";

// SalesCRM - CRM Configuration editor

import { useState } from "react";
import { useAuth } from "@apex/sales-crm-shared";
import { useSettingsStore } from "../lib/settings-store";
import { CRMConfig } from "../lib/types/settings";
import styles from "../styles/settings.module.css";
import ui from "@apex/sales-crm-shared/styles/primitives.module.css";

interface CollapsibleSectionProps {
  title: string;
  icon: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function CollapsibleSection({ title, icon, children, defaultOpen = false }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`${styles["settings-collapsible"]} ${open ? styles["settings-collapsible-open"] : ""}`}>
      <button className={styles["settings-collapsible-header"]} onClick={() => setOpen(!open)}>
        <span className={styles["settings-collapsible-icon"]}>{icon}</span>
        <span className={styles["settings-collapsible-title"]}>{title}</span>
        <span className={styles["settings-collapsible-arrow"]}>{open ? "Open" : "Closed"}</span>
      </button>
      {open && <div className={styles["settings-collapsible-content"]}>{children}</div>}
    </div>
  );
}

interface TagListEditorProps {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  inline?: boolean;
}

function TagListEditor({ label, values, onChange, inline = false }: TagListEditorProps) {
  const [newValue, setNewValue] = useState("");

  const addTag = () => {
    const v = newValue.trim();
    if (v && !values.includes(v)) {
      onChange([...values, v]);
      setNewValue("");
    }
  };

  const removeTag = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  return (
    <div className={`${styles["settings-tag-editor"]} ${inline ? "settings-tag-editor-inline" : ""}`}>
      {label && <label className={inline ? "ui-label-sm" : ui["ui-label"]}>{label}</label>}
      <div className={styles["settings-tag-list"]}>
        {values.map((v, i) => (
          <span key={`${v}-${i}`} className={styles["settings-tag"]}>
            {v}
            <button className={styles["settings-tag-remove"]} onClick={() => removeTag(i)}>
              X
            </button>
          </span>
        ))}
      </div>
      <div className={styles["settings-tag-input-row"]}>
        <input
          className={`${ui["ui-input"]} ${inline ? "ui-input-sm" : ""} ${styles["settings-tag-input"]}`}
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder={`Add...`}
        />
        <button className={`${ui["ui-btn"]} ${inline ? ui["ui-btn-sm"] : ""} ${ui["ui-btn-secondary"]}`} onClick={addTag}>
          +
        </button>
      </div>
    </div>
  );
}

function createConfigItemId(prefix: string, currentLength: number) {
  return `${prefix}-${currentLength + 1}`;
}

export default function CRMConfiguration() {
  const { user: authUser } = useAuth();
  const { state, updateCRMConfig } = useSettingsStore();
  const [draft, setDraft] = useState<CRMConfig>({ ...state.crmConfig });
  const [saved, setSaved] = useState(false);

  const updateDraft = (updates: Partial<CRMConfig>) => {
    setDraft((prev) => ({ ...prev, ...updates }));
    setSaved(false);
  };

  const canEdit = authUser && ["SUPERADMIN", "ADMIN"].includes(authUser.role.toUpperCase());

  const handleSave = () => {
    if (!canEdit) return;
    updateCRMConfig(draft, authUser.name, authUser.id, "Updated CRM configuration");
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const hasChanges = JSON.stringify(draft) !== JSON.stringify(state.crmConfig);

  return (
    <div className={ui["ui-card"]}>
      <div className={ui["ui-card-header"]}>
        <div>
          <h2 className={ui["ui-card-title"]}>CRM Configuration</h2>
          <p className={ui["ui-card-subtitle"]}>Configure SLA thresholds, statuses, rules, and templates</p>
        </div>
        <div className={styles["settings-header-actions"]}>
          {saved && <span className={styles["settings-save-indicator"]}>Saved</span>}
          <button className={`${ui["ui-btn"]} ${ui["ui-btn-primary"]}`} onClick={handleSave} disabled={!hasChanges || !canEdit}>
            Save Configuration
          </button>
        </div>
      </div>

      {!canEdit && <div className={`${ui["ui-notice"]} ${ui["ui-notice-warning"]}`}>You need Admin privileges to modify CRM configuration.</div>}

      <div className={styles["settings-config-sections"]}>
        {/* SLA Settings */}
        <CollapsibleSection title="SLA Settings" icon="T" defaultOpen>
          <div className={styles["settings-sla-grid"]}>
            {(
              [
                { key: "sla_profile_sharing" as const, label: "Profile Sharing SLA", unit: "hours" },
                { key: "sla_req_response" as const, label: "Requirement Response SLA", unit: "hours" },
                { key: "sla_follow_up" as const, label: "Follow-up SLA", unit: "hours" },
                { key: "sla_payment_follow_up" as const, label: "Payment Follow-up SLA", unit: "hours" },
                { key: "sla_sourcing" as const, label: "Sourcing SLA", unit: "hours" },
              ] as const
            ).map(({ key, label, unit }) => (
              <div key={key} className={styles["settings-sla-item"]}>
                <label className={ui["ui-label"]}>{label}</label>
                <div className={ui["ui-input-with-unit"]}>
                  <input type="number" className={`${ui["ui-input"]} ${ui["ui-input-number"]}`} value={draft[key]} onChange={(e) => updateDraft({ [key]: Number(e.target.value) })} min={1} />
                  <span className={ui["ui-input-unit"]}>{unit}</span>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleSection>

        {/* Status & Stage Configuration */}
        <CollapsibleSection title="Status & Stage Configuration" icon="C">
          <div className={styles["settings-config-grid"]}>
            <TagListEditor label="Lead Statuses" values={draft.lead_statuses} onChange={(v) => updateDraft({ lead_statuses: v })} />
            <TagListEditor label="Pipeline Stages" values={draft.pipeline_stages} onChange={(v) => updateDraft({ pipeline_stages: v })} />
            <TagListEditor label="Requirement Statuses" values={draft.requirement_statuses} onChange={(v) => updateDraft({ requirement_statuses: v })} />
            <TagListEditor label="Deal Statuses" values={draft.deal_statuses} onChange={(v) => updateDraft({ deal_statuses: v })} />
            <TagListEditor label="Payment Statuses" values={draft.payment_statuses} onChange={(v) => updateDraft({ payment_statuses: v })} />
            <TagListEditor label="Service Lines" values={draft.service_lines} onChange={(v) => updateDraft({ service_lines: v })} />
          </div>
        </CollapsibleSection>

        {/* Rules Engine */}
        <CollapsibleSection title="Rules Engine" icon="R">
          <div className={styles["settings-rules-section"]}>
            {/* SLA Rules */}
            <div className={styles["settings-rule-group"]}>
              <h4 className={styles["settings-rule-group-title"]}>SLA Rules</h4>
              {draft.sla_rules.map((rule, idx) => (
                <div key={rule.id} className={styles["settings-rule-card"]}>
                  <div className={styles["settings-rule-row"]}>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Name</label>
                      <input
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={rule.name}
                        onChange={(e) => {
                          const rules = [...draft.sla_rules];
                          rules[idx] = { ...rules[idx], name: e.target.value };
                          updateDraft({ sla_rules: rules });
                        }}
                      />
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Entity</label>
                      <input
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={rule.entity}
                        onChange={(e) => {
                          const rules = [...draft.sla_rules];
                          rules[idx] = { ...rules[idx], entity: e.target.value };
                          updateDraft({ sla_rules: rules });
                        }}
                      />
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Priority</label>
                      <select
                        className={`${ui["ui-select"]} ui-select-sm`}
                        value={rule.priority}
                        onChange={(e) => {
                          const rules = [...draft.sla_rules];
                          rules[idx] = { ...rules[idx], priority: e.target.value as "High" | "Medium" | "Low" };
                          updateDraft({ sla_rules: rules });
                        }}
                      >
                        <option value="High">High</option>
                        <option value="Medium">Medium</option>
                        <option value="Low">Low</option>
                      </select>
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Response Time</label>
                      <input
                        type="number"
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={rule.response_time}
                        onChange={(e) => {
                          const rules = [...draft.sla_rules];
                          rules[idx] = { ...rules[idx], response_time: Number(e.target.value) };
                          updateDraft({ sla_rules: rules });
                        }}
                      />
                    </div>
                  </div>

                  <div className={`${styles["settings-rule-row"]} ${styles["settings-mt-8"]}`}>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Start Condition</label>
                      <input
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={rule.start_condition}
                        onChange={(e) => {
                          const rules = [...draft.sla_rules];
                          rules[idx] = { ...rules[idx], start_condition: e.target.value };
                          updateDraft({ sla_rules: rules });
                        }}
                        placeholder="e.g. status='Open'"
                      />
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Stop Condition</label>
                      <input
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={rule.stop_condition}
                        onChange={(e) => {
                          const rules = [...draft.sla_rules];
                          rules[idx] = { ...rules[idx], stop_condition: e.target.value };
                          updateDraft({ sla_rules: rules });
                        }}
                        placeholder="e.g. status='Resolved'"
                      />
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Resolution Time (hrs)</label>
                      <input
                        type="number"
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={rule.resolution_time}
                        onChange={(e) => {
                          const rules = [...draft.sla_rules];
                          rules[idx] = { ...rules[idx], resolution_time: Number(e.target.value) };
                          updateDraft({ sla_rules: rules });
                        }}
                      />
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm ${styles["settings-business-hours-row"]}`}>
                      <label className={`ui-label-sm ${styles["settings-mb-0"]}`}>Business Hours</label>
                      <input
                        type="checkbox"
                        checked={rule.business_hours}
                        onChange={(e) => {
                          const rules = [...draft.sla_rules];
                          rules[idx] = { ...rules[idx], business_hours: e.target.checked, calendar_hours: !e.target.checked };
                          updateDraft({ sla_rules: rules });
                        }}
                      />
                    </div>
                  </div>

                  <div className={`${styles["settings-rule-row"]} ${styles["settings-mt-8"]}`}>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Escalation Rules</label>
                      <input
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={rule.escalation_rules}
                        onChange={(e) => {
                          const rules = [...draft.sla_rules];
                          rules[idx] = { ...rules[idx], escalation_rules: e.target.value };
                          updateDraft({ sla_rules: rules });
                        }}
                      />
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Notification Rules</label>
                      <input
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={rule.notification_rules}
                        onChange={(e) => {
                          const rules = [...draft.sla_rules];
                          rules[idx] = { ...rules[idx], notification_rules: e.target.value };
                          updateDraft({ sla_rules: rules });
                        }}
                      />
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Warning Threshold (%)</label>
                      <input
                        type="number"
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={rule.warning_threshold}
                        onChange={(e) => {
                          const rules = [...draft.sla_rules];
                          rules[idx] = { ...rules[idx], warning_threshold: Number(e.target.value) };
                          updateDraft({ sla_rules: rules });
                        }}
                      />
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Breach Threshold (%)</label>
                      <input
                        type="number"
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={rule.breach_threshold}
                        onChange={(e) => {
                          const rules = [...draft.sla_rules];
                          rules[idx] = { ...rules[idx], breach_threshold: Number(e.target.value) };
                          updateDraft({ sla_rules: rules });
                        }}
                      />
                    </div>

                    <div className={styles["settings-align-end-pb5"]}>
                      <button
                        className="ui-btn-icon ui-btn-icon-danger"
                        onClick={() => {
                          updateDraft({ sla_rules: draft.sla_rules.filter((_, i) => i !== idx) });
                        }}
                      >
                        X Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <button
                className={`${ui["ui-btn"]} ${ui["ui-btn-sm"]} ${ui["ui-btn-secondary"]}`}
                onClick={() => {
                  updateDraft({
                    sla_rules: [
                      ...draft.sla_rules,
                      {
                        id: createConfigItemId("sla", draft.sla_rules.length),
                        name: "",
                        entity: "",
                        start_condition: "",
                        stop_condition: "",
                        priority: "Medium",
                        response_time: 24,
                        resolution_time: 48,
                        business_hours: true,
                        calendar_hours: false,
                        escalation_rules: "",
                        warning_threshold: 12,
                        breach_threshold: 24,
                        notification_rules: "",
                      },
                    ],
                  });
                }}
              >
                + Add SLA Rule
              </button>
            </div>

            {/* Duplicate Rules */}
            <div className={styles["settings-rule-group"]}>
              <h4 className={styles["settings-rule-group-title"]}>Duplicate Rules</h4>
              {draft.duplicate_rules.map((rule, idx) => (
                <div key={rule.id} className={styles["settings-rule-card"]}>
                  <div className={styles["settings-rule-row"]}>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Collection</label>
                      <input
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={rule.collection}
                        onChange={(e) => {
                          const rules = [...draft.duplicate_rules];
                          rules[idx] = { ...rules[idx], collection: e.target.value };
                          updateDraft({ duplicate_rules: rules });
                        }}
                      />
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <TagListEditor
                        label="Fields"
                        inline
                        values={rule.fields}
                        onChange={(v) => {
                          const rules = [...draft.duplicate_rules];
                          rules[idx] = { ...rules[idx], fields: v };
                          updateDraft({ duplicate_rules: rules });
                        }}
                      />
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Action</label>
                      <select
                        className={`${ui["ui-select"]} ui-select-sm`}
                        value={rule.action}
                        onChange={(e) => {
                          const rules = [...draft.duplicate_rules];
                          rules[idx] = { ...rules[idx], action: e.target.value as "reject" | "flag" | "merge" };
                          updateDraft({ duplicate_rules: rules });
                        }}
                      >
                        <option value="reject">Reject</option>
                        <option value="flag">Flag</option>
                        <option value="merge">Merge</option>
                      </select>
                    </div>
                    <button
                      className="ui-btn-icon ui-btn-icon-danger"
                      onClick={() => {
                        updateDraft({ duplicate_rules: draft.duplicate_rules.filter((_, i) => i !== idx) });
                      }}
                    >
                      X
                    </button>
                  </div>
                </div>
              ))}
              <button
                className={`${ui["ui-btn"]} ${ui["ui-btn-sm"]} ${ui["ui-btn-secondary"]}`}
                onClick={() => {
                  updateDraft({
                    duplicate_rules: [...draft.duplicate_rules, { id: createConfigItemId("dr", draft.duplicate_rules.length), collection: "", fields: [], action: "reject" }],
                  });
                }}
              >
                + Add Duplicate Rule
              </button>
            </div>

            {/* Follow-up Rules */}
            <div className={styles["settings-rule-group"]}>
              <h4 className={styles["settings-rule-group-title"]}>Follow-up Rules</h4>
              {draft.follow_up_rules.map((rule, idx) => (
                <div key={rule.id} className={styles["settings-rule-card"]}>
                  <div className={styles["settings-rule-row"]}>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Name</label>
                      <input
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={rule.name}
                        onChange={(e) => {
                          const rules = [...draft.follow_up_rules];
                          rules[idx] = { ...rules[idx], name: e.target.value };
                          updateDraft({ follow_up_rules: rules });
                        }}
                      />
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Trigger</label>
                      <input
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={rule.trigger}
                        onChange={(e) => {
                          const rules = [...draft.follow_up_rules];
                          rules[idx] = { ...rules[idx], trigger: e.target.value };
                          updateDraft({ follow_up_rules: rules });
                        }}
                      />
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Interval (days)</label>
                      <input
                        type="number"
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={rule.interval_days}
                        onChange={(e) => {
                          const rules = [...draft.follow_up_rules];
                          rules[idx] = { ...rules[idx], interval_days: Number(e.target.value) };
                          updateDraft({ follow_up_rules: rules });
                        }}
                        min={1}
                      />
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Max Attempts</label>
                      <input
                        type="number"
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={rule.max_attempts}
                        onChange={(e) => {
                          const rules = [...draft.follow_up_rules];
                          rules[idx] = { ...rules[idx], max_attempts: Number(e.target.value) };
                          updateDraft({ follow_up_rules: rules });
                        }}
                        min={1}
                      />
                    </div>
                    <button
                      className="ui-btn-icon ui-btn-icon-danger"
                      onClick={() => {
                        updateDraft({ follow_up_rules: draft.follow_up_rules.filter((_, i) => i !== idx) });
                      }}
                    >
                      X
                    </button>
                  </div>
                </div>
              ))}
              <button
                className={`${ui["ui-btn"]} ${ui["ui-btn-sm"]} ${ui["ui-btn-secondary"]}`}
                onClick={() => {
                  updateDraft({
                    follow_up_rules: [...draft.follow_up_rules, { id: createConfigItemId("fur", draft.follow_up_rules.length), name: "", trigger: "", interval_days: 7, max_attempts: 3 }],
                  });
                }}
              >
                + Add Follow-up Rule
              </button>
            </div>

            {/* Notification Rules */}
            <div className={styles["settings-rule-group"]}>
              <h4 className={styles["settings-rule-group-title"]}>Notification Rules</h4>
              {draft.notification_rules.map((rule, idx) => (
                <div key={rule.id} className={styles["settings-rule-card"]}>
                  <div className={styles["settings-rule-row"]}>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Event</label>
                      <input
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={rule.event}
                        onChange={(e) => {
                          const rules = [...draft.notification_rules];
                          rules[idx] = { ...rules[idx], event: e.target.value };
                          updateDraft({ notification_rules: rules });
                        }}
                      />
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <TagListEditor
                        label="Channels"
                        inline
                        values={rule.channels}
                        onChange={(v) => {
                          const rules = [...draft.notification_rules];
                          rules[idx] = { ...rules[idx], channels: v };
                          updateDraft({ notification_rules: rules });
                        }}
                      />
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <TagListEditor
                        label="Recipients"
                        inline
                        values={rule.recipients}
                        onChange={(v) => {
                          const rules = [...draft.notification_rules];
                          rules[idx] = { ...rules[idx], recipients: v };
                          updateDraft({ notification_rules: rules });
                        }}
                      />
                    </div>
                    <button
                      className="ui-btn-icon ui-btn-icon-danger"
                      onClick={() => {
                        updateDraft({ notification_rules: draft.notification_rules.filter((_, i) => i !== idx) });
                      }}
                    >
                      X
                    </button>
                  </div>
                </div>
              ))}
              <button
                className={`${ui["ui-btn"]} ${ui["ui-btn-sm"]} ${ui["ui-btn-secondary"]}`}
                onClick={() => {
                  updateDraft({
                    notification_rules: [...draft.notification_rules, { id: createConfigItemId("nr", draft.notification_rules.length), event: "", channels: [], recipients: [] }],
                  });
                }}
              >
                + Add Notification Rule
              </button>
            </div>

            {/* Import Mappings */}
            <div className={styles["settings-rule-group"]}>
              <h4 className={styles["settings-rule-group-title"]}>Import Mappings</h4>
              {draft.import_mappings.map((mapping, idx) => (
                <div key={mapping.id} className={styles["settings-rule-card"]}>
                  <div className={styles["settings-rule-row"]}>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Source Field</label>
                      <input
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={mapping.source_field}
                        onChange={(e) => {
                          const maps = [...draft.import_mappings];
                          maps[idx] = { ...maps[idx], source_field: e.target.value };
                          updateDraft({ import_mappings: maps });
                        }}
                      />
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Target Field</label>
                      <input
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={mapping.target_field}
                        onChange={(e) => {
                          const maps = [...draft.import_mappings];
                          maps[idx] = { ...maps[idx], target_field: e.target.value };
                          updateDraft({ import_mappings: maps });
                        }}
                      />
                    </div>
                    <div className={`${ui["ui-form-group"]} ui-form-group-sm`}>
                      <label className="ui-label-sm">Collection</label>
                      <input
                        className={`${ui["ui-input"]} ui-input-sm`}
                        value={mapping.collection}
                        onChange={(e) => {
                          const maps = [...draft.import_mappings];
                          maps[idx] = { ...maps[idx], collection: e.target.value };
                          updateDraft({ import_mappings: maps });
                        }}
                      />
                    </div>
                    <button
                      className="ui-btn-icon ui-btn-icon-danger"
                      onClick={() => {
                        updateDraft({ import_mappings: draft.import_mappings.filter((_, i) => i !== idx) });
                      }}
                    >
                      X
                    </button>
                  </div>
                </div>
              ))}
              <button
                className={`${ui["ui-btn"]} ${ui["ui-btn-sm"]} ${ui["ui-btn-secondary"]}`}
                onClick={() => {
                  updateDraft({
                    import_mappings: [...draft.import_mappings, { id: createConfigItemId("im", draft.import_mappings.length), source_field: "", target_field: "", collection: "" }],
                  });
                }}
              >
                + Add Import Mapping
              </button>
            </div>
          </div>
        </CollapsibleSection>

        {/* Invoice Settings */}
        <CollapsibleSection title="Invoice Settings" icon="I">
          <div className={styles["settings-sla-grid"]}>
            <div className={styles["settings-sla-item"]}>
              <label className={ui["ui-label"]}>Invoice Prefix</label>
              <input className={ui["ui-input"]} value={draft.invoice_settings.prefix} onChange={(e) => updateDraft({ invoice_settings: { ...draft.invoice_settings, prefix: e.target.value } })} />
            </div>
            <div className={styles["settings-sla-item"]}>
              <label className={ui["ui-label"]}>Next Number</label>
              <input
                type="number"
                className={`${ui["ui-input"]} ${ui["ui-input-number"]}`}
                value={draft.invoice_settings.next_number}
                onChange={(e) => updateDraft({ invoice_settings: { ...draft.invoice_settings, next_number: Number(e.target.value) } })}
                min={1}
              />
            </div>
            <div className={styles["settings-sla-item"]}>
              <label className={ui["ui-label"]}>Tax Rate (%)</label>
              <input
                type="number"
                className={`${ui["ui-input"]} ${ui["ui-input-number"]}`}
                value={draft.invoice_settings.tax_rate}
                onChange={(e) => updateDraft({ invoice_settings: { ...draft.invoice_settings, tax_rate: Number(e.target.value) } })}
                min={0}
                max={100}
              />
            </div>
            <div className={styles["settings-sla-item"]}>
              <label className={ui["ui-label"]}>Currency</label>
              <input
                className={ui["ui-input"]}
                value={draft.invoice_settings.currency}
                onChange={(e) => updateDraft({ invoice_settings: { ...draft.invoice_settings, currency: e.target.value } })}
              />
            </div>
            <div className={styles["settings-sla-item"]}>
              <label className={ui["ui-label"]}>Payment Terms</label>
              <input
                className={ui["ui-input"]}
                value={draft.invoice_settings.payment_terms}
                onChange={(e) => updateDraft({ invoice_settings: { ...draft.invoice_settings, payment_terms: e.target.value } })}
              />
            </div>
          </div>
        </CollapsibleSection>

        {/* Templates */}
        <CollapsibleSection title="Templates" icon="F">
          <div className={styles["settings-config-grid"]}>
            <TagListEditor label="Form Templates" values={draft.form_templates} onChange={(v) => updateDraft({ form_templates: v })} />
            <TagListEditor label="Proposal Templates" values={draft.proposal_templates} onChange={(v) => updateDraft({ proposal_templates: v })} />
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
}
