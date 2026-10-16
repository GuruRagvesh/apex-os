'use client';

import { useState } from 'react';
import { CorrectionScreenshotPicker } from './CorrectionScreenshots';
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
 *
 * The issue the employee picks is a plain-language CATEGORY. Punch problems map to
 * the existing punch-correction types, which carry the proposed time. A status,
 * worked-hours or other concern maps to OTHER, a review-only type: reviewers read
 * it and decide, and approving it never rewrites the official day.
 */

interface Category {
  key: string;
  label: string;
  hint: string;
  requestType: RegularizationRequestType;
  /** Which proposed time the request must carry. */
  times: 'in' | 'out' | 'both' | 'none';
  /** The time is required, not optional. */
  timeRequired?: boolean;
  /** Keeps the employee's category readable in review lists for review-only requests. */
  reasonPrefix?: string;
}

export const CATEGORIES: Category[] = [
  { key: 'MISSING_IN', label: 'Missing punch-in', hint: 'You worked, but your punch-in was never recorded. Enter the time you started.', requestType: 'MISSING_PUNCH', times: 'in', timeRequired: true },
  { key: 'MISSING_OUT', label: 'Missing punch-out', hint: 'You worked, but your punch-out was never recorded. Enter the time you finished.', requestType: 'MISSING_PUNCH', times: 'out', timeRequired: true },
  { key: 'WRONG_IN', label: 'Wrong punch-in time', hint: 'The recorded arrival time is wrong. Enter the correct time.', requestType: 'LATE_CORRECTION', times: 'in', timeRequired: true },
  { key: 'WRONG_OUT', label: 'Wrong punch-out time', hint: 'The recorded departure time is wrong. Enter the correct time.', requestType: 'MISSING_PUNCH', times: 'out', timeRequired: true },
  { key: 'STATUS', label: 'Incorrect attendance status', hint: 'The day shows the wrong status. This goes to a reviewer; nothing changes automatically.', requestType: 'OTHER', times: 'none', reasonPrefix: '[Status] ' },
  { key: 'HOURS', label: 'Incorrect worked hours', hint: 'The worked time for the day looks wrong. This goes to a reviewer; nothing changes automatically.', requestType: 'OTHER', times: 'none', reasonPrefix: '[Worked hours] ' },
  { key: 'HALF_DAY', label: 'Half day', hint: 'This day should be treated as a half day.', requestType: 'HALF_DAY_CORRECTION', times: 'both' },
  { key: 'LOCATION', label: 'Location flagged', hint: 'Explain where you actually were.', requestType: 'LOCATION_EXCEPTION', times: 'both' },
  { key: 'PHOTO', label: 'Photo problem', hint: 'The photo failed to capture.', requestType: 'FACE_EXCEPTION', times: 'both' },
  { key: 'OTHER', label: 'Other attendance issue', hint: 'Anything else about this day. This goes to a reviewer; nothing changes automatically.', requestType: 'OTHER', times: 'none', reasonPrefix: '[Other] ' },
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
  onDone,
  onCancel,
}: {
  businessDate: string;
  allowScreenshots?: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [categoryKey, setCategoryKey] = useState<string>(CATEGORIES[0].key);
  const [punchIn, setPunchIn] = useState('');
  const [punchOut, setPunchOut] = useState('');
  const [reason, setReason] = useState('');
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const selected = CATEGORIES.find((c) => c.key === categoryKey) ?? CATEGORIES[0];
  const showIn = selected.times === 'in' || selected.times === 'both';
  const showOut = selected.times === 'out' || selected.times === 'both';

  const mutation = useMutation({
    mutationFn: () =>
      createRegularization({
        businessDate,
        requestType: selected.requestType,
        reason: (selected.reasonPrefix ?? '') + reason.trim(),
        requestedPunchIn: showIn ? toInstant(businessDate, punchIn) : null,
        requestedPunchOut: showOut ? toInstant(businessDate, punchOut) : null,
      }, screenshots),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-regularizations'] });
      onDone();
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message ?? 'The request could not be submitted.');
    },
  });

  const timeMissing = !!selected.timeRequired && ((selected.times === 'in' && !punchIn) || (selected.times === 'out' && !punchOut));
  const canSubmit = reason.trim().length >= 5 && !timeMissing && !mutation.isPending;

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
            value={categoryKey}
            onChange={(e) => setCategoryKey(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <p className="apex-text-subtle mt-1 text-xs">{selected.hint}</p>
        </div>

        {(showIn || showOut) && (
          <div className="grid grid-cols-2 gap-3">
            {showIn && (
              <div>
                <label className="apex-text-subtle text-[11px] uppercase tracking-wide">
                  {selected.times === 'in' ? 'Correct punch-in time' : 'Punch in (optional)'}
                </label>
                <input
                  type="time"
                  className="apex-input mt-1"
                  value={punchIn}
                  onChange={(e) => setPunchIn(e.target.value)}
                />
              </div>
            )}
            {showOut && (
              <div>
                <label className="apex-text-subtle text-[11px] uppercase tracking-wide">
                  {selected.times === 'out' ? 'Correct punch-out time' : 'Punch out (optional)'}
                </label>
                <input
                  type="time"
                  className="apex-input mt-1"
                  value={punchOut}
                  onChange={(e) => setPunchOut(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

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
