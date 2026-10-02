import * as fs from 'fs';
import * as path from 'path';
import { computeReviewerMetrics, toMetricsCycle } from '../../src/common/services/review-metrics';
import { planCleanup, stateReasons, type ActiveRow } from '../../scripts/lib/ticket-time-cleanup';
import {
  isOneActiveTimerViolation,
  LEDGER_PAUSE_REASONS,
  WORKDAY_RESUMABLE_PAUSE_REASONS,
} from '../../src/modules/operations/tickets/ticket-ledger.service';
import {
  reviewControls,
  reviewDecisionLabel,
  formatHoursMinutes,
  REVIEW_STATE_UNVERIFIED,
} from '../../../platforms/operations/tickets/lifecycle/shared/review-controls';

// Phase 4: reviewer active time, review turnaround and withdrawal, through the
// pure modules (metrics, cleanup planner, UI controls). Database behaviour is
// proven in test/integration-pg/t8 and t9.

const REPO = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

describe('reviewer metrics (shared by analytics and the dashboard)', () => {
  const at = (s: string) => new Date(s);
  const sla = { LOW: 48, MEDIUM: 24, HIGH: 8, URGENT: 4 };

  it('reviewer active time is the frozen productive seconds; turnaround is the wall clock; they never mix', () => {
    const m = computeReviewerMetrics([
      { decision: 'APPROVED', reviewerWorkSeconds: 600, reviewStartedAt: at('2026-08-13T00:00:00Z'), reviewEndedAt: at('2026-08-13T10:00:00Z'), priority: 'HIGH' },
    ], sla);
    expect(m.reviewerActiveSeconds).toBe(600);
    expect(m.averageReviewerActiveSeconds).toBe(600);
    expect(m.averageTurnaroundSeconds).toBe(36_000);
    // 10h turnaround > 8h HIGH SLA, although only 10 minutes were active review.
    expect(m.reviewSlaBreaches).toBe(1);
  });

  it('a long active review inside the SLA window is not a breach (SLA is turnaround, not active time)', () => {
    const m = computeReviewerMetrics([
      { decision: 'APPROVED', reviewerWorkSeconds: 9 * 3600, reviewStartedAt: at('2026-08-13T00:00:00Z'), reviewEndedAt: at('2026-08-13T10:00:00Z'), priority: 'MEDIUM' },
    ], sla);
    expect(m.reviewSlaBreaches).toBe(0);
  });

  it('WITHDRAWN cycles are excluded from approvals, rejections, rates, active time and breaches', () => {
    const m = computeReviewerMetrics([
      { decision: 'WITHDRAWN', reviewerWorkSeconds: 500, reviewStartedAt: at('2026-08-01T00:00:00Z'), reviewEndedAt: at('2026-08-13T00:00:00Z'), priority: 'URGENT' },
      { decision: 'REWORK', reviewerWorkSeconds: 120, reviewStartedAt: at('2026-08-13T00:00:00Z'), reviewEndedAt: at('2026-08-13T01:00:00Z'), priority: 'MEDIUM' },
    ], sla);
    expect(m).toMatchObject({
      decidedReviews: 1, approvals: 0, rejections: 1, withdrawn: 1,
      reviewerActiveSeconds: 120, reviewSlaBreaches: 0, approvalPercent: 0, rejectionPercent: 100,
    });
  });

  it('untimed decisions count as reviews but are not averaged as zero active time', () => {
    const m = computeReviewerMetrics([
      { decision: 'APPROVED', reviewerWorkSeconds: 0, reviewStartedAt: null, reviewEndedAt: null, priority: 'MEDIUM' },
      { decision: 'APPROVED', reviewerWorkSeconds: 300, reviewStartedAt: null, reviewEndedAt: null, priority: 'MEDIUM' },
    ], sla);
    expect(m).toMatchObject({ decidedReviews: 2, timedReviews: 1, averageReviewerActiveSeconds: 300, turnaroundMeasured: 0 });
  });

  it('no data is zeros, not NaN', () => {
    expect(computeReviewerMetrics([], sla)).toMatchObject({
      averageReviewerActiveSeconds: 0, averageTurnaroundSeconds: 0, reviewSlaBreachRate: 0, approvalPercent: 0,
    });
  });

  it('toMetricsCycle defaults a missing priority to MEDIUM', () => {
    expect(toMetricsCycle({ decision: 'APPROVED', reviewerWorkSeconds: 1, reviewStartedAt: null, reviewEndedAt: null }).priority).toBe('MEDIUM');
  });

  it('analytics and the dashboard read the same rows through the same calculator', () => {
    const analytics = read('backend/src/modules/platform/analytics/analytics.service.ts');
    const dashboard = read('backend/src/modules/platform/dashboard/dashboard.service.ts');
    for (const src of [analytics, dashboard]) {
      expect(src).toContain('select: REVIEW_METRICS_CYCLE_SELECT');
      expect(src).toContain('computeReviewerMetrics(reviewCycles.map(toMetricsCycle), config.review)');
      expect(src).not.toMatch(/reviewerWorkSeconds \|\| 0\) > limitSeconds/); // the old active-time-as-SLA test
    }
  });
});

