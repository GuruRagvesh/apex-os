// Intelligence Dashboard — overview frontend surface.
//
// Only the route-level screen is published. The eight widgets below it are
// component-internal and deliberately not re-exported.

export { default as DashboardScreen } from './screens/DashboardScreen';
export { PersonalHighlightsTopbar } from './screens/PersonalHighlightsSection';
export { DEFAULT_TEAM_PREFERENCES, readTeamPreferences } from '../team-preferences';
export type { TeamPreferences } from '../team-preferences';
