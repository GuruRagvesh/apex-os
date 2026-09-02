'use client';

import { useState } from 'react';
import type { ImportRow } from './import-api';
import {
  CLASSIFICATION,
  diffFields,
  displayStatus,
  displayTime,
  explainCode,
  EMPTY,
  type Classification,
  type Tone,
} from './import-presentation';

/**
 * The review table.
 *
 * Everything shown comes from the stored server classification. Nothing is
 * recomputed here — a second implementation of "is this a change?" would
 * eventually disagree with the one that decides what actually gets written.
 */

const TONE_BADGE: Record<Tone, string> = {
  positive: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-300',
  info: 'bg-sky-50 text-sky-700 dark:bg-sky-900/25 dark:text-sky-300',
  neutral: 'bg-[var(--surface-2)] apex-text',
  warn: 'bg-amber-50 text-amber-800 dark:bg-amber-900/25 dark:text-amber-300',
  danger: 'bg-red-50 text-red-700 dark:bg-red-900/25 dark:text-red-300',
  muted: 'apex-text-muted bg-[var(--surface-2)]',
};

export function ClassificationBadge({ value }: { value: string }) {
  const p = CLASSIFICATION[value as Classification];
  const tone = p?.tone ?? 'muted';
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_BADGE[tone]}`}
      title={p?.meaning}
    >
      {p?.label ?? value}
    </span>
  );
}

/**
 * Current beside proposed, with only the fields that moved emphasised.
 *
 * A dash means nothing is recorded — never a substituted 09:30. A historical
 * PRESENT day legitimately has no punches, and inventing them on screen would
 * be the frontend fabricating evidence.
 */
function Comparison({ row }: { row: ImportRow }) {
  const fields = diffFields(row);
  return (
    <div className="space-y-1">
      {fields.map((f) => (
        <div key={f.label} className="grid grid-cols-[5.5rem_1fr_auto_1fr] items-center gap-2 text-xs">
          <span className="apex-text-subtle">{f.label}</span>
          <span className={f.changed ? 'apex-text-muted line-through' : 'apex-text-muted'}>
            {f.current}
          </span>
          <span className="apex-text-subtle" aria-hidden="true">
            →
          </span>
          <span className={f.changed ? 'apex-text font-semibold tabular-nums' : 'apex-text-muted'}>
            {f.proposed}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A NEW row has nothing to compare against, so it is stated rather than diffed. */
function Proposed({ row }: { row: ImportRow }) {
  return (
    <div className="space-y-1 text-xs">
      <div className="apex-text font-medium">{displayStatus(row.proposedStatus)}</div>
      <div className="apex-text-muted tabular-nums">
        {displayTime(row.proposedPunchIn)} – {displayTime(row.proposedPunchOut)}
      </div>
    </div>
  );
}

function Problems({ codes }: { codes: string[] }) {
  if (codes.length === 0) return null;
  return (
    <ul className="space-y-1">
      {codes.map((code) => {
        const e = explainCode(code);
        return (
          <li key={code} className="text-xs">
            <span className="apex-text">{e.message}</span>{' '}
            <span className="apex-text-muted">{e.fix}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function ImportRowTable({ rows }: { rows: ImportRow[] }) {
  // Desktop is primary for bulk review, but the table must not force the page
  // to scroll sideways -- it scrolls inside its own container instead.
  const [expanded, setExpanded] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="apex-text-muted py-8 text-center text-sm">
        No rows match this filter.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-left text-sm">
        <thead>
          <tr className="apex-text-subtle border-b border-[var(--border)] text-[11px] uppercase tracking-wide">
            <th className="py-2 pr-3 font-medium">Employee</th>
            <th className="py-2 pr-3 font-medium">Date</th>
            <th className="py-2 pr-3 font-medium">Current → Proposed</th>
            <th className="py-2 pr-3 font-medium">Result</th>
            <th className="py-2 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isOpen = expanded === row.id;
            const hasDetail = row.messages.length > 0 || row.warnings.length > 0;
            return (
              <tr
                key={row.id}
                className="border-b border-[var(--border)] align-top last:border-0"
              >
                <td className="py-2.5 pr-3">
                  <div className="apex-text font-medium">{row.rawEmployeeId}</div>
                  {row.rawName && (
                    <div className="apex-text-muted text-xs">{row.rawName}</div>
                  )}
                </td>
                <td className="apex-text-muted py-2.5 pr-3 whitespace-nowrap text-xs tabular-nums">
                  {row.businessDate?.slice(0, 10) ?? row.rawDate ?? EMPTY}
                </td>
                <td className="py-2.5 pr-3">
                  {row.classification === 'CHANGE' ? (
                    <Comparison row={row} />
                  ) : (
                    <Proposed row={row} />
                  )}
                </td>
                <td className="py-2.5 pr-3">
                  <ClassificationBadge value={row.classification} />
                </td>
                <td className="py-2.5">
                  {hasDetail ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : row.id)}
                        aria-expanded={isOpen}
                        className="apex-text-muted text-xs underline underline-offset-2"
                      >
                        {isOpen ? 'Hide' : `${row.messages.length + row.warnings.length} note(s)`}
                      </button>
                      {isOpen && (
                        <div className="mt-1.5 space-y-1.5">
                          <Problems codes={row.messages} />
                          <Problems codes={row.warnings} />
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="apex-text-subtle text-xs">{EMPTY}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
