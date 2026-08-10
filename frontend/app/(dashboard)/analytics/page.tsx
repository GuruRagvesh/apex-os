// Thin route adapter. The component publishes a single screen, so the barrel
// cannot force this route to load code it does not use — no exact subpath is
// needed here, matching the Workforce Leave rule.
import { AnalyticsScreen } from '@apex/intelligence-analytics';

export default function AnalyticsPage() {
  return <AnalyticsScreen />;
}
