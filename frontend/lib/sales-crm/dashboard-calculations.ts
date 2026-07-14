import { Lead, LeadStage, Role } from "./types";
import { MOCK_LEADS } from "./mock-data";
import { isDealMoneyVisible } from "./permissions";

// This file simulates a backend service or data layer that provides dashboard metrics.
// When the backend is built, these functions will be replaced by API calls,
// but the data structures returned should remain the same.

export interface DashboardData {
  totalLeads: number;
  activeLeads: number;
  activeLeadsPercentage: number;
  requirementsCaptured: {
    total: number;
    new: number;
    inProgress: number;
    converted: number;
  };
  activeDeals: {
    count: number;
    value: number;
  };
  newLeads: number;
  conversionRate: number;
  opportunityPipeline: number;
  opportunityValue: number;
  revenue: number;
  leadFunnel: {
    groupName: string;
    count: number;
    meaning: string;
    color: string;
    isBottleneck: boolean;
  }[];
  todayActionBoard: {
    summary: {
      callsDue: number;
      followupsDue: number;
      meetingsToday: number;
      requirementsPending: number;
    };
    workList: {
      id: string;
      time: string;
      type: string;
      leadCompany: string;
      owner: string;
      action: string;
      leadId: string;
    }[];
  };
  ownerPerformance: {
    ownerId: string;
    ownerName: string;
    leads: number;
    followups: number;
    requirements: number;
    deals: number;
    risk: number; // 0 to 1 scale or count of risky items
  }[];
  needsAttention: {
    id: string;
    title: string;
    instruction: string;
    type: "warning" | "error";
    leadId: string;
  }[];
}

// Helper to filter leads. Can be used locally or eventually passed to API.
export const filterLeadsFromDashboard = (filterType: string, value: string) => {
  console.log(`Filtering leads by ${filterType}: ${value}`);
  // In a real app, this might update a context or URL search params,
  // then navigate to /leads with those params.
  if (typeof window !== 'undefined') {
    window.location.href = `/sales-crm/leads?${filterType}=${encodeURIComponent(value)}`;
  }
};

// Main function to get all dashboard data
export const getDashboardData = (
  leads: Lead[] = MOCK_LEADS,
  userRole: Role = Role.EMPLOYEE,
  currentUserId: string = "",
  dashboardMode: "personal" | "team" = "personal",
  dateRange: "today" | "week" | "month" | "all" = "all"
): DashboardData => {
  // Apply Dashboard Mode filtering
  let filteredLeads = leads;
  if (dashboardMode === "personal" && currentUserId) {
    filteredLeads = leads.filter(l => l.leadOwner === currentUserId);
  }

  // Apply Date Range filtering
  if (dateRange !== "all") {
    const now = new Date();
    filteredLeads = filteredLeads.filter(() => {
      // Mock filtering using created date. In real app, leads should have a createdAt field.
      // Here we assume a mock recent date for demonstration if missing
      const leadDate = new Date(); // fallback
      const diffTime = Math.abs(now.getTime() - leadDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (dateRange === "today") return diffDays <= 1;
      if (dateRange === "week") return diffDays <= 7;
      if (dateRange === "month") return diffDays <= 30;
      return true;
    });
  }

  return {
    totalLeads: getTotalLeads(filteredLeads),
    activeLeads: getActiveLeads(filteredLeads),
    activeLeadsPercentage: filteredLeads.length ? Math.round((getActiveLeads(filteredLeads) / filteredLeads.length) * 100) : 0,
    newLeads: Math.round(filteredLeads.length * 0.2), // Mock logic for new leads
    conversionRate: filteredLeads.length ? Math.round((filteredLeads.filter(l => l.deals.some(d => d.stage === "Won")).length / filteredLeads.length) * 100) : 0,
    opportunityPipeline: filteredLeads.reduce((acc, l) => acc + l.deals.filter(d => !["Won", "Lost", "Closed", "Cancelled"].includes(d.stage)).length, 0),
    opportunityValue: getActiveDeals(filteredLeads, userRole, currentUserId).value,
    revenue: filteredLeads.reduce((acc, l) => acc + l.deals.filter(d => d.stage === "Won").reduce((sum, d) => sum + d.value, 0), 0),
    requirementsCaptured: getRequirementsCaptured(filteredLeads),
    activeDeals: getActiveDeals(filteredLeads, userRole, currentUserId),
    leadFunnel: getLeadFunnelData(filteredLeads),
    todayActionBoard: getTodayActionBoard(filteredLeads),
    ownerPerformance: getOwnerPerformance(filteredLeads),
    needsAttention: getNeedsAttention(filteredLeads),
  };
};

export const refreshDashboard = async (): Promise<DashboardData> => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 800));
  return getDashboardData();
};

