/**
 * THE ONLY PLACE the personal workday/attendance status cache keys are
 * spelled, and every one carries the viewer.
 *
 * Three components independently read `workday-today` (WorkdayBar, the
 * sidebar's work-status dot, the topbar), two read `my-attendance-today`
 * (WorkdayBar, AttendanceLeaveSummary) or both (AttendanceToday), and two
 * more read `my-punch-evidence` (AttendanceToday, AttendanceDayDetail). All
 * of it is one person's own state -- their session, their attendance record,
 * their punch evidence -- and an unscoped key hands it to the next person who
 * logs into the same tab after a logout, exactly the bug class the Comp Off
 * closeout found and fixed. It had leaked into four call sites there under
 * three different spellings; here it is worse, because several of these
 * components deliberately SHARE one cache entry rather than each fetching
 * their own (the sidebar's own query has no queryFn at all -- it reads
 * whatever WorkdayBar or the topbar already populated). That sharing is only
 * safe when every reader uses the exact same key, which is the reason this
 * module exists rather than each component scoping its own copy.
 *
 * READS use the full key, viewer included, always. WRITES (invalidateQueries)
 * may use the base PREFIX instead -- React Query's default match is a prefix
 * match, not exact -- and that is what the three workday modals and
 * ReminderAlarm's own invalidation already do. A prefix invalidation is not a
 * forgotten scope; it deliberately reaches every viewer's cached entry with
 * one call, which is correct for a WRITE (there is only one viewer who could
 * be acting) in a way it would not be for a READ.
 */

export const workdayStatusKeys = {
  /** workdayApi.getToday() -- the live Workday session: status, break, totals. */
  today: (viewerId: string | null | undefined) =>
    ['workday-today', viewerId ?? 'anonymous'] as const,
  /** getMyAttendanceToday() -- today's official/provisional AE-1 record. */
  attendanceToday: (viewerId: string | null | undefined) =>
    ['my-attendance-today', viewerId ?? 'anonymous'] as const,
  /** getMyPunchEvidence() -- the employee's own recent punch evidence rows. */
  punchEvidence: (viewerId: string | null | undefined) =>
    ['my-punch-evidence', viewerId ?? 'anonymous'] as const,

  /**
   * getMyAttendanceSummary()/getEmployeeAttendanceSummary() -- one employee's
   * composed month.
   *
   * Carries BOTH the viewer and the subject, and they are not the same thing.
   * The subject alone was the exact shape of the comp off grant-panel leak: a
   * manager's or HR's result cached under the employee's id, then served from
   * cache to a viewer the server would have refused with 403. The month is in
   * the key because it is a different answer, not a different rendering of one.
   */
  employeeSummary: (
    viewerId: string | null | undefined,
    subjectId: string | null | undefined,
    month: string,
  ) => ['employee-attendance-summary', viewerId ?? 'anonymous', subjectId ?? 'self', month] as const,

  /**
   * getCompanyAttendanceAnalytics() -- the company or team analytics read.
   *
   * CARRIES THE VIEWER even though the subject is a whole company, because
   * the ANSWER depends on who asked: the same endpoint and the same filters
   * return the company to HR and one team to a manager. Keyed on the filters
   * alone, a manager's narrower result would be served to HR, or worse, HR's
   * company-wide result to a manager the server would have scoped down.
   */
  companyAnalytics: (
    viewerId: string | null | undefined,
    filterKey: string,
  ) => ['attendance-analytics-company', viewerId ?? 'anonymous', filterKey] as const,

  /**
   * PREFIXES, for invalidateQueries only -- never for a read. Passing one of
   * these to useQuery would create a THIRD, unscoped cache entry alongside
   * the real per-viewer ones above; passing it to invalidateQueries reaches
   * every viewer's entry in one call, which is what an invalidation after a
   * WRITE actually wants (there is only one viewer who could have just acted).
   */
  todayPrefix: ['workday-today'] as const,
  attendanceTodayPrefix: ['my-attendance-today'] as const,
};
