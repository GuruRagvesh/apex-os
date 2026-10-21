'use client';

import { useState } from 'react';
import { CorrectionScreenshotPicker } from './CorrectionScreenshots';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createRegularization,
  type AttendanceCorrectionConcern,
} from './regularization-api';

/**
 * Raise a correction for one date (AR-1).
 *
 * Deliberately narrow: the employee proposes what they believe the correct
 * punch times were and says why. Nothing here edits the recorded evidence —
 * the raw punch record stays exactly as the device reported it, and an approved
 * correction sits alongside it.
 */

const TYPES: Array<{ value: AttendanceCorrectionConcern; label: string; hint: string }> = [
  { value: 'MISSING_PUNCH_IN', label: 'Missing Punch In', hint: 'Your start punch was not recorded.' },
  { value: 'MISSING_PUNCH_OUT', label: 'Missing Punch Out', hint: 'Your final punch was not recorded.' },
  { value: 'WRONG_PUNCH_IN', label: 'Wrong Punch In', hint: 'The recorded start time is incorrect.' },
  { value: 'WRONG_PUNCH_OUT', label: 'Wrong Punch Out', hint: 'The recorded end time is incorrect.' },
  { value: 'INCORRECT_ATTENDANCE_STATUS', label: 'Incorrect Attendance Status', hint: 'The final attendance label needs review.' },
  { value: 'INCORRECT_WORKED_HOURS', label: 'Incorrect Worked Hours', hint: 'The recorded effective work total needs review.' },
  { value: 'OTHER', label: 'Other', hint: 'Describe what needs review.' },
];

/** 'HH:mm' on a business date -> an ISO instant in the browser's zone. */
function toInstant(businessDate: string, hhmm: string): string | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const d = new Date(`${businessDate}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

export function RequestCorrectionForm({
  businessDate,
  allowScreenshots = false,
  historicalRecord = false,
  onDone,
  onCancel,
}: {
  businessDate: string;
  allowScreenshots?: boolean;
  historicalRecord?: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [concern, setConcern] = useState<AttendanceCorrectionConcern>(historicalRecord ? 'OTHER' : 'MISSING_PUNCH_IN');
  const [punchIn, setPunchIn] = useState('');
  const [punchOut, setPunchOut] = useState('');
  const [reason, setReason] = useState('');
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const choices = historicalRecord ? TYPES.filter(type => type.value === 'OTHER') : TYPES;
  const selected = choices.find((t) => t.value === concern);
  const showPunchIn = concern === 'MISSING_PUNCH_IN' || concern === 'WRONG_PUNCH_IN';
  const showPunchOut = concern === 'MISSING_PUNCH_OUT' || concern === 'WRONG_PUNCH_OUT';

  const mutation = useMutation({
    mutationFn: () =>
      createRegularization({
        businessDate,
        concern,
        reason: reason.trim(),
        requestedPunchIn: showPunchIn ? toInstant(businessDate, punchIn) : null,
        requestedPunchOut: showPunchOut ? toInstant(businessDate, punchOut) : null,
      }, screenshots),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-regularizations'] });
      onDone();
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message ?? 'The request could not be submitted.');
    },
  });

  const canSubmit = reason.trim().length >= 5 && !mutation.isPending;

  return (
    <div className="mt-4 rounded-lg border border-[var(--border-secondary)] p-4">
      <h4 className="apex-text text-sm font-semibold">Request a correction</h4>
      <p className="apex-text-muted mt-0.5 text-xs">
        Your reporting manager reviews this first, then HR. Your recorded punches are
        not changed — an approved correction is recorded alongside them.
      </p>
      {historicalRecord && <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">This is a preserved historical record. Your request will open a review; it will not directly replace the stored attendance.</p>}

      <div className="mt-3 space-y-3">
        <div>
          <label className="apex-text-subtle text-[11px] uppercase tracking-wide">
            What needs correcting
          </label>
          <select
            className="apex-input mt-1"
            value={concern}
            onChange={(e) => setConcern(e.target.value as AttendanceCorrectionConcern)}
          >
            {choices.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {selected && <p className="apex-text-subtle mt-1 text-xs">{selected.hint}</p>}
        </div>

        {(showPunchIn || showPunchOut) && <div className="grid grid-cols-2 gap-3">
          {showPunchIn &&
          <div>
            <label className="apex-text-subtle text-[11px] uppercase tracking-wide">
              Punch in (optional)
            </label>
            <input
              type="time"
              className="apex-input mt-1"
              value={punchIn}
              onChange={(e) => setPunchIn(e.target.value)}
            />
          </div>
          }
          {showPunchOut &&
          <div>
            <label className="apex-text-subtle text-[11px] uppercase tracking-wide">
              Punch out (optional)
            </label>
            <input
              type="time"
              className="apex-input mt-1"
              value={punchOut}
              onChange={(e) => setPunchOut(e.target.value)}
            />
          </div>
          }
        </div>}

        <div>
          <label className="apex-text-subtle text-[11px] uppercase tracking-wide">
            Reason
          </label>
          <textarea
            className="apex-input mt-1"
            rows={3}
            value={reason}
            placeholder="Explain what happened, e.g. the browser crashed before I could punch out."
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {allowScreenshots && <CorrectionScreenshotPicker files={screenshots} onChange={setScreenshots} disabled={mutation.isPending} />}

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="apex-text-muted rounded-lg border border-[var(--border-secondary)] px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
            disabled={!canSubmit}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--text-inverse)] disabled:opacity-50"
          >
            {mutation.isPending ? 'Submitting…' : 'Submit request'}
          </button>
        </div>
      </div>
    </div>
  );
}
