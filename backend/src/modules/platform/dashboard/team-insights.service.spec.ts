import { TicketStatus } from '@prisma/client';
import { averageClockMinute, netSessionMinutes, ticketOverduePhase } from './team-insights.service';

describe('Team Insights clock averages', () => {
  it('calculates the arithmetic average punch time in minutes after midnight', () => {
    expect(averageClockMinute([540, 555, 570, 585, 615])).toBe(573);
  });

  it('calculates 6:20 PM as 1100 average minutes for punch-out records', () => {
    expect(averageClockMinute([1080, 1095, 1125])).toBe(1100);
  });

  it('rounds the average to the nearest minute', () => {
    expect(averageClockMinute([540, 541])).toBe(541);
  });

  it('does not manufacture a value when there are no valid punches', () => {
    expect(averageClockMinute([])).toBeNull();
  });
});

describe('Team Insights overdue phase selection', () => {
  const ticket = (overrides: Record<string, unknown> = {}) => ({
    id: 'ticket-1',
    createdAt: new Date('2026-10-01T09:00:00.000Z'),
    updatedAt: new Date('2026-10-01T09:00:00.000Z'),
    status: TicketStatus.IN_PROGRESS,
    history: [],
    actualStartAt: new Date('2026-10-02T09:00:00.000Z'),
    submittedAt: null,
    reviewStartedAt: null,
    actualCompletedAt: null,
    closedAt: null,
    resolvedAt: null,
    cancelledAt: null,
    executionDueAt: new Date('2026-10-20T18:00:00.000Z'),
    reviewDueAt: new Date('2026-10-25T18:00:00.000Z'),
    dueDate: new Date('2026-10-30T18:00:00.000Z'),
    ...overrides,
  });

  it('uses the execution deadline while a ticket is open or in progress', () => {
    expect(ticketOverduePhase(ticket(), new Date('2026-10-23T12:00:00.000Z'))).toBe('EXECUTION');
  });

  it('uses the review deadline only after the ticket enters review', () => {
    const underReview = ticket({
      status: TicketStatus.REVIEW,
      reviewStartedAt: new Date('2026-10-21T09:00:00.000Z'),
    });
    expect(ticketOverduePhase(underReview, new Date('2026-10-23T12:00:00.000Z'))).toBeNull();
    expect(ticketOverduePhase(underReview, new Date('2026-10-26T12:00:00.000Z'))).toBe('REVIEW');
  });

  it('falls back to the general due date when the phase deadline is missing', () => {
    expect(ticketOverduePhase(ticket({ executionDueAt: null }), new Date('2026-10-31T12:00:00.000Z'))).toBe('EXECUTION');
  });

  it('does not call a ticket overdue after it has been completed', () => {
    expect(ticketOverduePhase(ticket({
      actualCompletedAt: new Date('2026-10-22T12:00:00.000Z'),
      status: TicketStatus.DONE,
    }), new Date('2026-10-23T12:00:00.000Z'))).toBeNull();
  });
});

describe('Team Insights live break deduction', () => {
  it('deducts the elapsed portion of a currently active break from live work', () => {
    const at = (hour: number, minute: number) => Date.UTC(2026, 9, 23, hour, minute);
    expect(netSessionMinutes(
      { start: at(9, 0), end: at(13, 30) },
      [{ start: at(13, 0), end: at(13, 30) }],
    )).toBe(240);
  });
});
