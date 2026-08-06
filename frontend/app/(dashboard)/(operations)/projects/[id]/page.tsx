// Thin route adapter. Imports the exact screen subpath rather than the
// component barrel, so this route does not also load ProjectsScreen.
import ProjectDetailScreen from '@apex/operations-projects/screens/ProjectDetailScreen';

export default function ProjectDetailPage() {
  return <ProjectDetailScreen />;
}
