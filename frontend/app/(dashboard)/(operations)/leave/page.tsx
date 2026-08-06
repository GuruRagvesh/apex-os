// Thin route adapter. The barrel publishes a single screen, so this route
// loads nothing it does not use.
import { LeaveScreen } from '@apex/workforce-leave';

export default function LeavePage() {
  return <LeaveScreen />;
}
