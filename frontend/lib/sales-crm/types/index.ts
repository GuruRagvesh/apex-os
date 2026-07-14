// Sales CRM — Shared TypeScript types
// Ported from intern SalesCRM Phase 1 source (src/types/index.ts).

export enum Role {
  SUPERADMIN = "SUPERADMIN",
  ADMIN = "ADMIN",
  MANAGER = "MANAGER",
  TL = "TL",
  EMPLOYEE = "EMPLOYEE",
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarUrl?: string;
}

export interface ColumnConfig {
  id: string;
  label: string;
  visible: boolean;
  isCustom?: boolean;
  type?: "text" | "number" | "date" | "select";
  options?: string[];
}

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  description?: string;
}

export type LeadStage =
  | "Created"
  | "Cold"
  | "Level 0"
  | "Level 0(A)"
  | "Level 1"
  | "Level 1(A)"
  | "Level 2"
  | "Level 3"
  | "Level 4"
  | "Level 4(A)"
  | "Level 5"
  | "Level 6"
  | "Closed"
  | "Invalid"
  | "Hold";

export interface Activity {
  id: string;
  dateTime: string;
  activityType: string;
  comment: string;
  stage: LeadStage;
  createdBy: string;
  previousStage?: LeadStage;
  message?: string;
  followupDate?: string;
  followupTime?: string;
  followupNote?: string;
  stageDetails?: Record<string, string>;
}

export interface FollowUp {
  id: string;
  followupDate: string;
  followupTime: string;
  followupType: string;
  status: "Pending" | "Completed" | "Overdue";
  nextAction: string;
  comment: string;
  nextFollowupDate?: string;
  nextFollowupTime?: string;
  message?: string;
}

export interface Requirement {
  id: string;
  title: string;
  details: string;
  priority: "High" | "Medium" | "Low";
  status: "New Requirement" | "In Discussion" | "Fulfillment" | "Proposal" | "Deal";
  timeline: string;
  fulfillmentOwner?: string;
}

export interface Deal {
  id: string;
  stage: "Proposal Sent" | "Negotiation" | "Confirmed" | "Payment Pending" | "Won" | "Lost" | "Closed" | "Cancelled";
  value: number;
  paymentStatus: "Pending" | "Partial" | "Paid";
  status: "Active" | "Closed";
}

export interface Lead {
  id: string;
  leadOwner: string;
  company: string;
  poc: string;
  designation: string;
  email: string;
  phone: string;
  location: string;
  linkedin?: string;
  website?: string;
  leadStage: LeadStage;
  leadSource: string;
  priority: "High" | "Medium" | "Low";

  headquarters?: string;
  department?: string;
  companySize?: string;
  industry?: string;
  serviceInterest?: string;
  technologies?: string[];
  groupOwner?: string;
  initialNotes?: string;

  createdDate?: string;
  lastActivityDate?: string;
  leadScore?: number;
  tags?: string[];
  customFields?: Record<string, string>;

  gender?: string;
  age?: number;
  customerSegment?: string;
  alternateNumber?: string;
  partnerName?: string;
  qualificationResult?: string;
  nextFollowUpDate?: string;
  branch?: string;
  incomeRange?: string;
  companyId?: string;

  activities: Activity[];
  followups: FollowUp[];
  requirements: Requirement[];
  deals: Deal[];
}

export interface CompanyMaster {
  id: string;
  displayName: string;
  normalizedName: string;
  legalName?: string;
  domain?: string;
  normalizedDomain?: string;
  city?: string;
  countryCode?: string;
  source: "manual" | "clearbit" | "migrated" | "import";
  sourceReference?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}