function getTotalLeads(leads: Lead[]) {
  return leads.length;
}

function getActiveLeads(leads: Lead[]) {
  const inactiveStages: LeadStage[] = ["Closed", "Invalid", "Hold"];
  return leads.filter(l => !inactiveStages.includes(l.leadStage)).length;
}

function getRequirementsCaptured(leads: Lead[]) {
  const requirementLeads = leads.filter(l => l.requirements.length > 0 || l.leadStage === "Level 4(A)");
  let newReqs = 0;
  let inProgressReqs = 0;
  let convertedReqs = 0;

  requirementLeads.forEach(l => {
    l.requirements.forEach(r => {
      if (r.status === "New Requirement") newReqs++;
      else if (r.status === "Deal") convertedReqs++;
      else inProgressReqs++;
    });
  });

  return {
    total: requirementLeads.length,
    new: newReqs,
    inProgress: inProgressReqs,
    converted: convertedReqs
  };
}

function getActiveDeals(leads: Lead[], userRole: Role, currentUserId: string) {
  let count = 0;
  let value = 0;
  leads.forEach(l => {
    l.deals.forEach(d => {
      if (!["Won", "Lost", "Closed", "Cancelled"].includes(d.stage)) {
        count++;
        // Treat non-own deals as cross-team (isSameDepartment=false)
        if (isDealMoneyVisible(userRole, l.leadOwner, currentUserId, false)) {
          value += d.value;
        }
      }
    });
  });
  return { count, value };
}

function getLeadFunnelData(leads: Lead[]) {
  const groups = [
    { name: "Created / Cold", stages: ["Created", "Cold"], meaning: "New or unengaged", color: "var(--color-primary-light)" },
    { name: "Level 0 / Level 1", stages: ["Level 0", "Level 0(A)", "Level 1", "Level 1(A)"], meaning: "Initial contact & qualifying", color: "var(--color-accent)" },
    { name: "Level 2", stages: ["Level 2"], meaning: "Qualified, discovering needs", color: "#3B82F6" },
    { name: "Level 3", stages: ["Level 3"], meaning: "Meetings / Pitches", color: "#8B5CF6" },
    { name: "Level 4 / Level 4(A)", stages: ["Level 4", "Level 4(A)"], meaning: "Requirements gathered", color: "#F59E0B" },
    { name: "Level 5 / Level 6", stages: ["Level 5", "Level 6"], meaning: "Proposal / Negotiation", color: "#10B981" },
    { name: "Closed", stages: ["Closed", "Invalid", "Hold"], meaning: "Ended", color: "var(--color-text-muted)" },
  ];

  let maxCount = 0;
  let maxIndex = -1;

  const data = groups.map((g, index) => {
    const count = leads.filter(l => g.stages.includes(l.leadStage)).length;
    if (count > maxCount && g.name !== "Closed") {
      maxCount = count;
      maxIndex = index;
    }
    return {
      groupName: g.name,
      count,
      meaning: g.meaning,
      color: g.color,
      isBottleneck: false
    };
  });

  if (maxIndex !== -1) {
    data[maxIndex].isBottleneck = true;
  }

  return data;
}

