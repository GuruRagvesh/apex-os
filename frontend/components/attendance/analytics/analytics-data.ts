import type { RegisterEmployee, RegisterResult, RosterRow } from '../console-api';
import { presentOutcome, type StatusPresentation } from '../../attendance-v2/status-presentation';
import type { AttendanceOutcome } from '../../attendance-v2/my-attendance-v2-api';

/**
 * Attendance analytics helpers.
 *
 * Every figure here is a SUM or a COUNT of values the server already stored
 * and returned (summary, roster, monthly register). Nothing is a rate, a score
 * or a percentage: those definitions are not approved, so they are not shown.
 * A value the server did not return stays null and renders as "—", never 0.
 */

export const DASH = '—';

/**
 * Wraps async tasks so no more than `max` run at once; the rest wait in order.
 * A task that fails frees its slot like one that succeeds.
 */
export function limitConcurrency(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const next = () => {
    if (active >= max) return;
    const start = waiting.shift();
    if (!start) return;
    active += 1;
    start();
  };
  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => { active -= 1; next(); });
      });
      next();
    });
  };
}

/** Today in the company time zone, as yyyy-MM-dd. */
export function companyToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function shiftDate(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function longDate(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export function formatTimeOfDay(iso: string | null | undefined): string {
  if (!iso) return DASH;
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return DASH;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function num(value: number | null | undefined): string {
  return value === null || value === undefined ? DASH : value.toLocaleString('en-IN');
}

/** Change against the comparison period. Neutral wording: no good/bad colour without approved polarity. */
export function delta(current: number | null | undefined, previous: number | null | undefined): { text: string; direction: 'up' | 'down' | 'flat' | 'none' } {
  if (current === null || current === undefined || previous === null || previous === undefined) return { text: DASH, direction: 'none' };
  const diff = current - previous;
  if (diff === 0) return { text: 'No change', direction: 'flat' };
  return { text: `${diff > 0 ? '▲' : '▼'} ${Math.abs(diff).toLocaleString('en-IN')}`, direction: diff > 0 ? 'up' : 'down' };
}

/**
 * Console statuses use the stored DailyAttendance vocabulary; colours come from
 * the one employee-facing table (status-presentation.ts) so the console and My
 * Attendance never disagree about what a colour means.
 */
const STATUS_TO_OUTCOME: Record<string, AttendanceOutcome> = {
  PRESENT: 'PRESENT',
  LATE: 'PRESENT',
  LATE_EXEMPTED: 'PRESENT',
  HALF_DAY: 'HALF_DAY',
  ABSENT: 'ABSENT',
  LEAVE: 'LEAVE',
  LWP: 'LWP',
  HOLIDAY: 'HOLIDAY',
  WEEKLY_OFF: 'WEEKLY_OFF',
  MISSING_PUNCH: 'UNRESOLVED',
  PENDING_REGULARIZATION: 'UNRESOLVED',
  GEO_MISMATCH: 'UNRESOLVED',
  FACE_MISSING: 'UNRESOLVED',
};

const STATUS_LABEL: Record<string, string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  LATE_EXEMPTED: 'Late (exempted)',
  HALF_DAY: 'Half day',
  ABSENT: 'Absent',
  LEAVE: 'Leave',
  LWP: 'Unpaid leave',
  HOLIDAY: 'Holiday',
  WEEKLY_OFF: 'Weekly off',
  MISSING_PUNCH: 'Needs review',
  PENDING_REGULARIZATION: 'Needs review',
  GEO_MISMATCH: 'Needs review',
  FACE_MISSING: 'Needs review',
};

export const LATE_PRESENTATION: StatusPresentation = { label: 'Late', shortLabel: 'Late', color: '#C2410C', tint: '#FFEDD5', glyph: '⏱' };
export const NOT_EVALUATED: StatusPresentation = { label: 'No record yet', shortLabel: 'No record', color: '#64748B', tint: '#F1F5F9', glyph: '○' };

export function presentConsoleStatus(status: string | null, evaluationState?: string): StatusPresentation {
  if (!status) return NOT_EVALUATED;
  if (status === 'LATE' || status === 'LATE_EXEMPTED') return { ...LATE_PRESENTATION, label: STATUS_LABEL[status] };
  if (evaluationState === 'NEEDS_REVIEW') return { ...presentOutcome('UNRESOLVED'), label: 'Needs review' };
  const outcome = STATUS_TO_OUTCOME[status];
  const base = outcome ? presentOutcome(outcome) : presentOutcome(null);
  return { ...base, label: STATUS_LABEL[status] ?? base.label };
}

// ── Daily roster filters ─────────────────────────────────────────────────

export type RosterFilter =
  | 'all' | 'present' | 'late' | 'leave' | 'absent' | 'action'
  | 'noRecord' | 'review' | 'missingPunchOut' | 'missingPunch' | 'outsideGeofence';

/**
 * Each filter selects the same people the server counts for the matching tile
 * or Needs attention line (AttendanceConsoleService.summary), so a count and
 * the rows behind it never disagree. "Present" excludes late, as the tile does.
 */
export function matchesRosterFilter(r: RosterRow, f: RosterFilter): boolean {
  const flag = (name: string) => r.exceptionFlags.includes(name);
  switch (f) {
    case 'present': return r.status === 'PRESENT';
    case 'late': return r.status === 'LATE' || r.status === 'LATE_EXEMPTED';
    case 'leave': return r.status === 'LEAVE' || r.status === 'LWP';
    case 'absent': return r.status === 'ABSENT';
    case 'action': return r.requiresReview || r.status === null || r.exceptionFlags.length > 0;
    case 'noRecord': return r.status === null;
    case 'review': return r.requiresReview;
    case 'missingPunchOut': return flag('MISSING_PUNCH_OUT');
    case 'missingPunch': return flag('NO_ATTENDANCE_EVIDENCE') || flag('MISSING_PUNCH');
    case 'outsideGeofence': return flag('LOCATION_OUTSIDE_GEOFENCE');
    default: return true;
  }
}

// ── Period aggregation over the monthly register ─────────────────────────

export interface PeriodTotals {
  employees: number;
  present: number;
  absent: number;
  halfDays: number;
  leave: number;
  late: number;
  unresolved: number;
}

const EMPTY: PeriodTotals = { employees: 0, present: 0, absent: 0, halfDays: 0, leave: 0, late: 0, unresolved: 0 };

export function totalsOf(employees: RegisterEmployee[]): PeriodTotals {
  return employees.reduce<PeriodTotals>((t, e) => ({
    employees: t.employees + 1,
    present: t.present + e.daysPresent,
    absent: t.absent + e.daysAbsent,
    halfDays: t.halfDays + e.halfDays,
    leave: t.leave + e.leaveDays,
    late: t.late + e.latePunchIns,
    unresolved: t.unresolved + e.unresolvedDays,
  }), { ...EMPTY });
}

export function addTotals(a: PeriodTotals, b: PeriodTotals): PeriodTotals {
  return {
    employees: Math.max(a.employees, b.employees),
    present: a.present + b.present,
    absent: a.absent + b.absent,
    halfDays: a.halfDays + b.halfDays,
    leave: a.leave + b.leave,
    late: a.late + b.late,
    unresolved: a.unresolved + b.unresolved,
  };
}

export const NO_DEPARTMENT = 'No department';

export function byDepartment(employees: RegisterEmployee[]): Array<{ department: string } & PeriodTotals> {
  const groups = new Map<string, RegisterEmployee[]>();
  for (const e of employees) {
    const key = e.department || NO_DEPARTMENT;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.entries()]
    .map(([department, list]) => ({ department, ...totalsOf(list) }))
    .sort((a, b) => a.department.localeCompare(b.department));
}

export type DepartmentMetric = 'late' | 'absent' | 'leave' | 'present' | 'halfDays';

export const METRIC_LABEL: Record<DepartmentMetric, string> = {
  late: 'Late arrivals',
  absent: 'Absent days',
  leave: 'Leave days',
  present: 'Present days',
  halfDays: 'Half days',
};

/** Financial-year months (April–March) that have started by `today`, oldest first. */
export function financialYearMonths(fyStartYear: number, today: string): string[] {
  const months: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(Date.UTC(fyStartYear, 3 + i, 1));
    const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (m <= today.slice(0, 7)) months.push(m);
  }
  return months;
}

export function currentFyStartYear(today: string): number {
  const [y, m] = today.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

export function fyLabel(startYear: number): string {
  return `FY ${startYear}–${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function lastMonths(count: number, today: string): string[] {
  const [y, m] = today.split('-').map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export function shortMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { timeZone: 'UTC', month: 'short' });
}

/**
 * Employees with a pattern across several months. Rule is stated on screen:
 * an issue counts as recurring when it appears in at least `minMonths` months.
 */
export function recurringIssues(registers: RegisterResult[], minMonths = 3) {
  const people = new Map<string, { employee: RegisterEmployee; lateMonths: number; absentMonths: number; unresolvedMonths: number }>();
  for (const reg of registers) {
    for (const e of reg.employees) {
      const p = people.get(e.userId) ?? { employee: e, lateMonths: 0, absentMonths: 0, unresolvedMonths: 0 };
      p.employee = e;
      if (e.latePunchIns > 0) p.lateMonths += 1;
      if (e.daysAbsent > 0) p.absentMonths += 1;
      if (e.unresolvedDays > 0) p.unresolvedMonths += 1;
      people.set(e.userId, p);
    }
  }
  const list = [...people.values()];
  return {
    frequentLate: list.filter(p => p.lateMonths >= minMonths),
    repeatedAbsence: list.filter(p => p.absentMonths >= minMonths),
    repeatedUnresolved: list.filter(p => p.unresolvedMonths >= minMonths),
    people: list,
  };
}

/** The register's per-day sheet speaks in report labels ("Approved Leave"); map them to the same colours. */
const HISTORY_STATE: Record<string, string> = {
  'Present': 'PRESENT',
  'Late': 'LATE',
  'Short Hours': 'PRESENT',
  'Half Day': 'HALF_DAY',
  'Absent': 'ABSENT',
  'Approved Leave': 'LEAVE',
  'LWP / Unpaid Leave': 'LWP',
  'Weekly Off': 'WEEKLY_OFF',
  'Holiday': 'HOLIDAY',
  'Holiday Worked': 'HOLIDAY',
  'Needs Review / Unresolved': 'MISSING_PUNCH',
};

export function presentHistoryState(label: string | null): StatusPresentation {
  if (!label) return NOT_EVALUATED;
  const status = HISTORY_STATE[label];
  if (!status) return { ...NOT_EVALUATED, label };
  return { ...presentConsoleStatus(status), label };
}