describe('cleanup planner: reviewer timers (Phase 4)', () => {
  const row = (over: Partial<ActiveRow> = {}): ActiveRow => ({
    id: 'l-1', userId: 'u-1', ownerType: 'ASSIGNEE', hasOpenReviewCycle: false, ticketKey: 'TKT-1',
    startedAt: new Date('2026-08-13T05:00:00Z'), stage: 'WORK', hasOpenReworkCycle: false,
    ticketStatus: 'IN_PROGRESS', isBlocked: false, assignedTo: 'u-1', userStatus: 'WORKING',
    sessionMissing: false, sessionOtherUser: false, sessionClosed: false, sessionSuperseded: false,
    hasOpenWorkingSession: true, ...over,
  });
  const reviewer = (over: Partial<ActiveRow> = {}) =>
    row({ ownerType: 'REVIEWER', stage: 'REVIEW', ticketStatus: 'REVIEW', hasOpenReviewCycle: true, assignedTo: 'someone-else', ...over });

  it('a valid reviewer row has no reasons (assignee rules do not apply to it)', () => {
    expect(stateReasons(reviewer())).toEqual([]);
  });

  it('a reviewer row is invalid off REVIEW, without an open cycle, in the wrong stage, or when not working', () => {
    expect(stateReasons(reviewer({ ticketStatus: 'DONE' }))).toContain('REVIEWER_TICKET_NOT_IN_REVIEW');
    expect(stateReasons(reviewer({ hasOpenReviewCycle: false }))).toContain('REVIEWER_WITHOUT_OPEN_REVIEW_CYCLE');
    expect(stateReasons(reviewer({ stage: 'WORK' }))).toContain('REVIEWER_WRONG_STAGE');
    expect(stateReasons(reviewer({ userStatus: 'ON_BREAK' }))).toContain('USER_NOT_WORKING');
    expect(stateReasons(reviewer({ stage: 'REWORK' }))).not.toContain('REWORK_WITHOUT_OPEN_CYCLE');
  });

  it('an active employee and an active reviewer row of one user are duplicates; the latest start survives', () => {
    const plan = planCleanup([
      row({ id: 'l-emp', startedAt: new Date('2026-08-13T05:00:00Z') }),
      reviewer({ id: 'l-rev', ticketKey: 'TKT-2', startedAt: new Date('2026-08-13T06:00:00Z') }),
    ]);
    expect(plan.survivors).toEqual([{ userId: 'u-1', keptLogId: 'l-rev', keptTicketKey: 'TKT-2', closedLogIds: ['l-emp'] }]);
    expect(plan.closures).toEqual([{ logId: 'l-emp', userId: 'u-1', ticketKey: 'TKT-1', reasons: ['DUPLICATE_NOT_SURVIVOR'] }]);
  });

  it('age alone is never a reason', () => {
    expect(stateReasons(reviewer({ startedAt: new Date('2020-01-01T00:00:00Z') }))).toEqual([]);
  });
});

describe('ledger constants', () => {
  it('reviewer pause reasons never auto-resume with the workday', () => {
    // REVIEW_SWITCHED (employee work paused by Start Review) is resumed by the
    // review stopping, never by the workday resume.
    for (const r of ['REVIEW_PAUSED', 'REVIEW_DECISION', 'REVIEW_WITHDRAWN', 'REVIEW_ENDED', 'REVIEW_SWITCHED']) {
      expect((LEDGER_PAUSE_REASONS as any)[r]).toBe(r);
      expect(WORKDAY_RESUMABLE_PAUSE_REASONS).not.toContain(r);
    }
  });

  it('recognises a violation of the new and the legacy one-active index', () => {
    expect(isOneActiveTimerViolation({ message: 'duplicate key value violates unique constraint "ticket_time_logs_one_active_timed_per_user"' })).toBe(true);
    expect(isOneActiveTimerViolation({ message: 'duplicate key value violates unique constraint "ticket_time_logs_one_active_assignee_per_user"' })).toBe(true);
    expect(isOneActiveTimerViolation({ message: 'other' })).toBe(false);
  });
});

