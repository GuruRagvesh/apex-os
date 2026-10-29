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
  notes: { id: string; title: string; content: string; createdAt: string | null; updatedAt: string | null }[];
  checklist: { id: string; text: string; done: boolean; priority: 'HIGH' | 'MEDIUM' | 'LOW' }[];
  essentials: { id: string; label: string; url: string }[];
  updatedAt: string | null;
};

export type TeamInsightPayload = {
  target: 'OVERALL' | 'PERSON';
  scope: { role: string; people: number; departmentId: string | null; companyWide: boolean };
  period: { month: string; mode: 'MONTH' | 'WEEK' | 'DAY'; week: string; date: string | null; from: string; to: string; dataThrough: string | null; weeks: { value: number; label: string; from: string; to: string }[] };
  identity: null | {
    id: string; name: string; initials: string; photoUrl: string | null; role: string;
    department: { id: string; name: string } | null; status: string;
    workingMinutes: number; activeBreakMinutes: number;
  };
  tickets: {
    active: number; inProgress: number; underReview: number; completed: number; overdue: number;
    sentForReview: number; executionOverdue: number; reviewOverdue: number; reworkTickets: number; reworkAttempts: number;
  };
  projects: TeamInsightProject[];
  workday: {
    daysWorked: number; workingMinutes: number; presenceMinutes: number; productiveMinutes: number; ticketMinutes: number;
    meetingMinutes: number; breakMinutes: number; breakCount: number; measurablePresenceDays: number;
    meetingCount: number; meetingParticipationCount: number;
    punchInMinute: number | null; punchOutMinute: number | null; punchInCount: number; punchOutCount: number;
    calendarResolved: boolean; denominatorResolved: boolean; calculationComplete: boolean; scheduledWorkingDays: number; expectedEmployeeDays: number;
    employmentExcludedDays: number; unresolvedScheduleDays: number;
    presentDays: number; halfDays: number; lateDays: number; lessWorkingHoursDays: number; absentDays: number; leaveDays: number;
    unresolvedDays: number; missingDays: number; attendanceRate: number | null; coverageRate: number | null;
    leaveUsage: null | {
      allocatedDays: number; takenDays: number; pendingDays: number; financialYear: string;
      leaves: Array<{ id: string; type: string; startDate: string; endDate: string; isHalfDay: boolean }>;
    };
    attendanceCalendar: Array<{
      date: string;
      status: string;
      outcome: string | null;
      modifiers: string[];
      isPresent: boolean;
      holidayName: string | null;
      isWorkingDay: boolean;
      punchInAt: string | null;
      punchOutAt: string | null;
      workingMinutes: number | null;
      productiveMinutes: number;
      meetingMinutes: number;
      meetingCount: number;
      breakCount: number;
      breakMinutes: number;
      lateMinutes: number;
      currentStatus: string | null;
      leaveType: string | null;
    }>;
    averages: { workingMinutes: number | null; productiveMinutes: number | null; breakMinutes: number | null; breakCount: number | null; meetingMinutes: number | null; meetingCount: number | null };
  };
};

export type TeamInsightProject = {
  id: string; code: string; name: string; status: string; finishedAt: string | null;
  department?: { id: string; name: string } | null;
  departments?: Array<{ id: string; name: string }>;
  assigned: number; done: number; active: number; inProgress?: number; overdue: number;
  contributionPercent: number | null; hasStatusConflict: boolean;
};

export type PersonalHighlightPayload = {
  period: { month: string; from: string; to: string };
  achievements: { id: string; title: string; detail: string; tone: string; kind: 'LEADER' | 'INDIVIDUAL' | 'PERSONAL_BEST' }[];
  averageBreakMinutes: number | null;
  projects: TeamInsightProject[];
};

export type HomeActivity = { id: string; actorId: string; actor: string; action: string; date: string; url: string | null };