function getTodayActionBoard(leads: Lead[]) {
  const summary = { callsDue: 0, followupsDue: 0, meetingsToday: 0, requirementsPending: 0 };
  const workList: DashboardData["todayActionBoard"]["workList"] = [];

  const todayStr = new Date().toISOString().split("T")[0];

  leads.forEach(l => {
    // Check followups
    l.followups.forEach(f => {
      if (f.status === "Pending" || f.status === "Overdue") {
        if (f.followupType.toLowerCase().includes("call")) summary.callsDue++;
        if (f.followupType.toLowerCase().includes("meet")) summary.meetingsToday++;
        summary.followupsDue++;

        if (f.followupDate === todayStr || f.status === "Overdue") {
          workList.push({
            id: f.id,
            time: f.followupTime,
            type: f.followupType,
            leadCompany: `${l.poc} / ${l.company}`,
            owner: l.leadOwner,
            action: f.nextAction,
            leadId: l.id
          });
        }
      }
    });

    // Check requirements
    l.requirements.forEach(r => {
      if (r.status !== "Deal" && r.status !== "Proposal") {
        summary.requirementsPending++;
      }
    });
  });

  workList.sort((a, b) => a.time.localeCompare(b.time));

  return { summary, workList };
}



function getOwnerPerformance(leads: Lead[]) {
  const performanceMap: Record<string, DashboardData["ownerPerformance"][0]> = {};

  leads.forEach(l => {
    if (!performanceMap[l.leadOwner]) {
      // In real app, fetch owner name from users list. For mock, just use ID as name fallback.
      performanceMap[l.leadOwner] = {
        ownerId: l.leadOwner,
        ownerName: l.leadOwner === "u-superadmin-1" ? "Priya Sharma" : l.leadOwner === "u-admin-1" ? "Rahul Mehta" : "Sneha Patil",
        leads: 0,
        followups: 0,
        requirements: 0,
        deals: 0,
        risk: 0
      };
    }
    const p = performanceMap[l.leadOwner];
    p.leads++;
    p.followups += l.followups.filter(f => f.status !== "Completed").length;
    p.requirements += l.requirements.filter(r => r.status !== "Deal").length;
    p.deals += l.deals.filter(d => !["Won", "Lost", "Closed", "Cancelled"].includes(d.stage)).length;

    // Calculate some risk score based on overdue or no activity
    if (l.followups.some(f => f.status === "Overdue")) p.risk++;
    if (l.activities.length === 0 && l.leadStage !== "Created") p.risk++;
  });

  return Object.values(performanceMap);
}

function getNeedsAttention(leads: Lead[]) {
  const attention: DashboardData["needsAttention"] = [];

  leads.forEach(l => {
    // Leads with no activity
    if (l.activities.length === 0 && !["Closed", "Invalid", "Hold", "Created"].includes(l.leadStage)) {
      attention.push({ id: `att-noact-${l.id}`, title: "No Activity", instruction: `Log activity for ${l.company}`, type: "error", leadId: l.id });
    }
    // Overdue followups
    l.followups.forEach(f => {
      if (f.status === "Overdue") {
         attention.push({ id: `att-od-${f.id}`, title: "Overdue Follow-up", instruction: `Complete ${f.followupType} for ${l.company}`, type: "error", leadId: l.id });
      }
    });
    // Level 1 without callback
    if (l.leadStage === "Level 1" && l.followups.length === 0) {
      attention.push({ id: `att-l1-${l.id}`, title: "Level 1 No Callback", instruction: `Set callback date for ${l.company}`, type: "warning", leadId: l.id });
    }
    // Level 4(A) stuck
    if (l.leadStage === "Level 4(A)" && l.requirements.length === 0) {
      attention.push({ id: `att-l4a-${l.id}`, title: "Level 4(A) Stuck", instruction: `Add requirements for ${l.company}`, type: "warning", leadId: l.id });
    }
    // Payment pending deals
    l.deals.forEach(d => {
      if (d.stage === "Payment Pending") {
        attention.push({ id: `att-pay-${d.id}`, title: "Payment Pending", instruction: `Follow up payment for ${l.company}`, type: "warning", leadId: l.id });
      }
    });
  });

  return attention.slice(0, 6); // Limit to top 6 items
}
