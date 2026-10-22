'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { RemediationDialog, useRemediation } from '@apex/shared-remediation';
import { createRemediationActionRunner } from '@apex/shared-remediation/api';
import { api, unwrap as r } from '@apex/shared-auth';
import { messageFor, newKey, transitionsApi, TransferPlanInput, TransferPreview } from './transitions-api';

/**
 * Preview-first department / role transfer (Workstream A).
 *
 * 1. The Admin picks the new primary department and/or base role.
 * 2. The server calculates the impact BEFORE anything is saved.
 * 3. Confirm sends the preview fingerprint. If anything changed meanwhile the
 *    server answers 409 TRANSFER_PREVIEW_STALE with a fresh preview: the form
 *    keeps every choice and shows what moved.
 * 4. "Apply today" is offered only when today is clean; otherwise the transfer
 *    is scheduled for a later company day.
 */

const BLOCKER_TEXT: Record<string, string> = {
  ATTENDANCE_EVENT: 'attendance already recorded today',
  PUNCH_EVIDENCE: 'a punch was already captured today',
  WORK_SESSION: 'a work session exists today',
  DAILY_ATTENDANCE: 'today already has an attendance row',
  PHONE_HANDOFF_WAITING: 'a phone punch is waiting',
  PENDING_CORRECTION: 'a correction for today is pending',
  PAYROLL_MONTH_CLOSED: 'this payroll month is closed',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-start sm:gap-4">
      <dt className="w-48 shrink-0 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>{label}</dt>
      <dd className="min-w-0 text-sm" style={{ color: 'var(--text-primary)' }}>{children}</dd>
    </div>
  );
}

