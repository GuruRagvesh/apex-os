// Sales CRM — Stage-specific activity form configuration
// Ported from intern source (src/app/(protected)/leads/config/stage-forms.ts)
// verbatim. Co-located with the Leads components exactly as intern had it
// route-local (config/ sibling to components/), not under lib/, since only
// ActivityTab.tsx and ActivityModal.tsx use it.

import { LeadStage } from "@apex/sales-crm-shared";

export type StageFieldType =
  | "text"
  | "textarea"
  | "select"
  | "date"
  | "time"
  | "number"
  | "owner";

export interface StageFieldConfig {
  key: string;
  label: string;
  type: StageFieldType;
  placeholder?: string;
  required?: boolean;
  min?: number;
  options?: Array<{ value: string; label: string }>;
  datePolicy?: "strict-future" | "today-or-past" | "unrestricted";
  fullWidth?: boolean;
  visibleWhen?: {
    field: string;
    equals: string;
  };
}

export interface ScheduledActionConfig {
  dateField: string;
  timeField: string;
  followupType: string;
  noteField?: string;
}

export interface StageFormConfig {
  stage: LeadStage | "Custom";
  title: string;
  description?: string;
  fields: StageFieldConfig[];
  scheduledAction?: ScheduledActionConfig;
}

// Ensure every single LeadStage + "Custom" is supported
export const STAGE_FORMS: Record<LeadStage | "Custom", StageFormConfig> = {
  "Created": {
    stage: "Created",
    title: "Created - New hot/warm lead",
    fields: [
      { key: "leadTemperature", label: "Lead Type", type: "select", options: [{value: "Hot", label: "Hot"}, {value: "Warm", label: "Warm"}], required: true },
      { key: "leadSource", label: "Lead Source", type: "text", required: true },
      { key: "firstContactOwner", label: "First Contact Owner", type: "owner", required: true },
      { key: "firstContactDueDate", label: "First Contact Due Date", type: "date", datePolicy: "strict-future", required: true },
      { key: "firstContactDueTime", label: "First Contact Due Time", type: "time", required: true }
    ],
    scheduledAction: { dateField: "firstContactDueDate", timeField: "firstContactDueTime", followupType: "Follow-up" }
  },
  "Cold": {
    stage: "Cold",
    title: "Cold - Cold lead not contacted",
    fields: [
      { key: "dataSource", label: "Data Source", type: "text", required: true },
      { key: "coldCallOwner", label: "Cold Call Owner", type: "owner", required: true },
      { key: "firstCallPlannedDate", label: "First Call Planned Date", type: "date", datePolicy: "strict-future", required: true },
      { key: "firstCallPlannedTime", label: "First Call Planned Time", type: "time", required: true }
    ],
    scheduledAction: { dateField: "firstCallPlannedDate", timeField: "firstCallPlannedTime", followupType: "Follow-up" }
  },
  "Level 0": {
    stage: "Level 0",
    title: "Level 0 - No response from hot/warm lead",
    fields: [
      { key: "callAttemptDate", label: "Call Attempt Date", type: "date", datePolicy: "today-or-past", required: true },
      { key: "callAttemptTime", label: "Call Attempt Time", type: "time", required: true },
      { key: "contactMode", label: "Contact Mode", type: "select", options: [{value: "Call", label: "Call"}, {value: "Email", label: "Email"}, {value: "SMS", label: "SMS"}, {value: "WhatsApp", label: "WhatsApp"}], required: true },
      { key: "nextRetryDate", label: "Next Retry Date", type: "date", datePolicy: "strict-future", required: true },
      { key: "nextRetryTime", label: "Next Retry Time", type: "time", required: true }
    ],
    scheduledAction: { dateField: "nextRetryDate", timeField: "nextRetryTime", followupType: "Follow-up" }
  },
  "Level 0(A)": {
    stage: "Level 0(A)",
    title: "Level 0(A) - No response from cold lead",
    fields: [
      { key: "coldCallAttemptDate", label: "Cold Call Attempt Date", type: "date", datePolicy: "today-or-past", required: true },
      { key: "coldCallAttemptTime", label: "Cold Call Attempt Time", type: "time", required: true },
      { key: "contactMode", label: "Contact Mode", type: "select", options: [{value: "Call", label: "Call"}, {value: "Email", label: "Email"}, {value: "SMS", label: "SMS"}, {value: "WhatsApp", label: "WhatsApp"}], required: true },
      { key: "nextRetryDate", label: "Next Retry Date", type: "date", datePolicy: "strict-future", required: true },
      { key: "nextRetryTime", label: "Next Retry Time", type: "time", required: true }
    ],
    scheduledAction: { dateField: "nextRetryDate", timeField: "nextRetryTime", followupType: "Follow-up" }
  },
  "Level 1": {
    stage: "Level 1",
    title: "Level 1 - Asked to call back",
    fields: [
      { key: "callbackDate", label: "Callback Date", type: "date", datePolicy: "strict-future", required: true },
      { key: "callbackTime", label: "Callback Time", type: "time", required: true },
      { key: "preferredContactMode", label: "Preferred Contact Mode", type: "select", options: [{value: "Call", label: "Call"}, {value: "Email", label: "Email"}, {value: "WhatsApp", label: "WhatsApp"}, {value: "Meeting", label: "Meeting"}], required: true },
      { key: "callbackReason", label: "Callback Reason", type: "text", required: true, fullWidth: true }
    ],
    scheduledAction: { dateField: "callbackDate", timeField: "callbackTime", followupType: "Follow-up", noteField: "callbackReason" }
  },
  "Level 1(A)": {
    stage: "Level 1(A)",
    title: "Level 1(A) - Cold lead asked to call back",
    fields: [
      { key: "callbackDate", label: "Callback Date", type: "date", datePolicy: "strict-future", required: true },
      { key: "callbackTime", label: "Callback Time", type: "time", required: true },
      { key: "preferredContactMode", label: "Preferred Contact Mode", type: "select", options: [{value: "Call", label: "Call"}, {value: "Email", label: "Email"}, {value: "WhatsApp", label: "WhatsApp"}, {value: "Meeting", label: "Meeting"}], required: true },
      { key: "callbackNote", label: "Callback Note", type: "textarea", required: true, fullWidth: true }
    ],
    scheduledAction: { dateField: "callbackDate", timeField: "callbackTime", followupType: "Follow-up", noteField: "callbackNote" }
  },
  "Level 2": {
    stage: "Level 2",
    title: "Level 2 - Product pitched, follow-up ongoing",
    fields: [
      { key: "pitchedDate", label: "Product Pitched Date", type: "date", datePolicy: "today-or-past", required: true },
      { key: "productOrService", label: "Product/Service", type: "text", required: true },
      { key: "interestLevel", label: "Interest Level", type: "select", options: [{value: "High", label: "High"}, {value: "Medium", label: "Medium"}, {value: "Low", label: "Low"}, {value: "Undecided", label: "Undecided"}], required: true },
      { key: "followupDate", label: "Follow-up Date", type: "date", datePolicy: "strict-future", required: true },
      { key: "followupTime", label: "Follow-up Time", type: "time", required: true }
    ],
    scheduledAction: { dateField: "followupDate", timeField: "followupTime", followupType: "Follow-up" }
  },
  "Level 3": {
    stage: "Level 3",
    title: "Level 3 - Meeting scheduled",
    fields: [
      { key: "meetingDate", label: "Meeting Date", type: "date", datePolicy: "strict-future", required: true },
      { key: "meetingTime", label: "Meeting Time", type: "time", required: true },
      { key: "meetingMode", label: "Meeting Mode", type: "select", options: [{value: "Online", label: "Online"}, {value: "Onsite", label: "Onsite"}, {value: "Phone", label: "Phone"}], required: true },
      { key: "meetingLinkOrLocation", label: "Meeting Link/Location", type: "text", required: true },
      { key: "meetingAgenda", label: "Meeting Agenda", type: "textarea", required: true, fullWidth: true }
    ],
    scheduledAction: { dateField: "meetingDate", timeField: "meetingTime", followupType: "Meeting", noteField: "meetingAgenda" }
  },
  "Level 4": {
    stage: "Level 4",
    title: "Level 4 - Meeting completed",
    fields: [
      { key: "meetingCompletedDate", label: "Meeting Completed Date", type: "date", datePolicy: "today-or-past", required: true },
      { key: "meetingOutcome", label: "Meeting Outcome", type: "select", options: [{value: "Positive", label: "Positive"}, {value: "Neutral", label: "Neutral"}, {value: "Negative", label: "Negative"}, {value: "Follow-up required", label: "Follow-up required"}], required: true },
      { key: "decisionMakerPresent", label: "Decision Maker Present?", type: "select", options: [{value: "Yes", label: "Yes"}, {value: "No", label: "No"}], required: true },
      { key: "nextAction", label: "Next Action", type: "text", required: true, fullWidth: true }
    ]
  },
  "Level 4(A)": {
    stage: "Level 4(A)",
    title: "Level 4(A) - Requirement received, fulfillment in progress",
    fields: [
      { key: "requirementTitle", label: "Requirement Title", type: "text", required: true, fullWidth: true },
      { key: "requirementDetails", label: "Requirement Details", type: "textarea", required: true, fullWidth: true },
      { key: "requirementPriority", label: "Requirement Priority", type: "select", options: [{value: "High", label: "High"}, {value: "Medium", label: "Medium"}, {value: "Low", label: "Low"}], required: true },
      { key: "fulfillmentOwner", label: "Fulfillment Owner", type: "owner", required: true }
    ]
  },
  "Level 5": {
    stage: "Level 5",
    title: "Level 5 - Payment received",
    fields: [
      { key: "paymentReceivedDate", label: "Payment Received Date", type: "date", datePolicy: "today-or-past", required: true },
      { key: "amountReceived", label: "Amount Received", type: "number", min: 0.01, required: true },
      { key: "paymentMode", label: "Payment Mode", type: "select", options: [{value: "Bank transfer", label: "Bank transfer"}, {value: "UPI", label: "UPI"}, {value: "Cheque", label: "Cheque"}, {value: "Card", label: "Card"}, {value: "Cash", label: "Cash"}, {value: "Other", label: "Other"}], required: true },
      { key: "invoiceOrStatusNote", label: "Invoice/Status Note", type: "text", required: false, fullWidth: true }
    ]
  },
  "Level 6": {
    stage: "Level 6",
    title: "Level 6 - Repeat requirement received",
    fields: [
      { key: "repeatRequirementTitle", label: "Repeat Requirement Title", type: "text", required: true, fullWidth: true },
      { key: "previousClientReference", label: "Previous Client Reference", type: "text", required: false, fullWidth: true },
      { key: "expectedTimeline", label: "Expected Timeline", type: "text", required: true },
      { key: "requirementDetails", label: "Requirement Details", type: "textarea", required: true, fullWidth: true }
    ]
  },
  "Closed": {
    stage: "Closed",
    title: "Closed - Not interested / wrong number",
    fields: [
      { key: "closureReason", label: "Closure Reason", type: "select", options: [{value: "Not interested", label: "Not interested"}, {value: "Wrong number", label: "Wrong number"}, {value: "Budget", label: "Budget"}, {value: "Timing", label: "Timing"}, {value: "Competitor", label: "Competitor"}, {value: "Other", label: "Other"}], required: true },
      { key: "closedDate", label: "Closed Date", type: "date", datePolicy: "today-or-past", required: true },
      { key: "canRecontact", label: "Can Re-contact?", type: "select", options: [{value: "Yes", label: "Yes"}, {value: "No", label: "No"}], required: true },
      { key: "recontactDate", label: "Re-contact Date", type: "date", datePolicy: "strict-future", required: true, visibleWhen: { field: "canRecontact", equals: "Yes" } },
      { key: "finalRemark", label: "Final Remark", type: "textarea", required: true, fullWidth: true }
    ],
    scheduledAction: { dateField: "recontactDate", timeField: "", followupType: "Follow-up", noteField: "finalRemark" }
    // Time won't be required when scheduling recontact unless we add recontactTime, we'll set default time 09:00 if absent.
  },
  "Invalid": {
    stage: "Invalid",
    title: "Invalid - Irrelevant or wrong contact",
    fields: [
      { key: "invalidReason", label: "Invalid Reason", type: "select", options: [{value: "Irrelevant contact", label: "Irrelevant contact"}, {value: "Wrong contact", label: "Wrong contact"}, {value: "Invalid number", label: "Invalid number"}, {value: "Duplicate", label: "Duplicate"}, {value: "Other", label: "Other"}], required: true },
      { key: "correctContactAvailable", label: "Correct Contact Available?", type: "select", options: [{value: "Yes", label: "Yes"}, {value: "No", label: "No"}], required: true },
      { key: "replacementContactDetails", label: "Replacement Contact Details", type: "text", required: true, visibleWhen: { field: "correctContactAvailable", equals: "Yes" }, fullWidth: true }
    ]
  },
  "Hold": {
    stage: "Hold",
    title: "Hold - Parked for future need",
    fields: [
      { key: "holdReason", label: "Hold Reason", type: "text", required: true },
      { key: "revisitDate", label: "Revisit Date", type: "date", datePolicy: "strict-future", required: true },
      { key: "revisitTime", label: "Revisit Time", type: "time", required: true },
      { key: "futureRequirementNote", label: "Future Requirement Note", type: "textarea", required: true, fullWidth: true }
    ],
    scheduledAction: { dateField: "revisitDate", timeField: "revisitTime", followupType: "Follow-up", noteField: "futureRequirementNote" }
  },
  "Custom": {
    stage: "Custom",
    title: "Custom",
    fields: [
      { key: "customActivityName", label: "Custom Activity Name", type: "text", required: true },
      { key: "customDescription", label: "Custom Description", type: "textarea", required: true, fullWidth: true }
    ]
  }
};
