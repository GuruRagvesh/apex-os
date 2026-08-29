'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CameraOff, MapPinOff } from 'lucide-react';
import { ModalPortal } from '../ui/ModalPortal';
import { formatTime } from './attendance-status';
import {
  ACTION_LABEL,
  REASON_LABEL,
  RECOVERY_REASONS,
  availableActions,
  isCorrection,
  isPunchIn,
  submitManualRecovery,
  validateDraft,
  type ManualRecoveryDraft,
  type RecoveryAction,
  type RecoveryReason,
} from './manual-recovery-api';

/**
 * Manual Attendance Recovery, for an authorised manager, HR or admin.
 *
 * Two deliberate steps: fill in, then confirm against a summary of what will
 * change. The second step exists because this is the only path that writes an
 * attendance fact without evidence behind it, and a conscious checkpoint is
 * cheap next to a punch nobody can justify later.
 *
 * The form never offers an action that would be refused. If a punch in already
 * exists it offers "correct", not "add", so the duplicate rule is visible in
 * the choices rather than arriving as a server error.
 *
 * Absent evidence is stated, never implied by omission and never rendered
 * through the components that display real photos and geofences.
 */

export function ManualRecoveryForm({
  employee,
  businessDate,
  existing,
  actorIsHr,
  onClose,
}: {
  employee: { id: string; name: string };
  businessDate: string;
  existing: { punchInAt: string | null; punchOutAt: string | null };
  /** Only HR and admin see the finalisation hint; managers hand over to HR. */
  actorIsHr: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const actions = useMemo(() => availableActions(existing), [existing]);

  const [action, setAction] = useState<RecoveryAction>(actions[0]);
  const [effectiveTime, setEffectiveTime] = useState('');
  const [recoveryReason, setRecoveryReason] = useState<RecoveryReason | ''>('');
  const [reason, setReason] = useState('');
  const [informedAt, setInformedAt] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft: Partial<ManualRecoveryDraft> = {
    userId: employee.id,
    businessDate,
    action,
    effectiveTime,
    recoveryReason: (recoveryReason || undefined) as RecoveryReason,
    reason,
    employeeInformedAt: informedAt,
  };
  const validation = validateDraft(draft);

  const currentValue = isPunchIn(action) ? existing.punchInAt : existing.punchOutAt;

  const save = useMutation({
    mutationFn: () => submitManualRecovery(draft as ManualRecoveryDraft),
    onSuccess: () => {
      // Everything that shows this day is now stale.
      for (const key of [
        ['my-attendance'],
        ['attendance-console'],
        ['regularization-queue'],
        ['attendance-day-detail'],
      ]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
      onClose();
    },
    onError: (err: any) => {
      setConfirming(false);
      setError(err?.response?.data?.message ?? 'The manual punch could not be recorded.');
    },
  });

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900"
             style={{ maxHeight: '90vh' }}>
          <div className="mb-4">
            <h2 className="apex-text text-base font-semibold">Manual Attendance Recovery</h2>
            <p className="apex-text-muted mt-0.5 text-xs">
              For when Apex OS, the network or the device prevented a normal punch.
            </p>
          </div>

          {!confirming ? (
            <>
              <dl className="mb-4 grid grid-cols-2 gap-3">
                <Fact label="Employee" value={employee.name} />
                <Fact label="Business date" value={businessDate} />
              </dl>

              <Field label="What is being recorded" error={validation.errors.action}>
                <div className="flex flex-wrap gap-2">
                  {actions.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setAction(a)}
                      className={`rounded-lg border px-3 py-1.5 text-sm ${
                        action === a
                          ? 'border-[var(--accent)] apex-text font-medium'
                          : 'border-[var(--border-secondary)] apex-text-muted'
                      }`}
                    >
                      {ACTION_LABEL[a]}
                    </button>
                  ))}
                </div>
              </Field>

              {isCorrection(action) && currentValue && (
                <p className="apex-text-muted mb-3 text-xs">
                  Current value: <span className="apex-text font-medium">{formatTime(currentValue)}</span>
                </p>
              )}

              <Field label="Actual punch time" error={validation.errors.effectiveTime}>
                <input
                  type="time"
                  value={effectiveTime}
                  onChange={(e) => setEffectiveTime(e.target.value)}
                  className="apex-input w-full text-sm"
                />
              </Field>

              <Field label="Why it could not be recorded" error={validation.errors.recoveryReason}>
                <select
                  value={recoveryReason}
                  onChange={(e) => setRecoveryReason(e.target.value as RecoveryReason)}
                  className="apex-input w-full text-sm"
                >
                  <option value="">Select a reason…</option>
                  {RECOVERY_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {REASON_LABEL[r]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Employee informed at" error={validation.errors.employeeInformedAt}>
                <input
                  type="datetime-local"
                  value={informedAt}
                  onChange={(e) => setInformedAt(e.target.value)}
                  className="apex-input w-full text-sm"
                />
              </Field>

              <Field label="Explanation" error={validation.errors.reason}>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="What happened, in the employee's own account."
                  className="apex-input w-full text-sm"
                />
              </Field>

              <EvidenceAbsence />

              {error && (
                <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
              )}

              <div className="mt-4 flex justify-end gap-2">
                <button onClick={onClose} className="apex-text-muted rounded-lg border border-[var(--border-secondary)] px-3 py-1.5 text-sm">
                  Cancel
                </button>
                <button
                  onClick={() => setConfirming(true)}
                  disabled={!validation.ok}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--text-inverse)] disabled:opacity-50"
                >
                  Review
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-[var(--border-secondary)] p-3">
                <dl className="grid grid-cols-2 gap-3">
                  <Fact label="Employee" value={employee.name} />
                  <Fact label="Business date" value={businessDate} />
                  <Fact
                    label={isPunchIn(action) ? 'Punch in' : 'Punch out'}
                    value={`${currentValue ? formatTime(currentValue) : 'Missing'} → ${effectiveTime}`}
                  />
                  <Fact label="Source" value="Manual Recovery" />
                  <Fact label="Reason" value={REASON_LABEL[recoveryReason as RecoveryReason]} />
                  <Fact label="Employee informed at" value={informedAt.replace('T', ' ')} />
                </dl>
                <p className="apex-text-muted mt-3 text-xs">{reason}</p>
              </div>

              <EvidenceAbsence />

              <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle size={14} className="mt-px shrink-0" />
                <span>
                  {actorIsHr
                    ? 'This records the recovery. Official attendance changes only when you finalize it as HR.'
                    : 'This records the recovery. HR must give final approval before official attendance changes.'}
                </span>
              </p>

              {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setConfirming(false)}
                  disabled={save.isPending}
                  className="apex-text-muted rounded-lg border border-[var(--border-secondary)] px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  onClick={() => save.mutate()}
                  disabled={save.isPending}
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--text-inverse)] disabled:opacity-50"
                >
                  {save.isPending ? 'Recording…' : 'Confirm & Record'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}

/**
 * States the absence outright.
 *
 * Deliberately NOT the components that render real photos and geofences:
 * reusing those would imply evidence exists and merely failed to load, which
 * is a different and much more forgiving claim than "there is none".
 */
function EvidenceAbsence() {
  return (
    <div className="mt-3 rounded-lg bg-[var(--bg-secondary)] p-2.5">
      <p className="apex-text-subtle mb-1 text-[11px] font-semibold uppercase tracking-wide">
        Evidence
      </p>
      <p className="apex-text-muted flex items-center gap-1.5 text-xs">
        <CameraOff size={12} /> Photo: not available — manual recovery
      </p>
      <p className="apex-text-muted mt-0.5 flex items-center gap-1.5 text-xs">
        <MapPinOff size={12} /> Location: not available — manual recovery
      </p>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <label className="apex-text mb-1 block text-xs font-medium">{label}</label>
      {children}
      {error && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="apex-text-subtle text-[11px] uppercase tracking-wide">{label}</dt>
      <dd className="apex-text mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}
