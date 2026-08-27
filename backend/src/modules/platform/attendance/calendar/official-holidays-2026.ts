/**
 * The official TechnoEdge 2026 holiday calendar (BL-2A / BL-2B).
 *
 * This is the APPROVED source, transcribed exactly as supplied. It is the one
 * place these dates live: the HRMS policy seed and the staging importer both
 * read it, so the company cannot end up with two holiday lists that disagree —
 * which is precisely the defect LH-1 removed from the leave module.
 *
 * Three facts about this list are deliberate and must not be "corrected":
 *
 *  - There are exactly 17 entries.
 *  - Bhai Duj appears TWICE, on 10 and 11 November. Both were in the supplied
 *    source and both are kept; collapsing them would be a silent edit to an
 *    approved document.
 *  - Good Friday is NOT here. It appears in some public Indian holiday lists
 *    and appeared in the leave module's old hardcoded array, but it is not in
 *    the approved TechnoEdge source, so it is not a company holiday.
 *
 * Do not add to this list from an internet calendar. A change here is a change
 * to an approved policy document and belongs to whoever owns that document.
 */

export interface OfficialHoliday {
  /** yyyy-MM-dd, company business date. */
  date: string;
  name: string;
}

export const OFFICIAL_HOLIDAY_FINANCIAL_YEAR = '2026-2027';
export const OFFICIAL_HOLIDAY_CALENDAR_NAME = 'TechnoEdge Holiday Calendar 2026';

export const OFFICIAL_HOLIDAYS_2026: readonly OfficialHoliday[] = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-26', name: 'Republic Day' },
  { date: '2026-02-15', name: 'Maha Shivaratri/Shivaratri' },
  { date: '2026-03-03', name: 'Holi' },
  { date: '2026-03-19', name: 'Gudi Padwa' },
  { date: '2026-05-01', name: 'Maharashtra Day/Labour Day' },
  { date: '2026-08-15', name: 'Independence Day' },
  { date: '2026-08-28', name: 'Raksha Bandhan' },
  { date: '2026-09-14', name: 'Ganesh Chaturthi/Vinayaka Chaturthi' },
  { date: '2026-09-25', name: 'Ganesh Visharjan' },
  { date: '2026-10-02', name: 'Mahatma Gandhi Jayanti' },
  { date: '2026-10-20', name: 'Dussehra' },
  { date: '2026-11-08', name: 'Diwali/Deepavali' },
  { date: '2026-11-09', name: 'Govardhan Puja' },
  { date: '2026-11-10', name: 'Bhai Duj' },
  { date: '2026-11-11', name: 'Bhai Duj' },
  { date: '2026-12-25', name: 'Christmas' },
] as const;

/** Guards against an accidental edit that changes the approved row count. */
export const OFFICIAL_HOLIDAY_COUNT_2026 = 17;
