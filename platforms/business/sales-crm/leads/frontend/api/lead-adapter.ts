"use client";

// Sales CRM — Leads backend <-> frontend shape adapter (Phase 2.2)
//
// The backend Lead/LeadActivity/FollowUp/Requirement/Deal models (Prisma,
// backend/prisma/schema.prisma) intentionally only cover the fields listed in
// the Phase 2.1 spec. Several intern-source frontend Lead fields have no
// backend column at all (technologies, groupOwner, gender, customerSegment,
// partnerName, qualificationResult, branch, incomeRange, companyId,
// stageDetails). Those are dropped on write and come back undefined on read
// when backend mode is active — this is an accepted, honest gap, not a bug.

import { Lead, Activity, FollowUp, Requirement, Deal, LeadStage } from "@apex/sales-crm-shared";

export function mapBackendActivity(a: any, fallbackStage: LeadStage): Activity {
  return {
    id: a.id,
    dateTime: a.occurredAt,
    activityType: a.activityType,
    comment: a.comment ?? "",
    stage: (a.newStage ?? a.previousStage ?? fallbackStage) as LeadStage,
    createdBy: a.createdBy?.name ?? a.createdById,
    previousStage: a.previousStage as LeadStage | undefined,
  };
}

export function mapBackendFollowUp(f: any): FollowUp {
  return {
    id: f.id,
    followupDate: f.followupDate,
    followupTime: f.followupTime ?? "",
    followupType: f.type,
    status: (f.status ?? "Pending") as FollowUp["status"],
    nextAction: f.note ?? "",
    comment: "",
  };
}

export function mapBackendRequirement(r: any): Requirement {
  return {
    id: r.id,
    title: r.title,
    details: r.details ?? "",
    priority: (r.priority ?? "Medium") as Requirement["priority"],
    status: (r.status ?? "New Requirement") as Requirement["status"],
    timeline: r.timeline ?? "",
    fulfillmentOwner: r.owner?.name ?? r.ownerId ?? undefined,
  };
}

const CLOSED_DEAL_STAGES = new Set(["Won", "Lost", "Closed", "Cancelled"]);

export function mapBackendDeal(d: any): Deal {
  return {
    id: d.id,
    stage: d.stage as Deal["stage"],
    value: d.value ?? 0,
    paymentStatus: (d.paymentStatus ?? "Pending") as Deal["paymentStatus"],
    status: CLOSED_DEAL_STAGES.has(d.stage) ? "Closed" : "Active",
  };
}

export function mapBackendLead(l: any): Lead {
  const leadStage = (l.leadStage ?? "Created") as LeadStage;
  return {
    id: l.id,
    leadOwner: l.ownerId ?? l.owner?.id ?? "",
    company: l.company,
    poc: l.poc,
    designation: l.designation ?? "",
    email: l.email,
    phone: l.phone,
    location: l.location ?? "",
    linkedin: l.linkedin ?? undefined,
    website: l.website ?? undefined,
    leadStage,
    leadSource: l.leadSource ?? "",
    priority: (l.priority ?? "Medium") as Lead["priority"],

    headquarters: l.headquarters ?? undefined,
    department: l.department ?? undefined,
    companySize: l.companySize ?? undefined,
    industry: l.industry ?? undefined,
    serviceInterest: l.serviceInterest ?? undefined,
    initialNotes: l.initialNotes ?? undefined,

    createdDate: l.createdAt,
    lastActivityDate: l.lastActivityDate ?? undefined,
    leadScore: l.score ?? undefined,
    tags: Array.isArray(l.tags) ? l.tags : undefined,
    customFields: l.customFields ?? undefined,

    age: l.age ?? undefined,
    alternateNumber: l.alternatePhone ?? undefined,

    activities: Array.isArray(l.activities) ? l.activities.map((a: any) => mapBackendActivity(a, leadStage)) : [],
    followups: Array.isArray(l.followups) ? l.followups.map(mapBackendFollowUp) : [],
    requirements: Array.isArray(l.requirements) ? l.requirements.map(mapBackendRequirement) : [],
    deals: Array.isArray(l.deals) ? l.deals.map(mapBackendDeal) : [],
  };
}

// Extracts the backend-creatable scalar fields from a fully-constructed
// frontend Lead (as built by LeadCreate.tsx). ownerId/departmentId/id and the
// seed "Created" activity are intentionally omitted — the backend derives
// ownerId from the authenticated user and creates its own seed activity.
export function buildCreatePayload(lead: Lead) {
  return {
    company: lead.company,
    poc: lead.poc,
    email: lead.email,
    phone: lead.phone,
    alternatePhone: lead.alternateNumber || undefined,
    designation: lead.designation || undefined,
    location: lead.location || undefined,
    linkedin: lead.linkedin || undefined,
    website: lead.website || undefined,
    leadStage: lead.leadStage,
    leadSource: lead.leadSource || undefined,
    priority: lead.priority,
    headquarters: lead.headquarters || undefined,
    department: lead.department || undefined,
    companySize: lead.companySize || undefined,
    industry: lead.industry || undefined,
    serviceInterest: lead.serviceInterest || undefined,
    age: lead.age ?? undefined,
    initialNotes: lead.initialNotes || undefined,
  };
}
