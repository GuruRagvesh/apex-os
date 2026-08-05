import { Lead } from "@apex/sales-crm-shared";

export interface LeadsStatsData {
  totalLeads: number;
  activeLeads: number;
  pendingFollowups: number;
  qualifiedLeads: number;
}

export const getLeadsStats = (leads: Lead[]): LeadsStatsData => {
  const totalLeads = leads.length;

  const activeLeads = leads.filter(
    (l) => l.leadStage !== "Closed" && l.leadStage !== "Invalid" && l.leadStage !== "Hold"
  ).length;

  const pendingFollowups = leads.reduce((count, lead) => {
    const hasPending = lead.followups.some(f => f.status === "Pending" || f.status === "Overdue");
    return count + (hasPending ? 1 : 0);
  }, 0);

  const qualifiedLeads = leads.filter(
    (l) =>
      l.leadStage === "Level 3" ||
      l.leadStage === "Level 4" ||
      l.leadStage === "Level 4(A)" ||
      l.leadStage === "Level 5" ||
      l.leadStage === "Level 6"
  ).length;

  return {
    totalLeads,
    activeLeads,
    pendingFollowups,
    qualifiedLeads,
  };
};

export interface LeadFilterState {
  owner: string;
  stage: string;
  source: string;
  alert?: string;
  dateFrom?: string;
}

export interface LeadSortState {
  field: "createdDate" | "lastActivityDate" | "leadScore" | "";
  direction: "asc" | "desc";
}

export const filterAndSearchLeads = (
  leads: Lead[],
  searchQuery: string,
  filters: LeadFilterState,
  sortState?: LeadSortState
): Lead[] => {
  const filtered = leads.filter((lead) => {
    // 1. Text Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const searchableText = [
        lead.company,
        lead.poc,
        lead.designation,
        lead.email,
        lead.phone,
        lead.location,
        lead.leadOwner,
        lead.leadStage,
        lead.leadSource,
        lead.serviceInterest || "",
        ...(lead.technologies || []),
        ...(lead.tags || []),
        ...(lead.customFields ? Object.values(lead.customFields) : [])
      ].join(" ").toLowerCase();

      if (!searchableText.includes(q)) return false;
    }

    // 2. Dropdown Filters
    if (filters.owner && lead.leadOwner !== filters.owner) return false;
    if (filters.stage && lead.leadStage !== filters.stage) return false;
    if (filters.source && lead.leadSource !== filters.source) return false;

    // 3. Alert / Needs Attention Filter
    if (filters.alert && lead.id !== filters.alert) return false;

    // 4. Created Date Filter
    if (filters.dateFrom && lead.createdDate) {
      if (new Date(lead.createdDate) < new Date(filters.dateFrom)) return false;
    }

    return true;
  });

  // 7. Sorting
  if (sortState && sortState.field) {
    filtered.sort((a, b) => {
      let valA = a[sortState.field as keyof Lead] as unknown as string | number | undefined;
      let valB = b[sortState.field as keyof Lead] as unknown as string | number | undefined;

      if (sortState.field === "createdDate" || sortState.field === "lastActivityDate") {
        valA = valA ? new Date(valA).getTime() : 0;
        valB = valB ? new Date(valB).getTime() : 0;
      } else {
        valA = valA || 0;
        valB = valB || 0;
      }

      if (valA < valB) return sortState.direction === "asc" ? -1 : 1;
      if (valA > valB) return sortState.direction === "asc" ? 1 : -1;
      return 0;
    });
  } else {
    // Default sort by createdDate desc
    filtered.sort((a, b) => {
      const valA = a.createdDate ? new Date(a.createdDate).getTime() : 0;
      const valB = b.createdDate ? new Date(b.createdDate).getTime() : 0;
      return valB - valA;
    });
  }

  return filtered;
};