describe('ticket page review controls (UI)', () => {
  const base = (over: Record<string, any> = {}) => ({
    status: 'REVIEW', viewerCanApprove: true, assignedToId: 'worker',
    timers: { activeClock: 'NONE', active: null }, ...over,
  });
  const ready = { isLoading: false, isError: false };

  it('reviewer: Start Review when not running; Pause Review only when the ledger says the viewer runs it', () => {
    expect(reviewControls(base(), 'rev', ready)).toMatchObject({ canStartReview: true, canPauseReview: false, reviewRunningForViewer: false });
    const running = base({ timers: { activeClock: 'REVIEWER_WORK', active: { userId: 'rev', ownerType: 'REVIEWER' } } });
    expect(reviewControls(running, 'rev', ready)).toMatchObject({ canStartReview: false, canPauseReview: true, reviewRunningForViewer: true });
  });

  it('running state never comes from status alone', () => {
    // In REVIEW with no ledger clock: not running for anyone.
    expect(reviewControls(base(), 'rev', ready)).toMatchObject({ reviewRunning: false, reviewRunningForViewer: false });
    // Another reviewer's clock: running, but not the viewer's.
    const other = base({ timers: { activeClock: 'REVIEWER_WORK', active: { userId: 'someone', ownerType: 'REVIEWER' } } });
    expect(reviewControls(other, 'rev', ready)).toMatchObject({ reviewRunning: true, reviewRunningForViewer: false, canStartReview: true });
  });

  it('non-reviewers get no reviewer controls; only the assignee may withdraw', () => {
    expect(reviewControls(base({ viewerCanApprove: false }), 'x', ready)).toMatchObject({ canStartReview: false, canDecide: false, canWithdraw: false });
    expect(reviewControls(base({ viewerCanApprove: false }), 'worker', ready)).toMatchObject({ canWithdraw: true });
    expect(reviewControls(base({ status: 'IN_PROGRESS' }), 'worker', ready).canWithdraw).toBe(false);
  });

  it('everything is disabled while loading or when the ticket could not be read', () => {
    expect(reviewControls(base(), 'rev', { isLoading: true, isError: false })).toMatchObject({ canStartReview: false, canDecide: false, canWithdraw: false });
    const failed = reviewControls(base(), 'worker', { isLoading: false, isError: true });
    expect(failed).toMatchObject({ canStartReview: false, canWithdraw: false, disabledReason: REVIEW_STATE_UNVERIFIED });
  });

  it('labels and formatting', () => {
    expect(reviewDecisionLabel('WITHDRAWN')).toBe('Withdrawn by assignee');
    expect(reviewDecisionLabel('REWORK')).toBe('Rework requested');
    expect(reviewDecisionLabel(null)).toBe('In review');
    expect(formatHoursMinutes(3 * 3600 + 25 * 60 + 59)).toBe('3h 25m');
  });

  it('the ticket page wires the controls: separate clocks, no double submit, refresh after actions', () => {
    const page = read('frontend/app/(dashboard)/(operations)/tickets/[id]/page.tsx');
    expect(page).toContain("ticket.timers.activeClock === 'REVIEWER_WORK'");
    expect(page).not.toContain('REVIEWER_APPROVAL');
    expect(page).toContain('Reviewer active: {formatHoursMinutes(ticket.timers.reviewerWorkSeconds)}');
    expect(page).toContain('Review turnaround: {formatHoursMinutes(ticket.timers.reviewTurnaroundSeconds)}');
    expect(page).toContain('Ticket age:');
    expect(page).toContain('disabled={!review.canStartReview || reviewActionPending}');
    expect(page).toContain('{withdrawMutation.isPending ? \'Withdrawing…\' : \'Withdraw Submission\'}');
    expect(page).toContain('qc.invalidateQueries({ queryKey: WORKDAY_TODAY_QUERY_KEY });');
    expect(page).toContain('aria-live="polite"');
  });
});
