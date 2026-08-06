// Thin route adapter. Only this component is published from the barrel, so
// there is no risk of an unrelated route loading the dashboard widgets.
import { DashboardScreen } from '@apex/intelligence-dashboard';

export default function DashboardPage() {
  return <DashboardScreen />;
}
