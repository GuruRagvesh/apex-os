// Thin route adapter. Imports the exact screen subpath rather than the
// component barrel, so this route does not also load the barrel and its
// dependents.
import KanbanScreen from '@apex/operations-tickets-lifecycle/screens/KanbanScreen';

export default function KanbanPage() {
  return <KanbanScreen />;
}
