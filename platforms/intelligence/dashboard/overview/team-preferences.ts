export type TeamPreferences = {
  /** Legacy personal dashboard display preferences. */
  showTeamOverview: boolean;
  highlightApproachingSla: boolean;
  dashboardDensity: 'comfortable' | 'compact';
  requireAssignee: boolean;
  requireDueDate: boolean;
  reassignRequiresReason: boolean;
  workloadGuardrail: 'warn' | 'block';
  escalationWindowHours: 4 | 8 | 24;
  notifyOnUnassigned: boolean;
  approvalRoute: 'reporting_manager' | 'team_lead';
};

export const DEFAULT_TEAM_PREFERENCES: TeamPreferences = {
  showTeamOverview: true,
  highlightApproachingSla: true,
  dashboardDensity: 'comfortable',
  requireAssignee: true,
  requireDueDate: true,
  reassignRequiresReason: true,
  workloadGuardrail: 'warn',
  escalationWindowHours: 8,
  notifyOnUnassigned: true,
  approvalRoute: 'reporting_manager',
};

export function readTeamPreferences(value: unknown): TeamPreferences {
  const raw = value && typeof value === 'object' ? value as Partial<TeamPreferences> : {};
  return {
    showTeamOverview: typeof raw.showTeamOverview === 'boolean' ? raw.showTeamOverview : true,
    highlightApproachingSla: typeof raw.highlightApproachingSla === 'boolean' ? raw.highlightApproachingSla : true,
    dashboardDensity: raw.dashboardDensity === 'compact' ? 'compact' : 'comfortable',
    requireAssignee: typeof raw.requireAssignee === 'boolean' ? raw.requireAssignee : true,
    requireDueDate: typeof raw.requireDueDate === 'boolean' ? raw.requireDueDate : true,
    reassignRequiresReason: typeof raw.reassignRequiresReason === 'boolean' ? raw.reassignRequiresReason : true,
    workloadGuardrail: raw.workloadGuardrail === 'block' ? 'block' : 'warn',
    escalationWindowHours: raw.escalationWindowHours === 4 || raw.escalationWindowHours === 24 ? raw.escalationWindowHours : 8,
    notifyOnUnassigned: typeof raw.notifyOnUnassigned === 'boolean' ? raw.notifyOnUnassigned : true,
    approvalRoute: raw.approvalRoute === 'team_lead' ? 'team_lead' : 'reporting_manager',
  };
}
