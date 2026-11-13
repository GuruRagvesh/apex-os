'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Clock, MapPin, Activity, ShieldCheck, RotateCcw, X } from 'lucide-react';
import { getDayDetail, getRegisterEmployeeDays } from '../console-api';
import { reasonText } from '../attendance-status';
import { stageLabel, type RegularizationStatus } from '../regularization-api';
import { monthRange } from '../register-month';
import { DASH, formatDuration, formatTimeOfDay, longDate, presentConsoleStatus, presentHistoryState } from './analytics-data';
import { initials, LoadError, StatusBadge } from './AnalyticsUi';
import s from './analytics.module.css';

/** The subset of GET /attendance/console/detail this panel reads. */
interface DayDetail {
  businessDate: string;
  official: {
    status: string | null;
    evaluationState: string;
    calculationReason: string | null;
    exceptionFlags: string[];
    punchInAt: string | null;
    punchOutAt: string | null;
    presenceSpanMinutes: number | null;
    effectiveWorkMinutes: number | null;
    breakMinutes: number | null;
    lateMinutes: number | null;
    locked: boolean;
  } | null;
  punchEvidence: Array<{
    id: string;
    type: string;
    serverOccurredAt: string;
    locationVerification: string | null;
    photoCaptured: boolean;
    accuracyMeters: number | null;
  }>;
  workSessions: Array<{ id: string; startWorkAt: string | null; logoutAt: string | null; status: string; autoClosed: boolean }>;
  regularizations: Array<{ id: string; status: RegularizationStatus; applicationStatus?: string | null; reason: string; requestedPunchIn: string | null; requestedPunchOut: string | null }>;
}

const LOCATION_TEXT: Record<string, string> = {
  VERIFIED: 'Inside an approved location',
  NOT_ENFORCED: 'Location captured',
  OUTSIDE_GEOFENCE: 'Outside the approved location',
  PENDING: 'Location check pending',
};

const PENDING_CORRECTION: RegularizationStatus[] = ['PENDING', 'STALE_REVIEW_REQUIRED', 'MANAGER_APPROVED'] as RegularizationStatus[];

