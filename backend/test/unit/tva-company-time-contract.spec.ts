import { TVAService } from '../../src/common/services/tva.service';
import { ConfigService } from '@nestjs/config';

// Exercises the REAL TVAService — no mocks. These assertions are the company
// time contract every Attendance layer will build on, so a stubbed clock here
// would prove nothing.
function makeTva(overrides: Record<string, string> = {}): TVAService {
  const config = {
    get: (key: string) => overrides[key],
  } as unknown as ConfigService;
  return new TVAService(config);
}

describe('TVA Company Time Contract (BL-1)', () => {
  describe('timezone configuration', () => {
    it('defaults to Asia/Kolkata when COMPANY_TIMEZONE is unset', () => {
      expect(makeTva().companyTimezone()).toBe('Asia/Kolkata');
    });

    it('the configured timezone is authoritative, not the server locale', () => {
      const tva = makeTva({ COMPANY_TIMEZONE: 'America/New_York' });
      expect(tva.companyTimezone()).toBe('America/New_York');
      // 2026-08-20T19:15:00Z is 15:15 in New York on 2026-08-20,
      // but 00:45 on 2026-08-21 in India.
      expect(tva.companyBusinessDate(new Date('2026-08-20T19:15:00.000Z'))).toBe('2026-08-20');
    });
  });

  describe('company business date', () => {
    const tva = makeTva();

    it('converts a mid-day IST instant to that business date', () => {
      expect(tva.companyBusinessDate(new Date('2026-08-20T09:00:00.000Z'))).toBe('2026-08-20');
    });

    it('an instant BEFORE IST midnight stays on the earlier business date', () => {
      // 18:29 UTC = 23:59 IST on 2026-08-20
      expect(tva.companyBusinessDate(new Date('2026-08-20T18:29:00.000Z'))).toBe('2026-08-20');
    });

    it('an instant AFTER IST midnight rolls to the next business date', () => {
      // 18:30 UTC = 00:00 IST on 2026-08-21
      expect(tva.companyBusinessDate(new Date('2026-08-20T18:30:00.000Z'))).toBe('2026-08-21');
    });

    it('the BL-1 worked example: 2026-08-20T19:15:00Z is 2026-08-21, never 2026-08-20', () => {
      const businessDate = tva.companyBusinessDate(new Date('2026-08-20T19:15:00.000Z'));
      expect(businessDate).toBe('2026-08-21');
      expect(businessDate).not.toBe('2026-08-20');
    });

    it('crosses the New Year boundary on IST midnight, not UTC midnight', () => {
      expect(tva.companyBusinessDate(new Date('2026-12-31T18:29:59.000Z'))).toBe('2026-12-31');
      expect(tva.companyBusinessDate(new Date('2026-12-31T18:30:00.000Z'))).toBe('2027-01-01');
      // Still the new year at UTC midnight, because that is 05:30 IST.
      expect(tva.companyBusinessDate(new Date('2027-01-01T00:00:00.000Z'))).toBe('2027-01-01');
    });

    it('companyDateOnly encodes the same business date as UTC midnight', () => {
      const d = tva.companyDateOnly(new Date('2026-08-20T19:15:00.000Z'));
      expect(d.toISOString()).toBe('2026-08-21T00:00:00.000Z');
    });
  });

  describe('financial year', () => {
    const tva = makeTva();

    it('1 April 2026 opens FY 2026-2027', () => {
      expect(tva.financialYear(new Date('2026-04-01T06:00:00.000Z')).label).toBe('2026-2027');
    });

    it('31 March 2027 still closes FY 2026-2027', () => {
      expect(tva.financialYear(new Date('2027-03-31T06:00:00.000Z')).label).toBe('2026-2027');
    });

    it('1 April 2027 opens FY 2027-2028', () => {
      expect(tva.financialYear(new Date('2027-04-01T06:00:00.000Z')).label).toBe('2027-2028');
    });

    it('returns a structured contract, not just a label', () => {
      expect(tva.financialYear(new Date('2026-08-20T09:00:00.000Z'))).toEqual({
        startYear: 2026,
        endYear: 2027,
        label: '2026-2027',
      });
    });

    it('resolves the FY from the COMPANY date, not the server date', () => {
      // 2026-03-31T19:00:00Z is 2026-04-01 00:30 IST — already the new FY.
      expect(tva.financialYear(new Date('2026-03-31T19:00:00.000Z')).label).toBe('2026-2027');
    });
  });

  describe('financial year bounds', () => {
    const tva = makeTva();

    it('FY 2026-2027 runs 1 Apr 2026 to 31 Mar 2027 inclusive', () => {
      const bounds = tva.financialYearBounds('2026-2027');
      expect(bounds.start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
      expect(bounds.end.toISOString()).toBe('2027-03-31T00:00:00.000Z');
      expect(bounds.financialYear.label).toBe('2026-2027');
    });

    it('accepts an instant and derives the containing FY', () => {
      const bounds = tva.financialYearBounds(new Date('2026-08-20T19:15:00.000Z'));
      expect(bounds.financialYear.label).toBe('2026-2027');
      expect(bounds.start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    });

    it('accepts a FinancialYear object', () => {
      const fy = tva.financialYear(new Date('2027-06-01T06:00:00.000Z'));
      expect(tva.financialYearBounds(fy).end.toISOString()).toBe('2028-03-31T00:00:00.000Z');
    });

    it('bounds use the same encoding as companyDateOnly, so they compare directly', () => {
      const bounds = tva.financialYearBounds('2026-2027');
      expect(bounds.start).toEqual(tva.companyDateOnly(new Date('2026-04-01T06:00:00.000Z')));
      expect(bounds.end).toEqual(tva.companyDateOnly(new Date('2027-03-31T06:00:00.000Z')));
    });

    it('is leap-year safe when the closing month is February', () => {
      // A March-start FY closes in February; 2028 is a leap year.
      const marchStart = makeTva({ FINANCIAL_YEAR_START_MONTH: '3' });
      const bounds = marchStart.financialYearBounds('2027-2028');
      expect(bounds.start.toISOString()).toBe('2027-03-01T00:00:00.000Z');
      expect(bounds.end.toISOString()).toBe('2028-02-29T00:00:00.000Z');
    });

    it('rejects a malformed financial year label', () => {
      expect(() => tva.financialYearBounds('not-a-year')).toThrow(/Invalid financial year label/);
    });
  });

  describe('financial year start month configuration', () => {
    it('defaults to April', () => {
      expect(makeTva().financialYearStartMonth()).toBe(4);
    });

    it('honours a valid configured start month', () => {
      expect(makeTva({ FINANCIAL_YEAR_START_MONTH: '7' }).financialYearStartMonth()).toBe(7);
    });

    it('falls back to April for out-of-range or January values', () => {
      // January would make the FY a single calendar year, which the two-year
      // label contract cannot express — treated as unconfigured on purpose.
      expect(makeTva({ FINANCIAL_YEAR_START_MONTH: '1' }).financialYearStartMonth()).toBe(4);
      expect(makeTva({ FINANCIAL_YEAR_START_MONTH: '13' }).financialYearStartMonth()).toBe(4);
      expect(makeTva({ FINANCIAL_YEAR_START_MONTH: 'abc' }).financialYearStartMonth()).toBe(4);
    });
  });

  describe('existing TVA behaviour is unchanged', () => {
    const tva = makeTva();
    const sample = new Date('2023-10-25T14:30:00.000Z');

    it('companyDayStart still returns IST midnight as a UTC instant', () => {
      expect(tva.companyDayStart(sample).toISOString()).toBe('2023-10-24T18:30:00.000Z');
    });

    it('companyDayEnd still returns IST end-of-day as a UTC instant', () => {
      expect(tva.companyDayEnd(sample).toISOString()).toBe('2023-10-25T18:29:59.999Z');
    });

    it('companyToday still returns yyyy-MM-dd and agrees with companyBusinessDate', () => {
      expect(tva.companyToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(tva.companyToday()).toBe(tva.companyBusinessDate());
    });

    it('isSameCompanyDay still compares in company time', () => {
      expect(tva.isSameCompanyDay(
        new Date('2026-08-20T09:00:00.000Z'),
        new Date('2026-08-20T18:29:00.000Z'),
      )).toBe(true);
      expect(tva.isSameCompanyDay(
        new Date('2026-08-20T18:29:00.000Z'),
        new Date('2026-08-20T18:30:00.000Z'),
      )).toBe(false);
    });

    it('elapsedMinutes and elapsedSeconds still clamp at zero', () => {
      const later = new Date('2026-08-20T10:00:00.000Z');
      const earlier = new Date('2026-08-20T09:00:00.000Z');
      expect(tva.elapsedMinutes(earlier, later)).toBe(60);
      expect(tva.elapsedSeconds(earlier, later)).toBe(3600);
      expect(tva.elapsedMinutes(later, earlier)).toBe(0);
    });

    it('getClockSnapshot still reports the SERVER_TVA contract', () => {
      const snap = tva.getClockSnapshot();
      expect(snap.source).toBe('SERVER_TVA');
      expect(snap.status).toBe('SYNCED');
      expect(snap.timezone).toBe('Asia/Kolkata');
      expect(snap.companyDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});
