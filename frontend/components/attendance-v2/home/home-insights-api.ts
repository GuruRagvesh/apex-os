import { api, unwrap as r } from '@apex/shared-auth';

/**
 * The signed-in user's own per-day productivity (GET /home/productivity).
 * Read-only and scoped server-side to the authenticated user.
 * Mirrors HomeInsightDay in backend/src/modules/platform/dashboard/home-insights.service.ts.
 */
export interface HomeProductivityDay {
  date: string;
  /** Tickets added to this user's workload on this company business date. */
  ticketsCreated: number;
  ticketsDone: number;
  ticketsSubmitted: number;
  /** Time logged on tickets; ticket timers pause on breaks, so breaks are excluded. */
  ticketMinutes: number;
  estimatedMinutesDone: number;
  doneTickets: { id: string; ticketId: string; title: string }[];
}

export async function getHomeProductivity(from: string, to: string): Promise<HomeProductivityDay[]> {
  return r(api.get('/home/productivity', { params: { from, to } }));
}

export interface HomePersonalHighlights {
  averageBreakMinutes: number | null;
}

export async function getHomePersonalHighlights(month: string): Promise<HomePersonalHighlights> {
  return r(api.get('/home/personal-highlights', { params: { month } }));
}
