export interface BreakLogData {
  startAt: Date;
  endAt: Date | null;
  durationMinutes: number | null;
}

export interface WorkSessionData {
  startWorkAt: Date | null;
  logoutAt: Date | null;
  totalBreakMinutes: number;
  totalWorkMinutes: number;
  autoClosed: boolean;
  closureReason?: string | null;
  continuationOfSessionId: string | null;
  breakLogs: BreakLogData[];
}

export interface WorkdayRuntimeResult {
  elapsedWorkMinutes: number;
  totalBreakMinutes: number;
  firstStartTime: Date | null;
  currentEndTime: Date | null;
  autoClosedCount: number;
  isResumed: boolean;
  sessionCount: number;
}

export function calculateWorkdayRuntime(
  sessions: WorkSessionData[],
  now: Date
): WorkdayRuntimeResult {
  let totalBreakMins = 0;
  let totalWorkMins = 0;
  let firstStartTime: Date | null = null;
  let currentEndTime: Date | null = null;
  let autoClosedCount = 0;
  let isResumed = false;

  for (const s of sessions) {
    if (!firstStartTime && s.startWorkAt) {
      firstStartTime = s.startWorkAt;
    }
    if (s.logoutAt) {
      currentEndTime = s.logoutAt;
    } else {
      currentEndTime = now; // Ongoing
    }
    if (s.autoClosed) {
      autoClosedCount++;
    }
    if (s.continuationOfSessionId) {
      isResumed = true;
    }

    let liveBreak = s.totalBreakMinutes || 0;
    const openBreak = s.breakLogs?.find((b) => !b.endAt);
    if (openBreak) {
      liveBreak += Math.max(0, Math.floor((now.getTime() - openBreak.startAt.getTime()) / 60000));
    }
    totalBreakMins += liveBreak;

    let sessionWork = s.totalWorkMinutes || 0;
    if (s.startWorkAt && !s.logoutAt) {
      const elapsed = Math.floor((now.getTime() - s.startWorkAt.getTime()) / 60000);
      sessionWork = Math.max(0, elapsed - liveBreak);
    }
    totalWorkMins += sessionWork;
  }

  return {
    elapsedWorkMinutes: totalWorkMins,
    totalBreakMinutes: totalBreakMins,
    firstStartTime,
    currentEndTime,
    autoClosedCount,
    isResumed,
    sessionCount: sessions.length,
  };
}
