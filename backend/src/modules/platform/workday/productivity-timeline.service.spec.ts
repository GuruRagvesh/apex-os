import { firstOverdueWindow, segmentTypeForLedgerStage, subtractIntervals } from './productivity-timeline.service';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 0, minute));

describe('productivity timeline interval calculation', () => {
  it('keeps recorded work, review and rework as distinct timeline stages', () => {
    expect(segmentTypeForLedgerStage('WORK')).toBe('TICKET');
    expect(segmentTypeForLedgerStage('REVIEW')).toBe('REVIEW_WAIT');
    expect(segmentTypeForLedgerStage('REWORK')).toBe('REWORK');
  });

  it('keeps session gaps as undefined time around recorded activity', () => {
    expect(subtractIntervals(
      { start: at(0), end: at(180) },
      [{ start: at(30), end: at(60) }, { start: at(90), end: at(120) }],
    )).toEqual([
      { start: at(0), end: at(30) },
      { start: at(60), end: at(90) },
      { start: at(120), end: at(180) },
    ]);
  });

  it('merges overlapping exclusions instead of double-deducting time', () => {
    expect(subtractIntervals(
      { start: at(0), end: at(180) },
      [{ start: at(20), end: at(100) }, { start: at(60), end: at(140) }],
    )).toEqual([{ start: at(0), end: at(20) }, { start: at(140), end: at(180) }]);
  });

  it('clips exclusions that cross a day or session boundary', () => {
    expect(subtractIntervals(
      { start: at(30), end: at(120) },
      [{ start: at(0), end: at(60) }, { start: at(100), end: at(180) }],
    )).toEqual([{ start: at(60), end: at(100) }]);
  });

  it('shows an overdue ticket only on the date when it first became overdue', () => {
    const deadline = new Date('2026-10-05T12:00:00.000Z');
    const nextMidnight = new Date('2026-10-05T18:30:00.000Z');
    const resolvedLater = new Date('2026-10-09T10:00:00.000Z');
    expect(firstOverdueWindow(deadline, resolvedLater, nextMidnight)).toEqual({
      start: deadline,
      end: nextMidnight,
    });
  });
});
