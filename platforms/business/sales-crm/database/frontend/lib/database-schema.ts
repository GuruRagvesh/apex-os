
export type CollectionType =
  | "Clients"
  | "Trainers"
  | "Vendors"
  | "Service Lines"
  | "Leads Master"
  | "Service Database";

export interface DatabaseRecord {
  id?: string;
  status?: string;
  archived?: string;
  contact_type?: string;
  [key: string]: unknown;
}

export interface DuplicateResult {
  record: DatabaseRecord;
  reasons: string[];
}

export interface FieldDefinition {
  name: string;
  label: string;
  type: "text" | "email" | "number" | "textarea" | "select" | "date";
  required?: boolean;
  options?: string[]; // for select
}

export const ClientSchema: FieldDefinition[] = [
  { name: "company_name", label: "Company Name", type: "text", required: true },
  { name: "industry", label: "Industry", type: "text" },
  { name: "company_size", label: "Company Size", type: "text" },
  { name: "website", label: "Website", type: "text" },
  { name: "city", label: "City", type: "text" },
  { name: "country", label: "Country", type: "text" },
  { name: "gst", label: "GST", type: "text" },
  { name: "billing_address", label: "Billing Address", type: "textarea" },
  { name: "shipping_address", label: "Shipping Address", type: "textarea" },
  { name: "primary_contact", label: "Primary Contact", type: "text" },
  { name: "relationship_status", label: "Relationship Status", type: "select", options: ["Active", "Inactive", "Prospect"] },
  { name: "remarks", label: "Remarks", type: "textarea" },
  { name: "account_tier", label: "Account Tier", type: "select", options: ["Tier 1", "Tier 2", "Tier 3"] },
  { name: "annual_revenue", label: "Annual Revenue", type: "number" },
  { name: "owner_id", label: "Owner ID", type: "text" },
];

export const TrainerSchema: FieldDefinition[] = [
  { name: "first_name", label: "First Name", type: "text", required: true },
  { name: "last_name", label: "Last Name", type: "text", required: true },
  { name: "email", label: "Email", type: "email", required: true },
  { name: "phone", label: "Phone", type: "text" },
  { name: "linkedin", label: "LinkedIn", type: "text" },
  { name: "expertise", label: "Expertise", type: "text" },
  { name: "daily_rate", label: "Daily Rate", type: "number" },
  { name: "availability", label: "Availability", type: "text" },
  { name: "certifications", label: "Certifications", type: "textarea" },
  { name: "city", label: "City", type: "text" },
  { name: "skills", label: "Skills", type: "text" },
  { name: "experience", label: "Experience (Years)", type: "number" },
  { name: "past_clients", label: "Past Clients", type: "textarea" },
  { name: "commercial_rate", label: "Commercial Rate", type: "number" },
  { name: "mode_preference", label: "Mode Preference", type: "text" },
  { name: "travel_flexibility", label: "Travel Flexibility", type: "select", options: ["Yes", "No", "Negotiable"] },
  { name: "recording_capability", label: "Recording Capability", type: "select", options: ["Yes", "No"] },
  { name: "feedback_rating", label: "Feedback Rating (1-5)", type: "number" },
  { name: "vendor_status", label: "Vendor Status", type: "select", options: ["Independent", "Agency"] },
  { name: "vendor_id", label: "Vendor ID", type: "text" },
  { name: "documents", label: "Documents", type: "text" },
  { name: "remarks", label: "Remarks", type: "textarea" },
  { name: "owner_id", label: "Owner ID", type: "text" },
];

export const VendorSchema: FieldDefinition[] = [
  { name: "company_name", label: "Company Name", type: "text", required: true },
  { name: "services_provided", label: "Services Provided", type: "text" },
  { name: "email", label: "Email", type: "email", required: true },
  { name: "phone", label: "Phone", type: "text" },
  { name: "gst", label: "GST", type: "text" },
  { name: "website", label: "Website", type: "text" },
  { name: "point_of_contact", label: "Point of Contact", type: "text" },
  { name: "payment_terms", label: "Payment Terms", type: "text" },
  { name: "vendor_contact", label: "Vendor Contact", type: "text" },
  { name: "city", label: "City", type: "text" },
  { name: "service_area", label: "Service Area", type: "text" },
  { name: "trainer_pool_strength", label: "Trainer Pool Strength", type: "number" },
  { name: "commercial_model", label: "Commercial Model", type: "text" },
  { name: "past_work", label: "Past Work", type: "textarea" },
  { name: "reliability_rating", label: "Reliability Rating (1-5)", type: "number" },
  { name: "remarks", label: "Remarks", type: "textarea" },
  { name: "owner_id", label: "Owner ID", type: "text" },
];

export const ServiceLineSchema: FieldDefinition[] = [
  { name: "name", label: "Name", type: "text", required: true },
  { name: "category", label: "Category", type: "text" },
  { name: "service_type", label: "Service Type", type: "text" },
  { name: "technology_topic", label: "Technology Topic", type: "text" },
  { name: "description", label: "Description", type: "textarea" },
  { name: "status", label: "Status", type: "select", options: ["Active", "Inactive"] },
  { name: "remarks", label: "Remarks", type: "textarea" },
  { name: "owner_id", label: "Owner ID", type: "text" },
];

// Leads Master is not expected to be editable via this modal in this phase,
// but we include it for completeness if needed.
export const LeadMasterSchema: FieldDefinition[] = [
  { name: "company_name", label: "Company Name", type: "text", required: true },
  { name: "service_interest", label: "Service Interest", type: "text" },
  { name: "pipeline_stage", label: "Pipeline Stage", type: "text" },
  { name: "owner_id", label: "Owner ID", type: "text" },
  { name: "converted_requirement_id", label: "Converted Req ID", type: "text" },
  { name: "status", label: "Status", type: "select", options: ["Active", "Archived"] },
];

export const getSchema = (collection: CollectionType): FieldDefinition[] => {
  switch (collection) {
    case "Clients": return ClientSchema;
    case "Trainers": return TrainerSchema;
    case "Vendors": return VendorSchema;
    case "Service Database":
    case "Service Lines": return ServiceLineSchema;
    case "Leads Master": return LeadMasterSchema;
    default: return [];
  }
};
