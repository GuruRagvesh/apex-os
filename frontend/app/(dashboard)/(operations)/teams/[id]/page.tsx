// Thin route adapter. Imports the exact screen subpath rather than the
// component barrel, so this route does not also load TeamsScreen.
import TeamDetailScreen from '@apex/workforce-teams/screens/TeamDetailScreen';

export default function TeamDetailPage() {
  return <TeamDetailScreen />;
}
