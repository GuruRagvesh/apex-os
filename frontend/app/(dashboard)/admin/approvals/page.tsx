// Thin route adapter. The component publishes a single screen, so the barrel
// cannot force this route to load code it does not use — no exact subpath is
// needed here, matching the Workforce Leave rule.
import { ApprovalsScreen } from '@apex/core-users-change-requests';

export default function ApprovalsPage() {
  return <ApprovalsScreen />;
}
