export type TeamPreferences = {
  showTeamOverview: boolean;
  highlightApproachingSla: boolean;
  dashboardDensity: 'comfortable' | 'compact';
};

export const DEFAULT_TEAM_PREFERENCES: TeamPreferences = {
  showTeamOverview: true,
  highlightApproachingSla: true,
  dashboardDensity: 'comfortable',
};

export function readTeamPreferences(value: unknown): TeamPreferences {
  const raw = value && typeof value === 'object' ? value as Partial<TeamPreferences> : {};
  return {
    showTeamOverview: typeof raw.showTeamOverview === 'boolean' ? raw.showTeamOverview : true,
    highlightApproachingSla: typeof raw.highlightApproachingSla === 'boolean' ? raw.highlightApproachingSla : true,
    dashboardDensity: raw.dashboardDensity === 'compact' ? 'compact' : 'comfortable',
  };
}
