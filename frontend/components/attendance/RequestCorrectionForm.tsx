'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createRegularization,
  type RegularizationRequestType,
} from './regularization-api';

/**
 * Raise a correction for one date (AR-1).
 *
 * Deliberately narrow: the employee proposes what they believe the correct
 * punch times were and says why. Nothing here edits the recorded evidence —
 * the raw punch record stays exactly as the device reported it, and an approved
 * correction sits alongside it.
 */

const TYPES: Array<{ value: RegularizationRequestType; label: string; hint: string }> = [
  { value: 'MISSING_PUNCH', label: 'Missing punch', hint: 'A punch in or out was never recorded.' },
  { value: 'LATE_CORRECTION', label: 'Arrival time', hint: 'The recorded arrival time is wrong.' },
  { value: 'LOCATION_EXCEPTION', label: 'Location flagged', hint: 'Explain where you actually were.' },
  { value: 'FACE_EXCEPTION', label: 'Photo problem', hint: 'The photo failed to capture.' },
  { value: 'HALF_DAY_CORRECTION', label: 'Half day', hint: 'This day should be treated as a half day.' },
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
  onDone,
  onCancel,
}: {
  businessDate: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [requestType, setRequestType] = useState<RegularizationRequestType>('MISSING_PUNCH');
  const [punchIn, setPunchIn] = useState('');
  const [punchOut, setPunchOut] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createRegularization({
        businessDate,
        requestType,
        reason: reason.trim(),
        requestedPunchIn: toInstant(businessDate, punchIn),
        requestedPunchOut: toInstant(businessDate, punchOut),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-regularizations'] });
      onDone();
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message ?? 'The request could not be submitted.');
    },
  });

  const selected = TYPES.find((t) => t.value === requestType);
  const canSubmit = reason.trim().length >= 5 && !mutation.isPending;

  return (
    <div className="mt-4 rounded-lg border border-[var(--border-secondary)] p-4">
      <h4 className="apex-text text-sm font-semibold">Request a correction</h4>
      <p className="apex-text-muted mt-0.5 text-xs">
        Your reporting manager reviews this first, then HR. Your recorded punches are
        not changed — an approved correction is recorded alongside them.
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <label className="apex-text-subtle text-[11px] uppercase tracking-wide">
            What needs correcting
          </label>
          <select
            className="apex-input mt-1"
            value={requestType}
            onChange={(e) => setRequestType(e.target.value as RegularizationRequestType)}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {selected && <p className="apex-text-subtle mt-1 text-xs">{selected.hint}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
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
        </div>

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
