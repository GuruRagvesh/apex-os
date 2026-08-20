/**
 * Business Calendar contract (Attendance Base Layer, BL-2A).
 *
 * This layer answers exactly one question:
 *
 *     "What kind of company business date is this?"
 *
 * It reports FACTS, never an attendance status. A date can hold several facts
 * at once — 8 Nov 2026 is a Sunday AND a weekly off AND Diwali — and this
 * contract deliberately keeps all of them rather than collapsing to a single
 * label. Collapsing is the attendance evaluator's job in a later layer, and it
 * needs the full picture to do it correctly.
 *
 * Nothing here touches WorkSession, BreakLog, LeaveRequest, DailyAttendance or
 * any employee-specific policy.
 */

/**
 * Which calendar records a caller wants applied.
 *
 * Set from an employee's attendance profile (BL-3 assignedHolidayCalendarId /
 * assignedWeeklyOffPolicyId) so two employees can genuinely sit on different
 * calendars. Omitted entirely, the globally active records are used, which is
 * the original behaviour and keeps pre-BL-3 callers working.
 */
export interface BusinessCalendarSources {
  holidayCalendarId?: string | null;
  weeklyOffPolicyId?: string | null;
  /**
   * Opt-in strict source selection.
   *
   * Off (the default) preserves the original behaviour: with no assignment,
   * the globally active record is taken via findFirst. That is fine for a
   * company with exactly one calendar, and it keeps every pre-BL-5 caller
   * working unchanged.
   *
   * On, an unassigned source is resolved by COUNTING candidates instead:
   * exactly one is adopted as the company default, zero or several are
   * reported as NONE / AMBIGUOUS and no record is chosen. BL-5 turns this on
   * so a covered employee can never be silently attached to an arbitrary
   * calendar when the company has more than one.
   */
  strict?: boolean;
}

/**
 * How a calendar source was selected, retained so the choice can be audited
 * and reconstructed later.
 *
 *   ASSIGNED         the employee's profile named it
 *   COMPANY_DEFAULT  no assignment, and exactly one candidate existed
 *   NONE             no assignment and no candidate
 *   AMBIGUOUS        no assignment and several candidates -- nothing chosen
 */
export type CalendarSourceResolution =
  | 'ASSIGNED'
  | 'COMPANY_DEFAULT'
  | 'NONE'
  | 'AMBIGUOUS';

export interface CalendarSourceResolutions {
  holidayCalendar: CalendarSourceResolution;
  weeklyOffPolicy: CalendarSourceResolution;
}

export type WeeklyOffReason = 'SUNDAY' | 'SECOND_SATURDAY' | 'FOURTH_SATURDAY';

export type BusinessDayOverrideKind = 'SPECIAL_WORKING_DAY' | 'COMPANY_CLOSURE';

export interface WeeklyOffFacts {
  isWeeklyOff: boolean;
  /** Every rule that independently makes this date a weekly off. */
  reasons: WeeklyOffReason[];
  policyId: string | null;
}

export interface HolidayFacts {
  isHoliday: boolean;
  holidayId: string | null;
  calendarId: string | null;
  name: string | null;
  optional: boolean;
}

export interface BusinessDayOverrideFacts {
  id: string;
  type: BusinessDayOverrideKind;
  reason: string;
  approvedById: string | null;
}

/**
 * Which records produced this answer. Retained so a historical attendance
 * result can always be re-explained with the calendar that actually applied,
 * even after policies or calendars change.
 */
export interface BusinessDaySources {
  weeklyOffPolicyId: string | null;
  holidayCalendarId: string | null;
  holidayId: string | null;
  overrideId: string | null;
}

export interface BusinessDayFacts {
  /** Company business date, 'yyyy-MM-dd', resolved through TVAService. */
  businessDate: string;
  /** 0 = Sunday .. 6 = Saturday, in company time. */
  dayOfWeek: number;
  /** Nth occurrence of this weekday in its month (1-5). */
  weekdayOrdinal: number;

  weeklyOff: WeeklyOffFacts;
  holiday: HolidayFacts;
  override: BusinessDayOverrideFacts | null;

  /**
   * Whether the COMPANY ordinarily expects work on this date.
   *
   * Derived last, from the facts above:
   *   COMPANY_CLOSURE      -> always false
   *   SPECIAL_WORKING_DAY  -> always true
   *   otherwise            -> false if weekly off or a non-optional holiday
   *
   * This is a company-level expectation only. Whether a particular employee is
   * expected to work also depends on their category, shift and employment
   * dates, which belong to the employee timeline layer (BL-3).
   */
  expectedCompanyWorkingDay: boolean;

  /** How each calendar source was selected. See CalendarSourceResolution. */
  resolution: CalendarSourceResolutions;

  sources: BusinessDaySources;
}
