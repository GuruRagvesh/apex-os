// Sales CRM — Mock data for the Database master lists
// Ported verbatim from intern source (src/lib/database-data.ts). No imports.

export const MOCK_CLIENTS = [
  {
    id: "cl-1",
    company_name: "Acme Corp",
    industry: "Manufacturing",
    city: "New York",
    country: "USA",
    gst: "GST-ACME-001",
    status: "Active",
    archived: "No",
  }
];

export const MOCK_TRAINERS = [
  {
    id: "tr-1",
    first_name: "Bob",
    last_name: "Ross",
    skills: "React, Node.js",
    commercial_rate: 1000,
    phone: "555-0201",
    email: "bob.ross@example.com",
    linkedin: "linkedin.com/in/bobross",
    vendor_status: "Independent",
    status: "Active",
    archived: "No",
  }
];

export const MOCK_VENDORS = [
  {
    id: "ve-1",
    company_name: "Cloud Services Inc",
    vendor_contact: "Alice Wonder",
    service_area: "AWS Consulting",
    phone: "555-0301",
    email: "contact@cloudservices.inc",
    gst: "GST-CS-002",
    status: "Active",
    archived: "No",
  }
];

export const MOCK_SERVICES = [
  {
    id: "sv-1",
    name: "React Corporate Training",
    category: "Training",
    service_type: "Corporate",
    status: "Active",
    archived: "No",
  },
  {
    id: "sv-2",
    name: "AWS Cloud Migration",
    category: "Consulting",
    service_type: "Project",
    status: "Active",
    archived: "No",
  }
];

export const MOCK_LEADS_MASTER = [
  {
    id: "lm-1",
    company_name: "TechNova Solutions",
    service_interest: "React Training",
    pipeline_stage: "Level 2",
    owner_id: "u-1",
    converted_requirement_id: "",
    status: "Active",
    archived: "No",
    phone: "555-0401",
    email: "info@technova.com"
  }
];