export function PersonDayPanel({
  person, date, isHr, onClose, onPrev, onNext, onOpenReviews,
}: {
  person: { id: string; name: string; department: string | null; employeeId: string | null };
  date: string;
  isHr: boolean;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onOpenReviews: () => void;
}) {
  const [tab, setTab] = useState<'day' | 'history'>('day');
  const detail = useQuery({
    queryKey: ['attendance-analytics-day', person.id, date],
    queryFn: () => getDayDetail(person.id, date) as Promise<DayDetail>,
    retry: false,
  });
  const month = date.slice(0, 7);
  const range = monthRange(month);
  const history = useQuery({
    queryKey: ['attendance-analytics-history', person.id, month],
    queryFn: () => getRegisterEmployeeDays(person.id, range.from, range.to),
    enabled: tab === 'history',
    retry: false,
  });

  const official = detail.data?.official ?? null;
  const p = presentConsoleStatus(official?.status ?? null, official?.evaluationState);
  const settled = official?.evaluationState === 'FINALIZED' && official.locked;
  const pending = detail.data?.regularizations.find(r => PENDING_CORRECTION.includes(r.status));
  const punchIn = detail.data?.punchEvidence.find(e => e.type === 'PUNCH_IN' || e.type === 'IN');
  const punchOut = [...(detail.data?.punchEvidence ?? [])].reverse().find(e => e.type === 'PUNCH_OUT' || e.type === 'OUT');

  return (
    <aside className={s.panel} aria-label={`Attendance for ${person.name}`}>
      <div className={s.panelHead}>
        <span className={s.avatarLarge} aria-hidden="true">{initials(person.name)}</span>
        <div>
          <b>{person.name}</b>
          <span className={s.subtle}>{[person.department, person.employeeId].filter(Boolean).join(' · ') || DASH}</span>
        </div>
        <button type="button" className={s.iconButton} aria-label="Previous person" onClick={onPrev} disabled={!onPrev}><ChevronLeft /></button>
        <button type="button" className={s.iconButton} aria-label="Next person" onClick={onNext} disabled={!onNext}><ChevronRight /></button>
        <button type="button" className={s.iconButton} aria-label="Close" onClick={onClose}><X /></button>
      </div>

      <div className={s.tabs} role="tablist" aria-label="Person details">
        <button type="button" role="tab" aria-selected={tab === 'day'} onClick={() => setTab('day')}>Day details</button>
        <button type="button" role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>Attendance history</button>
      </div>

      {tab === 'day' ? (
        <>
          <h3 className={s.panelDate}>{longDate(date)}</h3>
          {detail.isError ? (
            <div style={{ marginTop: 16 }}><LoadError what="This day" onRetry={() => detail.refetch()} /></div>
          ) : detail.isLoading ? (
            <p className={s.why}>Loading…</p>
          ) : (
            <>
              <div className={s.badges}>
                <StatusBadge p={p} />
                {official && !settled && official.evaluationState !== 'NEEDS_REVIEW' && (
                  <span className={s.badge} style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>Calculated</span>
                )}
                {pending && <span className={s.badge} style={{ background: '#FFFBEB', color: '#B45309' }}>Correction pending</span>}
              </div>
              {official?.calculationReason && <p className={s.why}>{reasonText(official.calculationReason)}</p>}

              <div className={s.sections}>
                {pending && (
                  <section className={s.section}>
                    <header><RotateCcw aria-hidden="true" />Correction request</header>
                    <div>
                      <dl className={s.facts}>
                        <div><dt>Requested in</dt><dd>{formatTimeOfDay(pending.requestedPunchIn)}</dd></div>
                        <div><dt>Requested out</dt><dd>{formatTimeOfDay(pending.requestedPunchOut)}</dd></div>
                      </dl>
                      <p className={s.why}>{pending.reason || DASH} · {stageLabel(pending.status, pending.applicationStatus)}</p>
                    </div>
                  </section>
                )}
                <section className={s.section}>
                  <header><Clock aria-hidden="true" />Day summary</header>
                  <div>
                    <dl className={s.facts}>
                      <div><dt>Punch in</dt><dd>{formatTimeOfDay(official?.punchInAt)}</dd></div>
                      <div><dt>Punch out</dt><dd>{formatTimeOfDay(official?.punchOutAt)}</dd></div>
                      <div><dt>Presence</dt><dd>{formatDuration(official?.presenceSpanMinutes)}</dd></div>
                      <div><dt>Worked</dt><dd>{formatDuration(official?.effectiveWorkMinutes)}</dd></div>
                      <div><dt>Break</dt><dd>{formatDuration(official?.breakMinutes)}</dd></div>
                      <div><dt>Late by</dt><dd>{official?.lateMinutes ? formatDuration(official.lateMinutes) : DASH}</dd></div>
                    </dl>
                  </div>
                </section>
                <section className={s.section}>
                  <header><MapPin aria-hidden="true" />Evidence</header>
                  <div>
                    {punchIn || punchOut ? (
                      <div className={s.punches}>
                        {[{ label: 'Punch in', e: punchIn }, { label: 'Punch out', e: punchOut }].map(({ label, e }) => (
                          <div key={label} className={s.punch}>
                            <b>{label}<span>{formatTimeOfDay(e?.serverOccurredAt)}</span></b>
                            {e ? (
                              <>
                                {LOCATION_TEXT[e.locationVerification ?? ''] ?? 'Location not recorded'}
                                {e.accuracyMeters !== null && <><br />GPS accuracy ±{Math.round(e.accuracyMeters)} m</>}
                                <br />{e.photoCaptured ? 'Photo captured' : 'No photo'}
                              </>
                            ) : 'Not recorded'}
                          </div>
                        ))}
                      </div>
                    ) : <p className={s.muted}>No punch evidence was recorded for this day.</p>}
                  </div>
                </section>
                <section className={s.section}>
                  <header><Activity aria-hidden="true" />Workday activity</header>
                  <div>
                    {detail.data?.workSessions.length ? (
                      <ul className={s.timeline}>
                        {detail.data.workSessions.flatMap(ws => [
                          { key: `${ws.id}-in`, at: ws.startWorkAt, text: 'Work session started', sub: null },
                          { key: `${ws.id}-out`, at: ws.logoutAt, text: ws.logoutAt ? 'Work session ended' : 'Session still open', sub: ws.autoClosed ? 'Closed by system' : null },
                        ]).map(item => (
                          <li key={item.key}><i aria-hidden="true" /><b>{formatTimeOfDay(item.at)}</b><span>{item.text}{item.sub && <small>{item.sub}</small>}</span></li>
                        ))}
                      </ul>
                    ) : <p className={s.muted}>No work sessions were recorded for this day.</p>}
                  </div>
                </section>
                {isHr && official && official.exceptionFlags.length > 0 && (
                  <section className={s.section}>
                    <header><ShieldCheck aria-hidden="true" />Evaluation</header>
                    <div><p className={s.muted}>Flags: {official.exceptionFlags.map(f => f.replaceAll('_', ' ').toLowerCase()).join(', ')}</p></div>
                  </section>
                )}
              </div>
              {pending && (
                <div className={s.panelFoot}>
                  <button type="button" className={s.buttonPrimary} onClick={onOpenReviews}>Review correction</button>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        <div style={{ marginTop: 16 }}>
          {history.isError ? <LoadError what="Attendance history" onRetry={() => history.refetch()} />
            : history.isLoading ? <p className={s.why}>Loading…</p>
              : (
                <ul className={s.list}>
                  {(history.data?.days ?? []).filter(d => d.date <= date).slice().reverse().map(d => (
                    <li key={d.date}>
                      <span>{longDate(d.date)}</span>
                      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span className={s.subtle}>{d.punchIn ?? DASH} – {d.punchOut ?? DASH}</span>
                        <StatusBadge p={presentHistoryState(d.status)} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
        </div>
      )}
    </aside>
  );
}
