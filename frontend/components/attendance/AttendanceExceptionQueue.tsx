'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  actionHref,
  CATEGORY_LABEL,
  getExceptions,
  RESOLVER_LABEL,
  STATE_LABEL,
  type ExceptionCategory,
  type ExceptionItem,
  type ResolutionState,
} from './exception-api';

/**
 * The Attendance Exception Queue (EQ-1).
 *
 * Everything ambiguous or failed in one place, with the authorised way to end
 * it next to it. This screen resolves nothing itself — each row links to the
 * surface that already owns that decision — so there is still exactly one way
 * to change attendance and it is the audited one.
 *
 * A row answers eight questions on purpose: who, when, what is wrong, why it
 * was flagged, the evidence, who may resolve it, what resolves it, and where
 * the resolution currently stands. An exception nobody can act on is just an
 * alarm.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function AttendanceExceptionQueue() {
  const [from, setFrom] = useState(daysAgo(13));
  const [to, setTo] = useState(todayIso());
  const [category, setCategory] = useState('');
  const [state, setState] = useState('');
  const [department, setDepartment] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['attendance-exceptions', from, to, category, state, department],
    queryFn: () =>
      getExceptions({
        from,
        to,
        category: category || undefined,
        state: state || undefined,
        department: department || undefined,
      }),
    staleTime: 30_000,
    retry: false,
  });

  // Department options come from what is actually in the queue. A fixed list
  // would offer filters that select nothing.
  const departments = useMemo(() => {
    const names = new Set<string>();
    for (const i of data?.items ?? []) if (i.employee?.department) names.add(i.employee.department);
    return Array.from(names).sort();
  }, [data]);

  if (isError) {
    const status = (error as any)?.response?.status;
    return (
      <p className="apex-text-muted py-6 text-center text-sm">
        {status === 403
          ? 'Attendance exceptions are visible to HR and to managers with reporting employees.'
          : 'The exception queue could not be loaded.'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="apex-input text-sm"
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="apex-input text-sm"
          />
        </Field>
        <Field label="Problem">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="apex-input text-sm"
          >
            <option value="">All</option>
            {(Object.keys(CATEGORY_LABEL) as ExceptionCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Waiting on">
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="apex-input text-sm"
          >
            <option value="">Anyone</option>
            {(Object.keys(STATE_LABEL) as ResolutionState[]).map((s) => (
              <option key={s} value={s}>
                {STATE_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        {departments.length > 1 && (
          <Field label="Department">
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="apex-input text-sm"
            >
              <option value="">All</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {data && (
        <div className="apex-card">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <Stat label="Open exceptions" value={data.summary.total} />
            <Stat label="Employees affected" value={data.summary.employees} />
            <Stat label="Not started" value={data.summary.byState.OPEN} />
            <Stat label="With the manager" value={data.summary.byState.AWAITING_MANAGER} />
            <Stat label="With HR" value={data.summary.byState.AWAITING_HR} />
            <span className="apex-text-subtle text-[11px]">
              {data.scope === 'COMPANY' ? 'Company-wide' : 'Your team'} · {data.from} to {data.to}
            </span>
          </div>
        </div>
      )}

      {isLoading && (
        <p className="apex-text-muted py-6 text-center text-sm">Loading exceptions…</p>
      )}

      {data && data.items.length === 0 && (
        <div className="apex-card">
          <p className="apex-text text-sm font-medium">Nothing is unresolved in this range.</p>
          <p className="apex-text-muted mt-1 text-xs">
            This counts what the system recorded. Some failures leave no record at all — see below.
          </p>
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className="apex-card overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="apex-text-subtle text-[11px] uppercase tracking-wide">
                <th className="pb-2">Employee</th>
                <th className="pb-2">Date</th>
                <th className="pb-2">Problem</th>
                <th className="pb-2">Who resolves</th>
                <th className="pb-2">Waiting on</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <Row
                  key={item.key}
                  item={item}
                  expanded={expanded === item.key}
                  onToggle={() => setExpanded(expanded === item.key ? null : item.key)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/*
        Stated on the screen, not only in a comment. Somebody looking at an
        empty queue after an employee reported a camera failure has to know
        that no such record exists — otherwise the absence reads as proof
        nothing went wrong.
      */}
      {data && (
        <details className="apex-card">
          <summary className="apex-text cursor-pointer text-sm font-medium">
            What this queue cannot show
          </summary>
          <ul className="mt-2 space-y-2">
            {data.notRepresented.map((n) => (
              <li key={n.what} className="apex-text-muted text-xs">
                <span className="apex-text font-medium">{n.what}.</span> {n.why}
              </li>
            ))}
          </ul>
          <p className="apex-text-subtle mt-3 text-[11px]">
            These reach the queue indirectly: an abandoned phone handoff, or a missing punch once
            the day is evaluated.
          </p>
        </details>
      )}
    </div>
  );
}

