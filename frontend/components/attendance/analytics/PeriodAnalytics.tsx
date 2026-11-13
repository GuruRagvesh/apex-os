'use client';

import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getRegister, type RegisterResult } from '../console-api';
import { monthLabel, monthRange, shiftMonth } from '../register-month';
import { presentOutcome } from '../../attendance-v2/status-presentation';
import {
  DASH, LATE_PRESENTATION, METRIC_LABEL, NOT_EVALUATED, addTotals, byDepartment, delta, limitConcurrency, num, recurringIssues,
  shortMonth, totalsOf, type DepartmentMetric, type PeriodTotals,
} from './analytics-data';
import { Card, Empty, HBars, Insight, Kpi, Legend, LoadError, Person, Skeleton } from './AnalyticsUi';
import s from './analytics.module.css';

const C = {
  present: presentOutcome('PRESENT'),
  half: presentOutcome('HALF_DAY'),
  leave: presentOutcome('LEAVE'),
  absent: presentOutcome('ABSENT'),
  review: presentOutcome('UNRESOLVED'),
};
const RAMP = ['#eff6ff', '#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a'];

// Each register reads a whole month into server memory. Yearly and Overall ask
// for 12 at once, which ran the 512 MB staging backend out of memory, so every
// register request from this page (first load, refetch, filter change) waits
// its turn: at most two run at the same time.
const oneRegisterAtATime = limitConcurrency(2);

function registerQuery(month: string) {
  const r = monthRange(month);
  return {
    queryKey: ['console-register', month],
    queryFn: () => oneRegisterAtATime(() => getRegister(r.from, r.to)),
    staleTime: 60_000,
    retry: false,
  };
}

function useRegisters(months: string[]) {
  const results = useQueries({ queries: months.map(registerQuery) });
  const loading = results.some(r => r.isLoading);
  const failed = results.some(r => r.isError);
  const data = results.map(r => r.data).filter((d): d is RegisterResult => !!d);
  return { loading, failed, data, retry: () => results.forEach(r => r.isError && r.refetch()) };
}

function PeriodKpis({ t, prev, vsLabel }: { t: PeriodTotals | null; prev?: PeriodTotals | null; vsLabel?: string }) {
  const sub = (key: keyof PeriodTotals, fallback: string) => (vsLabel && prev !== undefined ? `${delta(t?.[key], prev?.[key]).text} vs ${vsLabel}` : fallback);
  return (
    <div className={s.kpis}>
      <Kpi label="Present days" value={num(t?.present)} sub={sub('present', 'Person-days')} tone={C.present} />
      <Kpi label="Absent days" value={num(t?.absent)} sub={sub('absent', 'Evaluated only')} tone={C.absent} />
      <Kpi label="Late arrivals" value={num(t?.late)} sub={sub('late', 'Late days')} tone={LATE_PRESENTATION} />
      <Kpi label="Leave days" value={num(t?.leave)} sub={sub('leave', 'Approved leave')} tone={C.leave} />
      <Kpi label="Half days" value={num(t?.halfDays)} sub={sub('halfDays', 'Person-days')} tone={C.half} />
      <Kpi label="Unresolved days" value={num(t?.unresolved)} sub="Not yet settled" tone={NOT_EVALUATED} />
    </div>
  );
}

