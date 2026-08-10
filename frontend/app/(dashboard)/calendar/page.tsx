// Thin route adapter. The component publishes a single screen, so no exact
// subpath is needed — same rule as Workforce Leave.
import { CalendarScreen } from '@apex/workforce-calendar';

export default function CalendarPage() {
  return <CalendarScreen />;
}
