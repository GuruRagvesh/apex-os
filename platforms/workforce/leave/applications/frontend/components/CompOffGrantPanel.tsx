'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Gift, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { usersApi } from '@apex/core-users/api';
import { compOffApi } from '../api';

/**
 * Manual comp off grant (HR/Admin).
 *
 * V1 is deliberately manual. Credits are NOT earned automatically from a
 * WorkSession, because management has not defined the qualifying work
 * duration — inventing one here would silently become policy.
 *
 * Every rule below is the server's. This form does not decide whether a day
 * qualifies, whether the caller is HR, or whether a credit already exists; it
 * collects three fields and reports what the server answered. The two refusals
 * worth naming are 422 (the source day is an ordinary working day) and 409
 * (this employee already holds a credit for that date).
 */
export function CompOffGrantPanel() {
  const qc = useQueryClient();
  const [employeeId, setEmployeeId] = useState('');
  const [earnedFromBusinessDate, setEarnedFromBusinessDate] = useState('');
  const [reason, setReason] = useState('');

  const { data: directory } = useQuery({
    queryKey: ['users-directory'],
    queryFn: () => usersApi.getDirectory() as Promise<any[]>,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const people = Array.isArray(directory) ? directory : [];

  // Existing credits for the selected employee, so HR can see what is already
  // there before granting another.
  const { data: existing } = useQuery({
    queryKey: ['comp-off-employee', employeeId],
    queryFn: () => compOffApi.forEmployee(employeeId) as Promise<any[]>,
    enabled: !!employeeId,
    retry: false,
  });

  const grant = useMutation({
    mutationFn: () =>
      compOffApi.grant({ employeeId, earnedFromBusinessDate, reason }) as Promise<any>,
    onSuccess: () => {
      toast.success('Comp off credit granted');
      setEarnedFromBusinessDate('');
      setReason('');
      qc.invalidateQueries({ queryKey: ['comp-off-employee', employeeId] });
      qc.invalidateQueries({ queryKey: ['comp-off-mine'] });
    },
    onError: (err: any) => {
      const status = err?.response?.status;
      const detail = err?.response?.data?.message;
      if (status === 422) {
        toast.error(detail || 'That date is not a qualifying source day.');
      } else if (status === 409) {
        toast.error(detail || 'This employee already holds a credit for that date.');
      } else if (status === 403) {
        toast.error('Only HR can grant comp off.');
      } else {
        toast.error(detail || 'Could not grant the credit.');
      }
    },
  });

  const canSubmit =
    !!employeeId && !!earnedFromBusinessDate && reason.trim().length >= 5 && !grant.isPending;

  return (
    <div className="apex-card space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Gift size={16} style={{ color: 'var(--accent)' }} />
        <h3 className="apex-text text-sm font-semibold">Grant comp off</h3>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-[var(--border-secondary)] px-3 py-2 text-xs">
        <Info size={12} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />
        <span style={{ color: 'var(--text-secondary)' }}>
          The source day must be a Sunday, a 2nd or 4th Saturday, or an official holiday.
          Credits expire 30 days after the source date, and the soonest to expire are used
          first. Credits are never earned automatically.
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <label className="apex-label">Employee</label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="apex-select w-full"
          >
            <option value="">Select an employee…</option>
            {people.map((p: any) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.employeeId ? ` (${p.employeeId})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="apex-label">Source date</label>
          <input
            type="date"
            value={earnedFromBusinessDate}
            onChange={(e) => setEarnedFromBusinessDate(e.target.value)}
            className="apex-input"
          />
        </div>

        <div>
          <label className="apex-label">Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Why this credit is being granted"
            className="apex-input w-full"
          />
          {reason.length > 0 && reason.trim().length < 5 && (
            <p className="mt-1 flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
              <AlertTriangle size={11} /> A reason is required.
            </p>
          )}
        </div>

        {employeeId && (
          <p className="apex-text-muted text-xs">
            {Array.isArray(existing) ? existing.length : 0} unexpired credit
            {Array.isArray(existing) && existing.length === 1 ? '' : 's'} already available.
          </p>
        )}

        <button
          onClick={() => grant.mutate()}
          disabled={!canSubmit}
          className="apex-btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
        >
          {grant.isPending ? 'Granting…' : 'Grant credit'}
        </button>
      </div>
    </div>
  );
}
