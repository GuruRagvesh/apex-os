import type { MyAttendanceDayV2 } from '../my-attendance-v2-api';
import type { HomeProductivityDay } from './home-insights-api';

/**
 * Pure date and scoring rules for the Home calendar panel.
 *
 * Dates are business-date strings ('yyyy-MM-dd'). Arithmetic is done at UTC
 * noon so no host timezone or DST shift can move a date.
 */

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: string): number {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const wd = weekday(date);
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Whether a date is a working day.
 *
 * The attendance record is the authority when it has spoken (WEEKLY_OFF,
 * HOLIDAY). For dates it has not evaluated yet, the company's published rule
 * applies: Sundays and the 2nd and 4th Saturday of the month are off.
 */
export function isWorkingDay(date: string, byDate: Map<string, MyAttendanceDayV2>): boolean {
  const day = byDate.get(date);
  if (day?.outcome === 'WEEKLY_OFF' || day?.outcome === 'HOLIDAY' || day?.outcome === 'EXEMPT') return false;
  if (day?.outcome) return true;
  const wd = weekday(date);
  if (wd === 0) return false;
  if (wd === 6) {
    const nth = Math.ceil(Number(date.slice(8, 10)) / 7);
    return nth !== 2 && nth !== 4;
  }
  return true;
}

export interface WeekWindow {
  /** Which week the panel is talking about. */
  kind: 'this' | 'last';
  start: string;
  end: string;
  /** The week it is compared with. */
  previousStart: string;
  previousEnd: string;
}

/**
 * Last week's analysis is shown until the last working day of the current
 * week. From that day on, the current week is shown (including that day).
 */
export function pickWeek(today: string, byDate: Map<string, MyAttendanceDayV2>): WeekWindow {
  const monday = weekStart(today);
  const sunday = addDays(monday, 6);
  const working = datesBetween(monday, sunday).filter((d) => isWorkingDay(d, byDate));
  const lastWorking = working[working.length - 1] ?? addDays(monday, 4);
  if (today >= lastWorking) {
    return { kind: 'this', start: monday, end: today, previousStart: addDays(monday, -7), previousEnd: addDays(monday, -1) };
  }
  const lastMonday = addDays(monday, -7);
  return { kind: 'last', start: lastMonday, end: addDays(lastMonday, 6), previousStart: addDays(lastMonday, -7), previousEnd: addDays(lastMonday, -1) };
}

// ── Attendance figures ──────────────────────────────────────────────────────

const OFF_OUTCOMES = new Set(['WEEKLY_OFF', 'HOLIDAY', 'EXEMPT', 'LEAVE', 'LWP']);

export interface AttendanceWeek {
  daysWorked: number;
  /** Average presence per worked day; breaks are not subtracted. */
  avgWorkMinutes: number | null;
  totalWorkMinutes: number;
  /** Average punch-in as minutes after local midnight. */
  avgPunchInMinutes: number | null;
  totalBreakMinutes: number;
  onTimeFullDays: number;
}

function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

export function attendanceWeek(from: string, to: string, byDate: Map<string, MyAttendanceDayV2>): AttendanceWeek {
  let daysWorked = 0;
  let totalWorkMinutes = 0;
  let totalBreakMinutes = 0;
  let punchSum = 0;
  let punchCount = 0;
  let onTimeFullDays = 0;
  for (const date of datesBetween(from, to)) {
    const day = byDate.get(date);
    if (!day || day.isFuture || !day.punchInAt) continue;
    const presence = day.presenceMinutes ?? day.workedMinutes;
    if (presence != null) {
      daysWorked += 1;
      totalWorkMinutes += presence;
    }
    totalBreakMinutes += day.breakMinutes ?? 0;
    punchSum += minutesOfDay(day.punchInAt);
    punchCount += 1;
    if (isStreakDay(day) === 'counts') onTimeFullDays += 1;
  }
  return {
    daysWorked,
    avgWorkMinutes: daysWorked ? totalWorkMinutes / daysWorked : null,
    totalWorkMinutes,
    avgPunchInMinutes: punchCount ? punchSum / punchCount : null,
    totalBreakMinutes,
    onTimeFullDays,
  };
}

/**
 * Streak rule: a day counts when the person punched in within the flexi
 * window AND completed the required hours. Late arrival, short hours, a half
 * day or an absence break it. Leave, holidays and weekly offs are skipped.
 */
export function isStreakDay(day: MyAttendanceDayV2 | undefined): 'counts' | 'breaks' | 'skip' {
  if (!day || day.isFuture || day.isInProgress) return 'skip';
  if (!day.outcome || OFF_OUTCOMES.has(day.outcome)) return 'skip';
  if (day.outcome === 'UNRESOLVED') return 'skip';
  if (day.outcome !== 'PRESENT') return 'breaks';
  if (day.modifiers.includes('LATE')) return 'breaks';
  if (day.modifiers.includes('INSUFFICIENT_PRESENCE') || day.modifiers.includes('INSUFFICIENT_EFFECTIVE_WORK')) return 'breaks';
  if (day.presenceMinutes != null && day.requiredMinutes != null && day.presenceMinutes < day.requiredMinutes) return 'breaks';
  return 'counts';
}

/** Consecutive counting days, walking back from today. */
export function attendanceStreak(today: string, byDate: Map<string, MyAttendanceDayV2>, earliest: string): number {
  let streak = 0;
  for (let d = today; d >= earliest; d = addDays(d, -1)) {
    const verdict = isStreakDay(byDate.get(d));
    if (verdict === 'counts') streak += 1;
    else if (verdict === 'breaks') break;
  }
  return streak;
}

// ── Productivity figures ────────────────────────────────────────────────────

/** One score per day so days can be compared: an hour of ticket time, a done ticket and half a credit per submission. */
export function productivityScore(day: HomeProductivityDay | undefined): number {
  if (!day) return 0;
  return day.ticketMinutes + day.ticketsDone * 60 + day.ticketsSubmitted * 30;
}

export interface ProductivityWeek {
  activeDays: number;
  avgProductiveMinutes: number | null;
  totalProductiveMinutes: number;
  ticketsDone: number;
  ticketsSubmitted: number;
}

export function productivityWeek(from: string, to: string, byDate: Map<string, HomeProductivityDay>): ProductivityWeek {
  let activeDays = 0;
  let total = 0;
  let done = 0;
  let submitted = 0;
  for (const date of datesBetween(from, to)) {
    const day = byDate.get(date);
    if (!day) continue;
    if (productivityScore(day) > 0) activeDays += 1;
    total += day.ticketMinutes;
    done += day.ticketsDone;
    submitted += day.ticketsSubmitted;
  }
  return {
    activeDays,
    avgProductiveMinutes: activeDays ? total / activeDays : null,
    totalProductiveMinutes: total,
    ticketsDone: done,
    ticketsSubmitted: submitted,
  };
}

export interface ProductiveDays {
  average: number;
  averageMinutes: number;
  averageDone: number;
  aboveAverage: Set<string>;
  top: string[];
}

/** Days above the person's own average, plus their top three. */
export function productiveDays(days: HomeProductivityDay[]): ProductiveDays {
  const scored = days.filter((d) => productivityScore(d) > 0);
  const n = scored.length || 1;
  const average = scored.reduce((sum, d) => sum + productivityScore(d), 0) / n;
  const averageMinutes = scored.reduce((sum, d) => sum + d.ticketMinutes, 0) / n;
  const averageDone = scored.reduce((sum, d) => sum + d.ticketsDone, 0) / n;
  const aboveAverage = new Set(scored.filter((d) => productivityScore(d) > average).map((d) => d.date));
  const top = [...scored]
    .sort((a, b) => productivityScore(b) - productivityScore(a))
    .slice(0, 3)
    .filter((d) => aboveAverage.has(d.date))
    .map((d) => d.date);
  return { average, averageMinutes, averageDone, aboveAverage, top };
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function hoursLabel(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const whole = Math.max(0, Math.round(minutes));
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function clockLabel(minutesOfDayValue: number | null): string {
  if (minutesOfDayValue == null) return '—';
  const whole = Math.round(minutesOfDayValue);
  const h = Math.floor(whole / 60) % 24;
  const m = whole % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function rangeLabel(from: string, to: string): string {
  const fmt = (d: string) => new Date(`${d}T12:00:00.000Z`).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${fmt(from)} – ${fmt(to)}`;
}