function Row({
  item,
  expanded,
  onToggle,
}: {
  item: ExceptionItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const href = actionHref(item);

  return (
    <>
      <tr className="border-t border-[var(--border-secondary)] align-top">
        <td className="py-2 pr-3">
          <span className="apex-text font-medium">{item.employee?.name ?? 'Unknown'}</span>
          <span className="apex-text-subtle block text-[11px]">
            {item.employee?.employeeId ?? '—'}
            {item.employee?.department ? ` · ${item.employee.department}` : ''}
          </span>
        </td>
        <td className="apex-text py-2 pr-3 whitespace-nowrap">{item.businessDate}</td>
        <td className="py-2 pr-3">
          <span className="apex-text font-medium">{CATEGORY_LABEL[item.category]}</span>
          {item.categories.length > 1 && (
            <span className="apex-text-subtle block text-[11px]">
              also {item.categories
                .filter((c) => c !== item.category)
                .map((c) => CATEGORY_LABEL[c])
                .join(', ')}
            </span>
          )}
          <span className="apex-text-muted block text-xs">{item.problem}</span>
        </td>
        <td className="apex-text-muted py-2 pr-3 text-xs whitespace-nowrap">
          {RESOLVER_LABEL[item.resolvableBy]}
        </td>
        <td className="py-2 pr-3">
          <span
            className={[
              'rounded-full px-2 py-0.5 text-[11px] font-medium',
              item.state === 'OPEN'
                ? 'bg-[var(--warning-bg,rgba(234,179,8,.15))] text-[var(--warning,#a16207)]'
                : 'apex-text-muted border border-[var(--border-secondary)]',
            ].join(' ')}
          >
            {STATE_LABEL[item.state]}
          </span>
        </td>
        <td className="py-2 text-right whitespace-nowrap">
          {href && (
            <a
              href={href}
              className="apex-text text-xs font-medium underline underline-offset-2"
            >
              Resolve
            </a>
          )}
          <button
            onClick={onToggle}
            className="apex-text-muted ml-3 text-xs underline underline-offset-2"
          >
            {expanded ? 'Hide' : 'Details'}
          </button>
        </td>
      </tr>

      {expanded && (
        <tr className="border-t border-[var(--border-secondary)]">
          <td colSpan={6} className="py-3">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="apex-text-subtle text-[11px] uppercase tracking-wide">
                  Why it was flagged
                </dt>
                <dd className="apex-text mt-1 text-xs">{item.whyFlagged}</dd>
              </div>
              <div>
                <dt className="apex-text-subtle text-[11px] uppercase tracking-wide">
                  What resolves it
                </dt>
                <dd className="apex-text mt-1 text-xs">{item.resolvingAction.label}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="apex-text-subtle text-[11px] uppercase tracking-wide">
                  Evidence and context
                </dt>
                <dd className="apex-text-muted mt-1 break-all font-mono text-[11px]">
                  {Object.entries(item.evidence)
                    .filter(([, v]) => v !== null && v !== undefined && `${v}` !== '')
                    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                    .join('  ·  ') || 'None recorded.'}
                </dd>
              </div>
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="apex-text-subtle text-[11px] uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="apex-text text-lg font-semibold">{value}</span>
      <span className="apex-text-muted text-xs">{label}</span>
    </span>
  );
}
