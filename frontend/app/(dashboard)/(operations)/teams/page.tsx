// Thin route adapter. Imports the exact screen subpath rather than the
// component barrel, so this route does not also load TeamDetailScreen.
import TeamsScreen from '@apex/workforce-teams/screens/TeamsScreen';

export default function TeamsPage() {
  return <TeamsScreen />;
}
