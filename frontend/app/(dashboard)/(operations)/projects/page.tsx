// Thin route adapter. Imports the exact screen subpath rather than the
// component barrel, so this route does not also load ProjectDetailScreen.
import ProjectsScreen from '@apex/operations-projects/screens/ProjectsScreen';

export default function ProjectsPage() {
  return <ProjectsScreen />;
}
