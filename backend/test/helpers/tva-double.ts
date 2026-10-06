import { formatInTimeZone } from 'date-fns-tz';

/**
 * Deterministic TVAService double.
 *
 * WorkdayService and DashboardService used to ask the time authority for
 * `companyDayStart()`. They now ask for `companyDateOnly()` instead — the
 * @db.Date-safe encoding — and the hand-written doubles in the suites below
 * were never updated, so every call arrived as `undefined` and failed with
 * "this.tva.companyDateOnly is not a function". The production services were
 * never wrong; the doubles were stale.
 *
 * Rather than stub a literal per suite, this reproduces the real TVAService
 * algorithms verbatim (same `formatInTimeZone` calls, same encodings) against
 * a clock the test pins. So the double cannot drift from the contract by
 * returning a plausible-looking value the production authority would not
 * produce, and a test that pins a clock gets exactly the dates the running
 * system would compute from that instant.
 *
 * `now` is the single source of company time here — nothing reads the system
 * clock or the host timezone.
 */
export function createTvaDouble(now: Date, timezone = 'Asia/Kolkata') {
  const companyTimezone = () => timezone;
  const at = (date?: Date) => date ?? now;

  /**
   * The company calendar date encoded as UTC midnight, matching
   * TVAService.companyDateOnly(). NOT the real midnight instant: Prisma reads
   * a Date's UTC calendar date for @db.Date columns, so IST midnight (which
   * falls on the previous UTC day) would shift every business day back by one.
   */
  const companyDateOnly = (date?: Date): Date => {
    const dateString = formatInTimeZone(at(date), timezone, 'yyyy-MM-dd');
    return new Date(`${dateString}T00:00:00.000Z`);
  };

  /** The real company-midnight instant, matching TVAService.companyDayStart(). */
  const companyDayStart = (date?: Date): Date =>
    new Date(formatInTimeZone(at(date), timezone, "yyyy-MM-dd'T'00:00:00.000XXX"));

  const companyDayEnd = (date?: Date): Date =>
    new Date(formatInTimeZone(at(date), timezone, "yyyy-MM-dd'T'23:59:59.999XXX"));

  const companyBusinessDate = (date?: Date): string =>
    formatInTimeZone(at(date), timezone, 'yyyy-MM-dd');

  const elapsedSeconds = (start: Date, end?: Date): number =>
    Math.max(0, Math.floor((at(end).getTime() - start.getTime()) / 1000));

  return {
    now: jest.fn(() => now),
    companyTimezone: jest.fn(companyTimezone),
    companyDateOnly: jest.fn(companyDateOnly),
    companyDayStart: jest.fn(companyDayStart),
    companyDayEnd: jest.fn(companyDayEnd),
    companyBusinessDate: jest.fn(companyBusinessDate),
    companyToday: jest.fn(() => companyBusinessDate()),
    elapsedSeconds: jest.fn(elapsedSeconds),
  };
}
