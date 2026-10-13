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
  };
  projects: {
    id: string; code: string; name: string; endDate: string | null; lead: string | null;
    progress: number; total: number; active: number; done: number; overdue: number; blocked: number;
    inProgress: number; review: number; todo: number; peopleCount: number;
    people: { id: string; name: string; active: number; done: number; overdue: number; hours: number }[];
  }[];
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

export type HomeActivity = { id: string; actorId: string; actor: string; action: string; date: string; url: string | null };
