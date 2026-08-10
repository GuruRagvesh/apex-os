import { CollectionType, DatabaseRecord, DuplicateResult } from "./database-schema";

const normalizeStr = (str: unknown) => {
  if (!str) return "";
  return String(str).toLowerCase().trim();
};

const normalizePhone = (phone: unknown) => {
  if (!phone) return "";
  return String(phone).replace(/[\s\+\-\(\)\[\]]/g, "");
};

// Check for duplicates
export const checkDuplicate = (
  collection: CollectionType,
  record: DatabaseRecord,
  allRecords: DatabaseRecord[]
): DuplicateResult[] => {
  const duplicates: DuplicateResult[] = [];

  for (const r of allRecords) {
    // skip self
    if (record.id && r.id === record.id) continue;
    // skip archived
    if (r.archived === "Yes") continue;

    const reasons: string[] = [];

    if (collection === "Clients") {
      if (normalizeStr(record.company_name) && normalizeStr(record.company_name) === normalizeStr(r.company_name)) reasons.push("company_name");
      if (normalizeStr(record.gst) && normalizeStr(record.gst) === normalizeStr(r.gst)) reasons.push("gst");
    } else if (collection === "Trainers") {
      if (normalizeStr(record.email) && normalizeStr(record.email) === normalizeStr(r.email)) reasons.push("email");
      if (normalizePhone(record.phone) && normalizePhone(record.phone) === normalizePhone(r.phone)) reasons.push("phone");
      if (normalizeStr(record.linkedin) && normalizeStr(record.linkedin) === normalizeStr(r.linkedin)) reasons.push("linkedin");
    } else if (collection === "Vendors") {
      if (normalizeStr(record.company_name) && normalizeStr(record.company_name) === normalizeStr(r.company_name)) reasons.push("company_name");
      if (normalizeStr(record.email) && normalizeStr(record.email) === normalizeStr(r.email)) reasons.push("email");
      if (normalizeStr(record.gst) && normalizeStr(record.gst) === normalizeStr(r.gst)) reasons.push("gst");
    } else if (collection === "Service Lines" || collection === "Service Database") {
      if (normalizeStr(record.name) && normalizeStr(record.name) === normalizeStr(r.name)) reasons.push("name");
    } else if (collection === "Leads Master") {
      if (normalizeStr(record.email) && normalizeStr(record.email) === normalizeStr(r.email)) reasons.push("email");
      if (normalizePhone(record.phone) && normalizePhone(record.phone) === normalizePhone(r.phone)) reasons.push("phone");
      if (normalizeStr(record.company_name) && normalizeStr(record.company_name) === normalizeStr(r.company_name)) reasons.push("company_name");
      if (normalizeStr(record.linkedin) && normalizeStr(record.linkedin) === normalizeStr(r.linkedin)) reasons.push("linkedin");
    }

    if (reasons.length > 0) {
      duplicates.push({ record: r, reasons });
    }
  }

  return duplicates;
};

export const computeLinkedData = (collection: CollectionType): string => {
  // Mock implementations for linked data as per instructions
  switch (collection) {
    case "Clients":
      return "2 deals ($50k) | Last: 2026-06-01";
    case "Trainers":
      return "1 deal";
    case "Vendors":
      return "0 deals";
    default:
      return "None";
  }
};
