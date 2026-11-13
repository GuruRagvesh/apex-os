'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRoster, getSummary } from '../console-api';
import { presentOutcome } from '../../attendance-v2/status-presentation';
import {
  DASH, LATE_PRESENTATION, NOT_EVALUATED, delta, formatDuration, formatTimeOfDay, matchesRosterFilter as matches, num,
  presentConsoleStatus, shiftDate, type RosterFilter,
} from './analytics-data';
import { Card, Empty, Insight, Kpi, LoadError, Person, Skeleton, StatusBadge } from './AnalyticsUi';
import { PersonDayPanel } from './PersonDayPanel';
import s from './analytics.module.css';

const FILTERS: Array<{ key: RosterFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'present', label: 'Present' },
  { key: 'late', label: 'Late' },
  { key: 'leave', label: 'Leave' },
  { key: 'absent', label: 'Absent' },
  { key: 'action', label: 'Needs action' },
];

/** Filters reached from the Needs attention list, which have no segment button. */
const NARROWED_LABEL: Partial<Record<RosterFilter, string>> = {
  noRecord: 'No record yet',
  review: 'Needs review',
  missingPunchOut: 'Missing punch-out',
  missingPunch: 'Missing punch',
  outsideGeofence: 'Outside geofence',
};

const PAGE_SIZE = 200;

