// Thin route adapter. The component publishes a single screen, so no exact
// subpath is needed — same rule as Workforce Leave.
import { ActivityLogScreen } from '@apex/system-audit';

export default function ActivityLogPage() {
  return <ActivityLogScreen />;
}