export function TransferImpactModal({ user, onClose }: { user: { id: string; name: string; departmentId?: string | null; roleId?: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [toDepartmentId, setToDepartmentId] = useState<string>(user.departmentId ?? '');
  const [toRoleId, setToRoleId] = useState<string>(user.roleId ?? '');
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [mode, setMode] = useState<'today' | 'later'>('today');
  const [effectiveOn, setEffectiveOn] = useState('');
  const [reason, setReason] = useState('');
  const [staleNotice, setStaleNotice] = useState(false);
  // One key per submit attempt; a retry of the SAME confirm reuses it.
  const keyRef = useRef(newKey());
  const remediation = useRemediation();
  const runner = useMemo(createRemediationActionRunner, []);

  const departments = useQuery({ queryKey: ['departments-list'], queryFn: () => r<any[]>(api.get('/departments')), retry: false });
  const roles = useQuery({ queryKey: ['roles-list'], queryFn: () => r<any[]>(api.get('/roles')), retry: false });

  const plan: TransferPlanInput = { toDepartmentId: toDepartmentId || null, toRoleId };

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const previewMutation = useMutation({
    mutationFn: () => transitionsApi.previewTransfer(user.id, plan),
    onSuccess: (p) => {
      setPreview(p);
      setMode(p.canApplyToday ? 'today' : 'later');
      setEffectiveOn(p.earliestScheduledDay);
      keyRef.current = newKey();
    },
    onError: (err: any) => {
      if (remediation.openFrom(err)) return;
      toast.error(messageFor(err));
    },
  });

  const confirmMutation = useMutation({
    mutationFn: () =>
      transitionsApi.confirmTransfer(user.id, plan, {
        fingerprint: preview!.fingerprint,
        idempotencyKey: keyRef.current,
        reason: reason || undefined,
        effectiveOn: mode === 'today' ? undefined : effectiveOn,
      }),
    onSuccess: (t) => {
      toast.success(t.status === 'COMPLETED' ? 'Transfer applied.' : `Transfer scheduled for ${t.effectiveOn}.`);
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['user'] });
      qc.invalidateQueries({ queryKey: ['transfers'] });
      onClose();
    },
    onError: (err: any) => {
      if (err?.code === 'TRANSFER_PREVIEW_STALE' && err?.preview) {
        // Keep every input; show what changed and ask again.
        setPreview(err.preview);
        setStaleNotice(true);
        setMode(err.preview.canApplyToday ? mode : 'later');
        keyRef.current = newKey();
        return;
      }
      if (err?.code === 'TRANSFER_TODAY_NOT_CLEAN') {
        setMode('later');
        setEffectiveOn(err.earliestScheduledDay ?? effectiveOn);
        toast.error('Today already has activity for this person, so choose a later day.');
        return;
      }
      if (remediation.openFrom(err)) return;
      toast.error(messageFor(err));
    },
  });

  const unchanged = (toDepartmentId || '') === (user.departmentId ?? '') && toRoleId === user.roleId;
  const busy = previewMutation.isPending || confirmMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="presentation">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transfer-title"
        className="apex-card flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl"
      >
        <header className="border-b p-4 sm:p-5" style={{ borderColor: 'var(--border-subtle)' }}>
          <h2 id="transfer-title" className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Transfer {user.name}</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Changes the primary department and base role. Nothing is saved until you confirm the impact below.
          </p>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium">New primary department</span>
              <select className="apex-input w-full" value={toDepartmentId} onChange={(e) => { setToDepartmentId(e.target.value); setPreview(null); }}>
                <option value="">No department</option>
                {(departments.data ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">New base role</span>
              <select className="apex-input w-full" value={toRoleId} onChange={(e) => { setToRoleId(e.target.value); setPreview(null); }}>
                {(roles.data ?? []).map((ro: any) => <option key={ro.id} value={ro.id}>{ro.name}</option>)}
              </select>
            </label>
          </div>

          {staleNotice && (
            <div role="status" className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--warning, #d97706)' }}>
              Something changed since you last looked. The impact below is up to date; your choices were kept. Review it and confirm again.
            </div>
          )}

          {preview && (
            <section aria-label="Transfer impact" className="rounded-xl border p-3 sm:p-4" style={{ borderColor: 'var(--border-subtle)' }}>
              <dl className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                <Row label="Department">{preview.department.from?.name ?? 'None'} → <strong>{preview.department.to?.name ?? 'None'}</strong></Row>
                <Row label="Base role">{preview.role.from.name} → <strong>{preview.role.to?.name ?? '—'}</strong></Row>
                <Row label="Permissions">
                  {preview.permissions.gained.length === 0 && preview.permissions.lost.length === 0 ? 'No change' : (
                    <>
                      {preview.permissions.gained.length > 0 && <div>Gains: {preview.permissions.gained.join('; ')}</div>}
                      {preview.permissions.lost.length > 0 && <div>Loses: {preview.permissions.lost.join('; ')}</div>}
                    </>
                  )}
                </Row>
                <Row label="Reporting lines">Employee-level Team Lead / Manager assignments end at the effective time. A missing line becomes a setup warning, never a failure.</Row>
                <Row label="Attendance profile">{preview.attendanceProfile ? 'The current profile ends the day before and a new one starts on the effective day, with the same policies.' : 'No attendance profile found; setup will be flagged.'}</Row>
                <Row label="Pending leave">{preview.pendingLeave.length === 0 ? 'None' : `${preview.pendingLeave.length} pending request(s) will be rerouted with an audit trail.`}</Row>
                <Row label="Leave awaiting their approval">{preview.leaveApprovalsRoutedToThem}</Row>
                <Row label="Corrections">{preview.corrections.own.length} own · {preview.corrections.awaitingTheirApproval} awaiting their approval</Row>
                <Row label="Tickets in review">
                  {preview.ticketsWaitingForReview.length === 0 ? 'None' : (
                    <ul className="list-disc pl-4">
                      {preview.ticketsWaitingForReview.map((t) => <li key={t.id}>{t.title} <span className="text-xs opacity-70">(its original reviewer is kept for this review only)</span></li>)}
                    </ul>
                  )}
                </Row>
                <Row label="Tickets">{preview.tickets.owned} created · {preview.tickets.assigned} assigned · {preview.tickets.coAssigned} co-assigned. Nothing is closed, deleted or reassigned.</Row>
                <Row label="Projects and teams">{preview.projects} project(s), {preview.teams} team(s). Listed for review; memberships are not changed.</Row>
                <Row label="Pending change requests">{preview.pendingChangeRequests}</Row>
              </dl>

              <fieldset className="mt-4 space-y-2">
                <legend className="text-sm font-semibold">When does it take effect?</legend>
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" name="when" checked={mode === 'today'} disabled={!preview.canApplyToday} onChange={() => setMode('today')} />
                  <span>
                    Apply today ({preview.today})
                    {!preview.canApplyToday && (
                      <span className="block text-xs opacity-80">
                        Not available: {preview.todayBlockers.map((b) => BLOCKER_TEXT[b] ?? b).join(', ')}.
                      </span>
                    )}
                  </span>
                </label>
                <label className="flex flex-wrap items-center gap-2 text-sm">
                  <input type="radio" name="when" checked={mode === 'later'} onChange={() => setMode('later')} />
                  <span>Start on</span>
                  <input type="date" className="apex-input" min={preview.earliestScheduledDay} value={effectiveOn} onChange={(e) => { setEffectiveOn(e.target.value); setMode('later'); }} aria-label="Effective date" />
                </label>
              </fieldset>

              <label className="mt-3 block text-sm">
                <span className="mb-1 block font-medium">Reason (optional)</span>
                <input className="apex-input w-full" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
            </section>
          )}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t p-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <button type="button" className="apex-btn apex-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="apex-btn apex-btn-secondary" disabled={busy || unchanged || !toRoleId} onClick={() => { setStaleNotice(false); previewMutation.mutate(); }}>
            {previewMutation.isPending ? 'Calculating…' : preview ? 'Refresh impact' : 'Preview impact'}
          </button>
          <button type="button" className="apex-btn apex-btn-primary" disabled={busy || !preview || (mode === 'later' && !effectiveOn)} onClick={() => confirmMutation.mutate()}>
            {confirmMutation.isPending ? 'Saving…' : mode === 'today' ? 'Confirm and apply' : 'Confirm and schedule'}
          </button>
        </footer>
      </div>
      <RemediationDialog {...remediation.dialogProps} runAction={runner} />
    </div>
  );
}