function MetricSelect({ value, onChange }: { value: DepartmentMetric; onChange: (m: DepartmentMetric) => void }) {
  return (
    <select className={s.input} aria-label="Measure" value={value} onChange={e => onChange(e.target.value as DepartmentMetric)}>
      {(Object.keys(METRIC_LABEL) as DepartmentMetric[]).map(m => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
    </select>
  );
}

function DepartmentComparison({ employees }: { employees: RegisterResult['employees'] }) {
  const [metric, setMetric] = useState<DepartmentMetric>('late');
  const rows = byDepartment(employees).map(d => ({ label: d.department, value: d[metric] })).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return (
    <Card title="Department comparison" sub="Counts per department" right={<MetricSelect value={metric} onChange={setMetric} />}>
      <HBars rows={rows} unit={METRIC_LABEL[metric]} />
    </Card>
  );
}

function TopList({ title, sub, items, valueLabel }: { title: string; sub: string; items: Array<{ id: string; name: string; department: string | null; value: string }>; valueLabel: string }) {
  return (
    <Card title={title} sub={sub}>
      {items.length === 0 ? <Empty title="No one to list" /> : (
        <ul className={s.list} aria-label={title}>
          {items.map((it, i) => (
            <li key={it.id}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className={s.subtle} style={{ width: 16 }}>{i + 1}</span>
                <Person name={it.name} sub={it.department} />
              </span>
              <b aria-label={valueLabel}>{it.value}</b>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Monthly ─────────────────────────────────────────────────────────────

export function MonthlyAnalytics({ month }: { month: string }) {
  const prevMonth = shiftMonth(month, -1);
  const current = useQuery(registerQuery(month));
  const previous = useQuery(registerQuery(prevMonth));
  const reg = current.data;

  if (current.isError) return <LoadError what="The month" onRetry={() => current.refetch()} />;
  if (current.isLoading || !reg) return <Skeleton height={480} />;

  const t = totalsOf(reg.employees);
  const pt = previous.data ? totalsOf(previous.data.employees) : null;
  const depts = byDepartment(reg.employees);
  const mostAbsent = [...depts].sort((a, b) => b.absent - a.absent)[0];
  const late = [...reg.employees].filter(e => e.latePunchIns > 0).sort((a, b) => b.latePunchIns - a.latePunchIns).slice(0, 5);
  const review = reg.employees.filter(e => e.unresolvedDays > 0).sort((a, b) => b.unresolvedDays - a.unresolvedDays).slice(0, 5);

  return (
    <>
      <PeriodKpis t={t} prev={pt} vsLabel={monthLabel(prevMonth)} />
      <Insight title="Monthly insight">
        Late arrivals <strong>{delta(t.late, pt?.late).text}</strong> vs {monthLabel(prevMonth)}.{' '}
        {mostAbsent && mostAbsent.absent > 0 ? <>Most absences: <strong>{mostAbsent.department}</strong> ({mostAbsent.absent}).</> : 'No absences recorded.'}{' '}
        {reg.provisional ? 'Figures can still change until the month is finalized.' : 'All figures are settled.'}
      </Insight>
      <div className={s.grid}>
        <div className={s.span8}>
          <Card table title="By department" sub="Person-days · per-employee detail is in the Monthly Register">
            {depts.length === 0 ? <div style={{ padding: 20 }}><Empty title="No employees in this scope" /></div> : (
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead><tr>
                    <th scope="col">Department</th><th scope="col" className={s.num}>Employees</th><th scope="col" className={s.num}>Present</th>
                    <th scope="col" className={s.num}>Absent</th><th scope="col" className={s.num}>Half</th><th scope="col" className={s.num}>Leave</th>
                    <th scope="col" className={s.num}>Late</th><th scope="col" className={s.num}>Unresolved</th>
                  </tr></thead>
                  <tbody>
                    {depts.map(d => (
                      <tr key={d.department}>
                        <td>{d.department}</td><td className={s.num}>{d.employees}</td><td className={s.num}>{d.present}</td>
                        <td className={s.num}>{d.absent}</td><td className={s.num}>{d.halfDays}</td><td className={s.num}>{d.leave}</td>
                        <td className={s.num}>{d.late}</td><td className={s.num}>{d.unresolved}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <div className={s.span4}>
          <TopList title="Most late arrivals" sub="Late days this month" valueLabel="Late days"
            items={late.map(e => ({ id: e.userId, name: e.name, department: e.department, value: String(e.latePunchIns) }))} />
        </div>
        <div className={s.span6}><DepartmentComparison employees={reg.employees} /></div>
        <div className={s.span6}>
          <TopList title="Employees needing review" sub="Days not yet settled" valueLabel="Unresolved days"
            items={review.map(e => ({ id: e.userId, name: e.name, department: e.department, value: `${e.unresolvedDays} day${e.unresolvedDays === 1 ? '' : 's'}` }))} />
        </div>
      </div>
    </>
  );
}

// ── Yearly and Overall share the multi-month view ───────────────────────

function Heatmap({ registers, months }: { registers: RegisterResult[]; months: string[] }) {
  const [metric, setMetric] = useState<DepartmentMetric>('absent');
  const byMonth = new Map(registers.map(r => [r.month, byDepartment(r.employees)]));
  const departments = [...new Set(registers.flatMap(r => r.employees.map(e => e.department || 'No department')))].sort();
  const values = departments.map(d => months.map(m => byMonth.get(m)?.find(x => x.department === d)?.[metric] ?? null));
  const max = Math.max(1, ...values.flat().map(v => v ?? 0));
  const shade = (v: number | null) => (v === null ? 'var(--bg-tertiary)' : RAMP[Math.min(4, Math.floor((v / max) * 4.999))]);
  return (
    <Card title="Monthly heatmap by department" sub={`${METRIC_LABEL[metric]} per month · darker is more`} right={<MetricSelect value={metric} onChange={setMetric} />}>
      {departments.length === 0 ? <Empty title="No departments in this scope" /> : (
        <div className={s.tableWrap}>
          <div className={s.heat} role="table" aria-label={`${METRIC_LABEL[metric]} by department and month`}
            style={{ gridTemplateColumns: `140px repeat(${months.length}, minmax(32px, 1fr)) 56px`, minWidth: 560 }}>
            <span role="columnheader" />
            {months.map(m => <span key={m} role="columnheader" className={s.heatHead}>{shortMonth(m)}</span>)}
            <span role="columnheader" className={s.heatHead}>Total</span>
            {departments.map((d, i) => (
              <div key={d} role="row" style={{ display: 'contents' }}>
                <span role="rowheader" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d}</span>
                {values[i].map((v, j) => (
                  <span key={months[j]} role="cell" className={s.heatCell} title={`${d} · ${monthLabel(months[j])}: ${v ?? DASH}`}
                    style={{ background: shade(v), color: v !== null && v / max > 0.5 ? '#fff' : 'var(--text-primary)' }}>{v ?? ''}</span>
                ))}
                <b role="cell" style={{ textAlign: 'right', fontSize: 13 }}>{num(values[i].reduce<number>((a, v) => a + (v ?? 0), 0))}</b>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className={s.scale}>Fewer {RAMP.map(c => <i key={c} style={{ background: c }} />)} More</div>
    </Card>
  );
}

function MonthTrend({ registers, months }: { registers: RegisterResult[]; months: string[] }) {
  const data = months.map(m => {
    const r = registers.find(x => x.month === m);
    const t = r ? totalsOf(r.employees) : null;
    return { month: shortMonth(m), Present: t?.present ?? null, 'Half day': t?.halfDays ?? null, Leave: t?.leave ?? null, Absent: t?.absent ?? null };
  });
  return (
    <Card title="Person-days by month" sub="Stacked counts · one axis">
      <Legend items={[{ label: 'Present', color: C.present.color }, { label: 'Half day', color: C.half.color }, { label: 'Leave', color: C.leave.color }, { label: 'Absent', color: C.absent.color }]} />
      <div style={{ height: 240 }} role="img" aria-label="Person-days by month, stacked by status">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -16 }}>
            <CartesianGrid vertical={false} stroke="var(--border-primary)" />
            <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: 'var(--border-secondary)' }} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} allowDecimals={false} />
            <Tooltip cursor={{ fill: 'var(--accent-subtle)' }} contentStyle={{ borderRadius: 8, border: '1px solid var(--border-primary)', background: 'var(--surface-elevated)', fontSize: 12 }} />
            <Bar dataKey="Present" stackId="a" fill={C.present.color} maxBarSize={40} />
            <Bar dataKey="Half day" stackId="a" fill={C.half.color} maxBarSize={40} />
            <Bar dataKey="Leave" stackId="a" fill={C.leave.color} maxBarSize={40} />
            <Bar dataKey="Absent" stackId="a" fill={C.absent.color} maxBarSize={40} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function YearlyAnalytics({ months, label }: { months: string[]; label: string }) {
  const regs = useRegisters(months);
  const totals = useMemo(() => regs.data.reduce<PeriodTotals | null>((acc, r) => (acc ? addTotals(acc, totalsOf(r.employees)) : totalsOf(r.employees)), null), [regs.data]);
  if (regs.failed) return <LoadError what={`Months in ${label}`} onRetry={regs.retry} />;
  if (regs.loading) return <Skeleton height={480} />;
  if (!months.length) return <Empty title="This year has not started yet" />;

  const latest = regs.data[regs.data.length - 1];
  const leaveBusiest = [...regs.data].sort((a, b) => totalsOf(b.employees).leave - totalsOf(a.employees).leave)[0];
  const provisional = regs.data.filter(r => r.provisional).length;

  return (
    <>
      <PeriodKpis t={totals} />
      <div className={s.grid}>
        <div className={s.span8}><MonthTrend registers={regs.data} months={months} /></div>
        <div className={s.span4}><DepartmentComparison employees={latest?.employees ?? []} /></div>
        <div className={s.span12}><Heatmap registers={regs.data} months={months} /></div>
      </div>
      <Insight title="Key takeaways">
        Busiest leave month: <strong>{leaveBusiest ? monthLabel(leaveBusiest.month) : DASH}</strong>.{' '}
        Months that can still change: <strong>{provisional}</strong> of {regs.data.length}.{' '}
        Department comparison shows {latest ? monthLabel(latest.month) : DASH}.
      </Insight>
    </>
  );
}

export function OverallAnalytics({ months }: { months: string[] }) {
  const regs = useRegisters(months);
  const totals = useMemo(() => regs.data.reduce<PeriodTotals | null>((acc, r) => (acc ? addTotals(acc, totalsOf(r.employees)) : totalsOf(r.employees)), null), [regs.data]);
  if (regs.failed) return <LoadError what="The last 12 months" onRetry={regs.retry} />;
  if (regs.loading) return <Skeleton height={480} />;

  const rec = recurringIssues(regs.data, 3);
  const flagged = rec.people
    .filter(p => p.lateMonths >= 3 || p.absentMonths >= 3 || p.unresolvedMonths >= 3)
    .sort((a, b) => (b.lateMonths + b.absentMonths + b.unresolvedMonths) - (a.lateMonths + a.absentMonths + a.unresolvedMonths));
  const allEmployees = regs.data.flatMap(r => r.employees);
  const depts = byDepartment(allEmployees);
  const issueChip = (text: string) => <span key={text} className={s.badge} style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', textTransform: 'none', letterSpacing: 0, fontSize: 12, fontWeight: 600 }}>{text}</span>;

  return (
    <>
      <PeriodKpis t={totals} />
      <Insight title="Overall insight">
        <strong>{flagged.length}</strong> people show a recurring issue (in 3 or more of the last {months.length} months).{' '}
        Frequent late arrivals: <strong>{rec.frequentLate.length}</strong>. Repeated absences: <strong>{rec.repeatedAbsence.length}</strong>.
      </Insight>
      <div className={s.grid}>
        <div className={s.span4}><DepartmentComparison employees={allEmployees} /></div>
        <div className={s.span4}>
          <Card title="Breakdown by department" sub="Person-days: present, leave, absent">
            <Legend items={[{ label: 'Present', color: C.present.color }, { label: 'Leave', color: C.leave.color }, { label: 'Absent', color: C.absent.color }]} />
            {depts.length === 0 ? <Empty title="No departments in this scope" /> : depts.map(d => {
              const total = d.present + d.leave + d.absent;
              return (
                <div key={d.department} className={s.hbar} style={{ gridTemplateColumns: 'minmax(96px,140px) 1fr' }} title={`${d.department}: present ${d.present}, leave ${d.leave}, absent ${d.absent}`}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.department}</span>
                  <span className={s.stack} aria-label={`Present ${d.present}, leave ${d.leave}, absent ${d.absent}`}>
                    {total > 0 && <>
                      <span style={{ flex: d.present, background: C.present.color }} />
                      <span style={{ flex: d.leave, background: C.leave.color }} />
                      <span style={{ flex: d.absent, background: C.absent.color }} />
                    </>}
                  </span>
                </div>
              );
            })}
          </Card>
        </div>
        <div className={s.span4}>
          <Card title="Recurring issues" sub="People with the issue in 3+ months">
            <ul className={s.list}>
              <li><span>Frequent late arrivals</span><b>{rec.frequentLate.length}</b></li>
              <li><span>Repeated absences</span><b>{rec.repeatedAbsence.length}</b></li>
              <li><span>Days left unresolved</span><b>{rec.repeatedUnresolved.length}</b></li>
            </ul>
          </Card>
        </div>
      </div>
      <Card table title={`Employees needing attention (${flagged.length})`} sub={`Recurring issues across the last ${months.length} months`}>
        {flagged.length === 0 ? <div style={{ padding: 20 }}><Empty title="No recurring issues" text="No one has the same issue in 3 or more months." /></div> : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th scope="col">Employee</th><th scope="col">Department</th><th scope="col">Issues</th><th scope="col" className={s.num}>Months late</th><th scope="col" className={s.num}>Months absent</th></tr></thead>
              <tbody>
                {flagged.slice(0, 50).map(p => (
                  <tr key={p.employee.userId}>
                    <td><Person name={p.employee.name} sub={p.employee.employeeId} /></td>
                    <td>{p.employee.department ?? DASH}</td>
                    <td style={{ display: 'flex', gap: 4, alignItems: 'center', height: 48 }}>
                      {p.lateMonths >= 3 && issueChip('Frequent late arrivals')}
                      {p.absentMonths >= 3 && issueChip('Repeated absences')}
                      {p.unresolvedMonths >= 3 && issueChip('Unresolved days')}
                    </td>
                    <td className={s.num}>{p.lateMonths}</td>
                    <td className={s.num}>{p.absentMonths}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
