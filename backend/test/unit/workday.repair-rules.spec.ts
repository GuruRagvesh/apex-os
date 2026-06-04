import { formatInTimeZone } from 'date-fns-tz';

function classifySession(session: any, currentCompanyDateStr: string, timezone: string) {
  const sessionCompanyDateStr = session.date instanceof Date 
    ? formatInTimeZone(session.date, timezone, 'yyyy-MM-dd') 
    : String(session.date).split('T')[0];

  const isPreviousDay = sessionCompanyDateStr < currentCompanyDateStr;
  const isLogoutNull = !session.logoutAt;
  const isImpossibleDuration = (session.totalWorkMinutes || 0) > 960;
  const logoutBeforeStart = session.logoutAt && session.startWorkAt && session.logoutAt < session.startWorkAt;
  const badStatus = ['WORKING', 'ON_BREAK', 'ACTIVE'].includes(session.status) && isPreviousDay;
  const badAutoClose = !session.autoClosed && session.closureReason && session.closureReason.includes('AUTO');

  const openBreaks = (session.breakLogs || []).filter((b: any) => !b.endAt);
  const hasOpenBreaks = openBreaks.length > 0;

  if (isPreviousDay && isLogoutNull) {
    return 'AUTO_REPAIR_CANDIDATE';
  } else if (isImpossibleDuration || logoutBeforeStart || badStatus || badAutoClose || (hasOpenBreaks && !isLogoutNull)) {
    return 'MANUAL_REVIEW';
  }
  return 'OK';
}

describe('Workday Repair Classification Rules', () => {
  const currentCompanyDateStr = '2026-06-04';
  const timezone = 'Asia/Kolkata';

  it('1. old open session flagged as AUTO_REPAIR_CANDIDATE', () => {
    const session = {
      date: '2026-06-03T00:00:00.000Z',
      logoutAt: null,
      status: 'WORKING'
    };
    expect(classifySession(session, currentCompanyDateStr, timezone)).toBe('AUTO_REPAIR_CANDIDATE');
  });

  it('2. current-day active session is not flagged', () => {
    const session = {
      date: '2026-06-04T00:00:00.000Z',
      logoutAt: null,
      status: 'WORKING'
    };
    expect(classifySession(session, currentCompanyDateStr, timezone)).toBe('OK');
  });

  it('3. old open break is flagged in open session', () => {
    // If the session is open, it gets AUTO_REPAIR_CANDIDATE
    const session = {
      date: '2026-06-03T00:00:00.000Z',
      logoutAt: null,
      status: 'WORKING',
      breakLogs: [{ endAt: null }]
    };
    expect(classifySession(session, currentCompanyDateStr, timezone)).toBe('AUTO_REPAIR_CANDIDATE');
  });

  it('4. impossible closed day > 16h is MANUAL_REVIEW', () => {
    const session = {
      date: '2026-06-03T00:00:00.000Z',
      logoutAt: new Date(),
      totalWorkMinutes: 1000,
      status: 'LOGGED_OUT'
    };
    expect(classifySession(session, currentCompanyDateStr, timezone)).toBe('MANUAL_REVIEW');
  });

  it('5. logoutAt before start is MANUAL_REVIEW', () => {
    const session = {
      date: '2026-06-03T00:00:00.000Z',
      startWorkAt: new Date('2026-06-03T10:00:00Z'),
      logoutAt: new Date('2026-06-03T09:00:00Z'),
      status: 'LOGGED_OUT'
    };
    expect(classifySession(session, currentCompanyDateStr, timezone)).toBe('MANUAL_REVIEW');
  });
});
