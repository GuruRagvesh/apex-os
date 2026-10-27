'use client';

// Thin route adapter. Only this component is published from the barrel, so
// there is no risk of an unrelated route loading the dashboard widgets.
//
// The personal calendar panel belongs to attendance, so the route composes it
// into the dashboard screen instead of the dashboard importing it.
import { DashboardScreen } from '@apex/intelligence-dashboard';
import { HomeCalendarPanel } from '@/components/attendance-v2/home/HomeCalendarPanel';

export default function DashboardPage() {
  return <DashboardScreen
    personalPanel={<HomeCalendarPanel />}
    showTeamInsights
  />;
}
