'use client';

import { ChevronRight, FileEdit } from 'lucide-react';
import type { MyAttendanceTodayV2 } from './my-attendance-v2-api';
import {
  BRAND,
  UNKNOWN_FIGURE,
  formatLongDate,
  formatMinutesOrUnknown,
  formatTime,
  isUnavailable,
  modifierLabel,
  modifierTone,
  presentOutcome,
} from './status-presentation';

/**
 * Today, at the top of My Attendance.
 *
 * Every number shown here came from the server. The card formats and arranges;
 * it computes nothing. In particular:
 *
 *   - Required comes straight from the evaluator's own requirement for the day.
 *     Where the backend declares a figure unanswerable it reads "Not available",
 *     with the reason shown once below. Nothing is ever rendered as 0h 00m, and
 *     nothing is derived here from a hardcoded requirement.
 *
 *   - PRESENCE AND WORK ARE NEVER MIXED. The requirement is a presence span, so
 *     everything derived from it is labelled for that measure: "Required
 *     presence", "Presence remaining", "Presence progress". Worked minutes are
 *     shown beside them as the separate operational fact they are. Subtracting
 *     worked time from a presence bar would tell an employee who finished their
 *     day that they still owed their lunch break.
 *
 *   - The progress bar is drawn from `presenceProgressPercent`. With no percent
 *     there is no bar, rather than an empty bar that reads as zero progress.
 *     The value is not clamped — presence beyond the requirement is a real fact
 *     and reads above 100% — but the bar WIDTH is, which is layout, not data.
 *
 * The date tile, state pill and action row follow the approved composition.
 */
export function TodaySummaryCard({
  today,
  onViewDetails,
  onRequestCorrection,
}: {
  today: MyAttendanceTodayV2;
  onViewDetails: () => void;
  onRequestCorrection: () => void;
}) {
  const status = presentOutcome(today.outcome);
  const [year, month, dayOfMonth] = today.date.split('-');
  const weekday = new Date(`${today.date}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
  });

  const requiredUnavailable = isUnavailable(today, 'requiredMinutes');
  const remainingUnavailable = isUnavailable(today, 'presenceRemainingMinutes');

  return (
    <section
      className="apex-card overflow-hidden rounded-2xl border border-apex-border"
      style={{ boxShadow: '0 1px 2px rgba(1, 38, 106, 0.04), 0 8px 24px rgba(1, 38, 106, 0.05)' }}
    >
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:gap-7 sm:p-6">
        {/* Date tile — brand colour, because it is interface, not a verdict. */}
        <div
          className="flex h-[88px] w-[88px] shrink-0 flex-col items-center justify-center rounded-2xl"
          style={{ background: BRAND.paleBlue, color: BRAND.navy }}
          aria-hidden="true"
        >
          <span className="text-2xl font-bold leading-none">{dayOfMonth}</span>
          <span className="mt-1 text-xs font-medium uppercase tracking-wide">{weekday}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight" style={{ color: BRAND.navy }}>
              Today
            </h2>
            <span className="text-sm" style={{ color: BRAND.blue }}>
              {formatLongDate(today.date)}
            </span>
          </div>

          {/* Status pill: semantic colour, always with its label and glyph. */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
              style={{ background: status.tint, color: status.color }}
            >
              <span aria-hidden="true">{status.glyph}</span>
              {status.label}
            </span>
            {today.modifiers.map((m) => {
              const tone = modifierTone(m);
              return (
                <span
                  key={m}
                  className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                  style={
                    tone
                      ? { background: tone.tint, color: tone.color }
                      : { border: '1px solid #E4E7EC', color: '#52525B' }
                  }
                >
                  {modifierLabel(m)}
                </span>
              );
            })}
          </div>

          {/* Progress. Drawn only when the backend supplied a percentage. */}
          {today.presenceProgressPercent !== null ? (
            <div className="mt-4">
              <div className="apex-text-muted mb-1 flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
                <span>Presence progress</span>
                <span className="tabular-nums">
                  {formatMinutesOrUnknown(today.presenceMinutes)} of{' '}
                  {formatMinutesOrUnknown(today.requiredMinutes)} ·{' '}
                  {today.presenceProgressPercent}%
                </span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full"
                style={{ background: BRAND.paleBlue }}
                role="progressbar"
                aria-label="Presence progress"
                aria-valuenow={today.presenceProgressPercent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, Math.max(0, today.presenceProgressPercent))}%`,
                    background: BRAND.blue,
                  }}
                />
              </div>
            </div>
          ) : (
            <p className="apex-text-muted mt-4 text-xs">
              Presence progress needs both a measured presence and a presence requirement. One of
              them does not apply to today, so no bar is shown.
            </p>
          )}

          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Figure label="Worked" value={formatMinutesOrUnknown(today.workedMinutes)} />
            <Figure
              label="Required presence"
              value={
                requiredUnavailable ? 'Not available' : formatMinutesOrUnknown(today.requiredMinutes)
              }
              muted={requiredUnavailable}
            />
            <Figure
              label="Presence remaining"
              value={
                remainingUnavailable
                  ? 'Not available'
                  : formatMinutesOrUnknown(today.presenceRemainingMinutes)
              }
              muted={remainingUnavailable}
            />
            <Figure label="First punch" value={formatTime(today.firstPunchAt)} />
          </dl>

          {today.explanation ? (
            <p className="apex-text-muted mt-4 text-sm">{today.explanation}</p>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onViewDetails}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-white"
              style={{ background: BRAND.navy }}
            >
              View Day Details
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>

            {/* Hidden rather than disabled when the backend says it is not
                offered: a disabled control invites a click and explains
                nothing. */}
            {today.correctionAllowed ? (
              <button
                type="button"
                onClick={onRequestCorrection}
                className="apex-text inline-flex items-center gap-1 rounded-lg border border-apex-border px-3 py-2 text-sm font-semibold"
              >
                <FileEdit className="h-4 w-4" aria-hidden="true" />
                Request Correction
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function Figure({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div>
      <dt className="apex-text-muted text-xs font-medium uppercase tracking-wide">{label}</dt>
      <dd
        className={`mt-1 text-lg font-semibold tabular-nums ${muted ? 'apex-text-muted' : 'apex-text'}`}
        style={muted ? { fontSize: '0.875rem', fontWeight: 500 } : undefined}
      >
        {value === UNKNOWN_FIGURE ? <span aria-label="not available">{value}</span> : value}
      </dd>
    </div>
  );
}
