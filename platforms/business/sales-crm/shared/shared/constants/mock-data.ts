// Sales CRM — Demo lead dataset
// Ported from intern source (src/lib/mock-data.ts). Local/mock data only —
// Sales CRM Phase 1 is a frontend workspace with no backend connection yet.

import { Lead } from "../types";

const today = new Date();
const formatDate = (date: Date) => date.toISOString().split("T")[0];
const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

// Some mock user IDs from the constants
const OWNER_PRIYA = "u-superadmin-1";
const OWNER_RAHUL = "u-admin-1";
const OWNER_SNEHA = "u-employee-1";

export const MOCK_LEADS: Lead[] = [
  {
    id: "l-1",
    leadOwner: OWNER_PRIYA,
    company: "TechNova Solutions",
    poc: "Alice Wonderland",
    designation: "CTO",
    email: "alice@technova.com",
    phone: "+1234567890",
    location: "New York, USA",
    leadStage: "Level 4(A)",
    leadSource: "LinkedIn",
    priority: "High",
    createdDate: "2026-06-15T10:00:00Z",
    lastActivityDate: "2026-07-06T07:12:00Z",
    leadScore: 85,
    tags: ["Enterprise", "Cloud"],
    customFields: { Region: "NA", Budget: "100k+" },
    gender: "Female",
    age: 35,
    customerSegment: "Enterprise B2B",
    alternateNumber: "+1987654321",
    partnerName: "Partner A",
    qualificationResult: "Qualified",
    nextFollowUpDate: "2026-07-10",
    branch: "North America",
    incomeRange: "$10M - $50M",
    activities: [
      { id: "a-1", dateTime: new Date().toISOString(), activityType: "Call", comment: "Discussed requirements", stage: "Level 4(A)", createdBy: OWNER_PRIYA }
    ],
    followups: [
      { id: "f-1", followupDate: formatDate(addDays(today, -1)), followupTime: "10:00", followupType: "Email", status: "Overdue", nextAction: "Send proposal", comment: "Waiting for details" },
      { id: "f-1-1", followupDate: formatDate(today), followupTime: "14:00", followupType: "Call", status: "Pending", nextAction: "Review proposal", comment: "Call to discuss details" }
    ],
    requirements: [
      { id: "r-1", title: "Cloud Migration", details: "AWS to GCP", priority: "High", status: "In Discussion", timeline: "Q3" }
    ],
    deals: []
  },
  {
    id: "l-2",
    leadOwner: OWNER_RAHUL,
    company: "Global Industries",
    poc: "Bob Builder",
    designation: "CEO",
    email: "bob@globalind.com",
    phone: "+1987654321",
    location: "London, UK",
    leadStage: "Level 1",
    leadSource: "Referral",
    priority: "Medium",
    createdDate: "2026-06-20T11:00:00Z",
    lastActivityDate: "2026-07-05T12:00:00Z",
    leadScore: 40,
    tags: ["Manufacturing"],
    customFields: {},
    activities: [], // No activity
    followups: [], // Needs callback date
    requirements: [],
    deals: []
  },
  {
    id: "l-3",
    leadOwner: OWNER_SNEHA,
    company: "FinTech Pros",
    poc: "Charlie Chaplin",
    designation: "CFO",
    email: "charlie@fintech.com",
    phone: "+1122334455",
    location: "San Francisco, USA",
    leadStage: "Level 6",
    leadSource: "Website",
    priority: "High",
    createdDate: "2026-06-25T09:15:00Z",
    lastActivityDate: "2026-07-06T07:12:00Z",
    leadScore: 92,
    tags: ["Fintech", "Urgent"],
    customFields: {},
    activities: [
      { id: "a-2", dateTime: new Date().toISOString(), activityType: "Meeting", comment: "Finalized terms", stage: "Level 6", createdBy: OWNER_SNEHA }
    ],
    followups: [],
    requirements: [
      { id: "r-2", title: "Payment Gateway Integration", details: "Stripe", priority: "High", status: "Deal", timeline: "Q2" }
    ],
    deals: [
      { id: "d-1", stage: "Payment Pending", value: 50000, paymentStatus: "Pending", status: "Active" }
    ]
  },
  {
    id: "l-4",
    leadOwner: OWNER_RAHUL,
    company: "HealthCare Plus",
    poc: "Diana Prince",
    designation: "Director",
    email: "diana@healthcare.com",
    phone: "+1555666777",
    location: "Toronto, Canada",
    leadStage: "Level 3",
    leadSource: "Conference",
    priority: "High",
    activities: [
      // Level 3 meeting not updated recently
      { id: "a-3", dateTime: addDays(today, -5).toISOString(), activityType: "Meeting", comment: "Initial pitch", stage: "Level 3", createdBy: OWNER_RAHUL }
    ],
    followups: [
      { id: "f-2", followupDate: formatDate(today), followupTime: "11:00", followupType: "Meeting", status: "Pending", nextAction: "Demo", comment: "" }
    ],
    requirements: [],
    deals: []
  },
  {
    id: "l-5",
    leadOwner: OWNER_PRIYA,
    company: "EduTech Stars",
    poc: "Evan Williams",
    designation: "VP Sales",
    email: "evan@edutech.com",
    phone: "+1444333222",
    location: "Austin, USA",
    leadStage: "Level 5",
    leadSource: "Email Campaign",
    priority: "Medium",
    activities: [
      { id: "a-4", dateTime: addDays(today, -1).toISOString(), activityType: "Email", comment: "Sent contract", stage: "Level 5", createdBy: OWNER_PRIYA }
    ],
    followups: [],
    requirements: [
      { id: "r-3", title: "LMS Development", details: "Custom LMS", priority: "Medium", status: "Proposal", timeline: "Q4" }
    ],
    deals: [
      { id: "d-2", stage: "Proposal Sent", value: 120000, paymentStatus: "Pending", status: "Active" }
    ]
  },
  {
    id: "l-6",
    leadOwner: OWNER_SNEHA,
    company: "Retail Giant",
    poc: "Fiona Apple",
    designation: "Manager",
    email: "fiona@retailgiant.com",
    phone: "+1666777888",
    location: "Sydney, Australia",
    leadStage: "Closed",
    leadSource: "Direct",
    priority: "Low",
    activities: [],
    followups: [],
    requirements: [],
    deals: [
      { id: "d-3", stage: "Won", value: 10000, paymentStatus: "Paid", status: "Closed" }
    ]
  },
  {
    id: "l-7",
    leadOwner: OWNER_RAHUL,
    company: "Startup Hub",
    poc: "George Clooney",
    designation: "Founder",
    email: "george@startuphub.com",
    phone: "+1999888777",
    location: "Berlin, Germany",
    leadStage: "Cold",
    leadSource: "Organic Search",
    priority: "Low",
    activities: [],
    followups: [
      { id: "f-3", followupDate: formatDate(addDays(today, 2)), followupTime: "09:00", followupType: "Call", status: "Pending", nextAction: "Follow up", comment: "" }
    ],
    requirements: [],
    deals: []
  },
  {
    id: "l-8",
    leadOwner: OWNER_PRIYA,
    company: "AutoDrive",
    poc: "Henry Ford",
    designation: "Procurement",
    email: "henry@autodrive.com",
    phone: "+1231231234",
    location: "Detroit, USA",
    leadStage: "Level 0",
    leadSource: "Trade Show",
    priority: "Medium",
    activities: [],
    followups: [],
    requirements: [],
    deals: []
  },
];