export function DailyAnalytics({ date, isHr, onOpenReviews }: { date: string; isHr: boolean; onOpenReviews: () => void }) {
  const [filter, setFilter] = useState<RosterFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const summary = useQuery({ queryKey: ['analytics-summary', date], queryFn: () => getSummary(date), retry: false });
  const previous = useQuery({ queryKey: ['analytics-summary', shiftDate(date, -1)], queryFn: () => getSummary(shiftDate(date, -1)), retry: false });
  const roster = useQuery({
    queryKey: ['analytics-roster', date, page],
    queryFn: () => getRoster({ businessDate: date, page, limit: PAGE_SIZE }),
    retry: false,
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (roster.data?.rows ?? []).filter(r => matches(r, filter)).filter(r => !q
      || r.employee.name.toLowerCase().includes(q)
      || (r.employee.department?.name ?? '').toLowerCase().includes(q));
  }, [roster.data, filter, search]);

  const lateByDept = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of roster.data?.rows ?? []) {
      if (r.status === 'LATE' || r.status === 'LATE_EXEMPTED') {
        const d = r.employee.department?.name ?? 'No department';
        counts.set(d, (counts.get(d) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  }, [roster.data]);

  const sm = summary.data;
  const pv = previous.data;
  const vs = (a?: number, b?: number) => `${delta(a, b).text} vs yesterday`;
  const selectedIndex = rows.findIndex(r => r.employee.id === selectedId);
  const selected = selectedIndex >= 0 ? rows[selectedIndex] : null;

  // Each line filters the table to exactly the people it counts. Pending
  // corrections span every date, so that line opens Reviews; setup problems
  // come from the processing run and have no roster row, so that line is text.
  const attention: Array<{ label: string; value: number | null | undefined; onSelect?: () => void }> = sm ? [
    { label: 'No record yet', value: sm.notEvaluated, onSelect: () => setFilter('noRecord') },
    { label: 'Needs review', value: sm.needsReview, onSelect: () => setFilter('review') },
    { label: 'Missing punch-out', value: sm.exceptions.missingPunchOut, onSelect: () => setFilter('missingPunchOut') },
    { label: 'Missing punch', value: sm.exceptions.missingPunch, onSelect: () => setFilter('missingPunch') },
    { label: 'Outside geofence', value: sm.exceptions.outsideGeofence, onSelect: () => setFilter('outsideGeofence') },
    { label: 'Corrections pending', value: sm.exceptions.regularizationPending, onSelect: onOpenReviews },
    ...(isHr ? [{ label: 'Setup incomplete', value: sm.exceptions.configurationBlocked }] : []),
  ] : [];
  const narrowedBy = NARROWED_LABEL[filter];

  const table = (
    <Card
      table
      title={`Employee records (${num(roster.data?.total)})`}
      sub={narrowedBy ? `Showing: ${narrowedBy} · select All to clear` : 'Select a row to see the day'}
      right={(
        <div className={s.actions}>
          <div className={s.segment} role="group" aria-label="Filter records">
            {FILTERS.map(f => (
              <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>
            ))}
          </div>
          <input className={s.input} type="search" placeholder="Search name or department" aria-label="Search employees" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      )}
    >
      {roster.isError ? <div style={{ padding: 20 }}><LoadError what="Employee records" onRetry={() => roster.refetch()} /></div>
        : roster.isLoading ? <div style={{ padding: 20 }}><Skeleton height={240} /></div>
          : rows.length === 0 ? <div style={{ padding: 20 }}><Empty title="No employees match" text="Change the filter or search." /></div>
            : (
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th scope="col">Employee</th><th scope="col">Department</th><th scope="col">Status</th>
                      <th scope="col" className={s.num}>First in</th><th scope="col" className={s.num}>Last out</th>
                      <th scope="col" className={s.num}>Worked</th><th scope="col">Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const p = presentConsoleStatus(r.status, r.evaluationState);
                      const pendingState = r.status && r.evaluationState === 'CALCULATED';
                      return (
                        <tr
                          key={r.employee.id}
                          className={s.row}
                          tabIndex={0}
                          aria-selected={r.employee.id === selectedId}
                          onClick={() => setSelectedId(r.employee.id)}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(r.employee.id); } }}
                        >
                          <td><Person name={r.employee.name} sub={r.employee.employeeId} /></td>
                          <td>{r.employee.department?.name ?? DASH}</td>
                          <td>
                            <StatusBadge p={p} />
                            {pendingState && <span className={s.subtle}>Calculated · may change</span>}
                          </td>
                          <td className={s.num}>{formatTimeOfDay(r.punchInAt)}</td>
                          <td className={s.num}>{r.punchInAt && !r.punchOutAt ? 'Pending' : formatTimeOfDay(r.punchOutAt)}</td>
                          <td className={s.num}>{formatDuration(r.workedMinutes)}</td>
                          <td>{r.exceptionFlags.length ? <span className={s.flag} title={r.exceptionFlags.join(', ')}>! {r.exceptionFlags.length}</span> : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
      {roster.data && roster.data.total > PAGE_SIZE && (
        <div className={s.panelFoot} style={{ padding: '0 20px 16px' }}>
          <button type="button" className={s.button} disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
          <button type="button" className={s.button} disabled={page * PAGE_SIZE >= roster.data.total} onClick={() => setPage(p => p + 1)}>Next</button>
        </div>
      )}
    </Card>
  );

  return (
    <>
      {summary.isError ? <LoadError what="Today’s counts" onRetry={() => summary.refetch()} /> : (
        <div className={s.kpis}>
          <Kpi label="Present" value={num(sm?.present)} sub={vs(sm?.present, pv?.present)} tone={presentOutcome('PRESENT')} />
          <Kpi label="Absent" value={num(sm?.absent)} sub={vs(sm?.absent, pv?.absent)} tone={presentOutcome('ABSENT')} />
          <Kpi label="Late arrivals" value={num(sm?.late)} sub={vs(sm?.late, pv?.late)} tone={LATE_PRESENTATION} />
          <Kpi label="Needs review" value={num(sm?.needsReview)} sub={vs(sm?.needsReview, pv?.needsReview)} tone={presentOutcome('UNRESOLVED')} />
          <Kpi label="On leave" value={num(sm ? sm.leave + sm.lwp : undefined)} sub={vs(sm ? sm.leave + sm.lwp : undefined, pv ? pv.leave + pv.lwp : undefined)} tone={presentOutcome('LEAVE')} />
          <Kpi label="Expected" value={num(sm?.expectedEmployees)} sub={`${num(sm ? sm.holiday + sm.weeklyOff : undefined)} off · ${num(sm?.notEvaluated)} no record`} tone={NOT_EVALUATED} />
        </div>
      )}

      {sm && (
        <Insight title="Today’s insight">
          <strong>{num(sm.needsReview)}</strong> need review ({delta(sm.needsReview, pv?.needsReview).text} vs yesterday).{' '}
          Missing punch-outs: <strong>{num(sm.exceptions.missingPunchOut)}</strong>.{' '}
          {lateByDept ? <>Most late arrivals: <strong>{lateByDept[0]}</strong> ({lateByDept[1]}).</> : 'No late arrivals recorded yet.'}
        </Insight>
      )}

      {selected ? (
        <div className={s.withPanel}>
          {table}
          <PersonDayPanel
            key={`${selected.employee.id}-${date}`}
            person={{ id: selected.employee.id, name: selected.employee.name, department: selected.employee.department?.name ?? null, employeeId: selected.employee.employeeId }}
            date={date}
            isHr={isHr}
            onClose={() => setSelectedId(null)}
            onPrev={selectedIndex > 0 ? () => setSelectedId(rows[selectedIndex - 1].employee.id) : undefined}
            onNext={selectedIndex < rows.length - 1 ? () => setSelectedId(rows[selectedIndex + 1].employee.id) : undefined}
            onOpenReviews={onOpenReviews}
          />
        </div>
      ) : table}

      <div className={s.grid}>
        <div className={s.span12}>
          <Card title={isHr ? 'Needs attention' : 'Your actions'} sub="Select a line to show those people in the table">
            {summary.isLoading ? <Skeleton height={160} /> : (
              <ul className={s.list} style={{ columns: 2, columnGap: 32 }}>
                {attention.map(a => (
                  <li key={a.label} style={{ breakInside: 'avoid' }}>
                    {a.onSelect ? (
                      <button type="button" className={s.listButton} onClick={a.onSelect}>
                        <span>{a.label}</span><b>{num(a.value)}</b>
                      </button>
                    ) : (
                      <span className={s.listButton} style={{ cursor: 'default' }}><span>{a.label}</span><b>{num(a.value)}</b></span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
