export type HomeAction = {
  id: string;
  type: string;
  title: string;
  detail: string;
  url: string;
};

export type HomeExperience = {
  scope: 'Personal' | 'Team' | 'Department' | 'Company';
  kpis: { activeTickets: number; activeProjects: number; ticketReviews: number; leaveReviews: number; ticketReviewLabel: string; leaveReviewLabel: string };
  recognition: { id: string; person: string; title: string; ticketId: string; date: string; url: string }[];
  personalSummary: { lastWeekAverageMinutes: number | null; thisWeekMinutes: number | null; thisWeekDays: number };
  team: {
    detailed: boolean;
    attentionCount: number;
    rows: { id: string; name: string; status: string; active: number | null; completed: number | null; overdue: number | null; productiveMinutes: number | null; averageMinutes: number | null }[];
    hierarchyRole: string;
    showDepartmentFilter: boolean;
    departments: {
      id: string;
      name: string;
      people: { id: string; name: string; role: string; teamId?: string; teamName?: string }[];
    }[];
  };
  radar: {
    overdue: number; dueSoon: number; ageingReviews: number; blocked: number;
    actions: HomeAction[];
    upcoming: { id: string; type: string; title: string; date: string; url: string }[];
    bottlenecks: { id: string; code: string; title: string; blocked: boolean; overdue: boolean; url: string }[];
  };
};

export type HomeWorkspace = {
  notes: string[];
  checklist: { id: string; text: string; done: boolean }[];
  essentials: { id: string; label: string; url: string }[];
  updatedAt: string | null;
};

export type TeamInsightPayload = {
  target: 'OVERALL' | 'PERSON';
  scope: { role: string; people: number; departmentId: string | null; companyWide: boolean };
  period: { month: string; mode: 'MONTH' | 'WEEK'; week: string; from: string; to: string; dataThrough: string | null; weeks: { value: number; label: string; from: string; to: string }[] };
  identity: null | {
    id: string; name: string; initials: string; photoUrl: string | null; role: string;
    department: { id: string; name: string } | null; status: string;
    workingMinutes: number; activeBreakMinutes: number;
  };
  focus: { ratio: number | null; changePoints: number | null };
  workday: {
    daysWorked: number; workingMinutes: number; productiveMinutes: number; ticketMinutes: number;
    meetingMinutes: number; breakMinutes: number; meetingCount: number;
    averages: { workingMinutes: number | null; productiveMinutes: number | null; breakMinutes: number | null; meetingMinutes: number | null; meetingCount: number | null };
  };
  productivity: { direction: 'RISING' | 'STEADY' | 'FALLING' | 'NO_COMPARISON'; changePercent: number | null; buckets: { label: string; minutes: number; daysWorked: number; averageMinutes: number; isFuture: boolean; isPartial: boolean }[] };
  tickets: { active: number; inProgress: number; underReview: number; sentForReview: number; executionOverdue: number; reviewOverdue: number; reworkTickets: number; reworkAttempts: number };
  attendance: null | { counts: { present: number; late: number; halfDay: number; leave: number; weeklyOff: number; holiday: number; needsReview: number }; days: { date: string; status: string; workedMinutes: number; breakMinutes: number; lateMinutes: number }[] };
  projects: { id: string; code: string; name: string; status: string; finishedAt: string | null; assigned: number; done: number; active: number; overdue: number; contributionPercent: number | null; hasStatusConflict: boolean }[];
};

export type PersonalHighlightPayload = {
  period: { month: string; from: string; to: string };
  achievements: { id: string; title: string; detail: string; tone: string; kind: 'LEADER' | 'INDIVIDUAL' | 'PERSONAL_BEST' }[];
  averageBreakMinutes: number | null;
  projects: TeamInsightPayload['projects'];
};

export type HomeActivity = { id: string; actorId: string; actor: string; action: string; date: string; url: string | null };
