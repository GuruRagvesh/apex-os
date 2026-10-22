'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { RemediationDialog, useRemediation } from '@apex/shared-remediation';
import { createRemediationActionRunner } from '@apex/shared-remediation/api';
import { ClearanceItem, ExitTimeline, FnfStaff, messageFor, newKey, transitionsApi } from './transitions-api';

/**
 * Exit, clearance and F&F (Workstreams B and C). `mode="staff"` is the HR /
 * Admin view inside a user's profile; `mode="self"` is the employee's own
 * "My resignation" page, which shows only their own records, approved F&F
 * amounts with safe reasons, and never notes or references.
 */

const STATE_LABEL: Record<string, string> = {
  NOTICE_RUNNING: 'Serving notice',
  CLEARANCE_IN_PROGRESS: 'Clearance in progress',
  CLEARED: 'Cleared',
  WITHDRAWN: 'Withdrawn',
  COMPLETED: 'Completed',
};
const ITEM_LABEL: Record<string, string> = { PENDING: 'Pending', IN_PROGRESS: 'In progress', DONE: 'Done', WAIVED: 'Waived', NOT_APPLICABLE: 'Not applicable', CANCELLED: 'Cancelled' };
const FNF_LABEL: Record<string, string> = { NOT_STARTED: 'Not started', ON_HOLD_REVIEW_REQUIRED: 'On hold: review required', READY_FOR_RELEASE: 'Ready for release', RELEASED: 'Released', CANCELLED: 'Cancelled' };
const EVENT_LABEL: Record<string, string> = {
  RESIGNATION_STARTED: 'Resignation submitted', NOTICE_ADJUSTED: 'Notice period changed', NOTICE_WAIVED: 'Notice waived', RESIGNATION_WITHDRAWN: 'Resignation withdrawn',
  EMPLOYEE_SEPARATED: 'Last working day ended; access closed', EXIT_CLEARED: 'Clearance complete', EXIT_CLEARANCE_REOPENED: 'Clearance reopened', EXIT_COMPLETED: 'Exit completed',
  FNF_STATE_CHANGED: 'F&F status changed', FNF_RELEASED: 'F&F released', FNF_OVERDUE_ESCALATED: 'F&F overdue: HR and Admin notified', CLEARANCE_COMPLETED: 'Clearance item completed',
  CLEARANCE_WAIVED: 'Clearance item waived', CLEARANCE_NOT_APPLICABLE: 'Clearance item not applicable', CLEARANCE_REASSIGNED: 'Clearance item reassigned',
  FNF_ADJUSTMENT_REQUESTED: 'F&F adjustment requested', FNF_ADJUSTMENT_APPROVED: 'F&F adjustment approved', FNF_ADJUSTMENT_REJECTED: 'F&F adjustment rejected', FNF_ADJUSTMENT_CANCELLED: 'F&F adjustment cancelled',
};

const fmt = (iso?: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'good' | 'warn' }) {
  const bg = tone === 'good' ? 'rgba(16,185,129,.15)' : tone === 'warn' ? 'rgba(217,119,6,.15)' : 'var(--bg-tertiary)';
  return <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: bg, color: 'var(--text-primary)' }}>{children}</span>;
}

function useActions(onDone: () => void) {
  const remediation = useRemediation();
  const runner = useMemo(createRemediationActionRunner, []);
  const fail = (err: any) => {
    // Coded refusals open the remediation dialog over the form; the form keeps its values.
    if (remediation.openFrom(err)) return;
    toast.error(messageFor(err));
  };
  return { remediation, runner, fail, done: onDone };
}

function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-label={title} className="apex-card flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3 className="border-b p-4 text-base font-semibold" style={{ borderColor: 'var(--border-subtle)' }}>{title}</h3>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{children}</div>
        <div className="flex justify-end gap-2 border-t p-3" style={{ borderColor: 'var(--border-subtle)' }}>{footer}</div>
      </div>
    </div>
  );
}

// ── Notice adjustment / waiver ──
function NoticeDialog({ exit, onClose, onSaved }: { exit: ExitTimeline; onClose: () => void; onSaved: () => void }) {
  const a = useActions(onSaved);
  const key = useRef(newKey());
  const [mode, setMode] = useState<'CONTRACT' | 'MANAGEMENT_ADJUSTMENT' | 'WAIVE'>('MANAGEMENT_ADJUSTMENT');
  const [days, setDays] = useState(String(exit.noticeDays));
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const save = useMutation({
    mutationFn: () => transitionsApi.adjustNotice(exit.id, mode === 'WAIVE'
      ? { waive: true, reason, idempotencyKey: key.current }
      : { source: mode, noticeDays: Number(days), reason: reason || undefined, reference: reference || undefined, idempotencyKey: key.current }),
    onSuccess: () => { toast.success('Notice updated.'); a.done(); onClose(); },
    onError: a.fail,
  });
  const invalid = (mode !== 'CONTRACT' && !reason.trim()) || (mode === 'CONTRACT' && !reference.trim()) || (mode !== 'WAIVE' && !(Number(days) >= 0));
  return (
    <Dialog title="Change notice period" onClose={onClose} footer={<>
      <button className="apex-btn apex-btn-secondary" onClick={onClose}>Cancel</button>
      <button className="apex-btn apex-btn-primary" disabled={invalid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save'}</button>
    </>}>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Currently {exit.noticeDays} days ({exit.noticeSource.replace(/_/g, ' ').toLowerCase()}), last working day {fmt(exit.lastWorkingDay)}. The actor, time and reason are recorded.</p>
      <label className="block text-sm"><span className="mb-1 block font-medium">Basis</span>
        <select className="apex-input w-full" value={mode} onChange={(e) => setMode(e.target.value as any)}>
          <option value="MANAGEMENT_ADJUSTMENT">Management adjustment</option>
          <option value="CONTRACT">Contract term</option>
          <option value="WAIVE">Waive notice (0 days)</option>
        </select>
      </label>
      {mode !== 'WAIVE' && <label className="block text-sm"><span className="mb-1 block font-medium">Notice days</span><input type="number" min={0} max={180} className="apex-input w-full" value={days} onChange={(e) => setDays(e.target.value)} /></label>}
      {mode === 'CONTRACT' && <label className="block text-sm"><span className="mb-1 block font-medium">Contract reference</span><input className="apex-input w-full" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} /></label>}
      {mode !== 'CONTRACT' && <label className="block text-sm"><span className="mb-1 block font-medium">Reason</span><textarea className="apex-input w-full" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
      <RemediationDialog {...a.remediation.dialogProps} runAction={a.runner} />
    </Dialog>
  );
}

// ── Clearance item ──
function ClearanceRow({ item, canManage, canProgress, onChanged }: { item: ClearanceItem; canManage: boolean; canProgress: boolean; onChanged: () => void }) {
  const a = useActions(onChanged);
  const [evidence, setEvidence] = useState('');
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState<null | 'WAIVE' | 'NOT_APPLICABLE'>(null);
  const run = useMutation({
    mutationFn: (v: { action: any; evidenceRef?: string; reason?: string }) => transitionsApi.updateClearance(item.id, { ...v, idempotencyKey: newKey() }),
    onSuccess: () => { setOpen(null); setReason(''); a.done(); },
    onError: a.fail,
  });
  const finished = ['DONE', 'WAIVED', 'NOT_APPLICABLE', 'CANCELLED'].includes(item.status);
  return (
    <li className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{item.label}</p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {item.ownerNeeded ? 'Owner needed' : item.ownerCapability === 'HR' ? 'Owned by HR' : item.ownerCapability === 'ADMIN' ? 'Owned by Admin' : item.ownerId ? 'Owner assigned' : ''}
            {item.evidenceRequired ? ' · evidence reference required' : ''}
          </p>
        </div>
        <Badge tone={item.status === 'DONE' || item.status === 'WAIVED' || item.status === 'NOT_APPLICABLE' ? 'good' : item.ownerNeeded ? 'warn' : 'neutral'}>{ITEM_LABEL[item.status]}</Badge>
      </div>
      {item.evidenceRef && <p className="text-xs">Reference: <code>{item.evidenceRef}</code></p>}
      {item.waiverReason && <p className="text-xs">Waived: {item.waiverReason}</p>}
      {!finished && canProgress && (
        <div className="flex flex-wrap items-end gap-2">
          {item.status === 'PENDING' && <button className="apex-btn apex-btn-secondary" disabled={run.isPending} onClick={() => run.mutate({ action: 'START' })}>Start</button>}
          {item.evidenceRequired && <label className="text-xs"><span className="sr-only">Evidence reference for {item.label}</span><input className="apex-input" placeholder="e.g. AST-2026-0042" value={evidence} onChange={(e) => setEvidence(e.target.value.toUpperCase())} /></label>}
          <button className="apex-btn apex-btn-primary" disabled={run.isPending || (item.evidenceRequired && !evidence)} onClick={() => run.mutate({ action: 'DONE', evidenceRef: evidence || undefined })}>Mark done</button>
          {canManage && <button className="apex-btn apex-btn-secondary" onClick={() => setOpen('WAIVE')}>Waive</button>}
          {canManage && <button className="apex-btn apex-btn-secondary" onClick={() => setOpen('NOT_APPLICABLE')}>Not applicable</button>}
        </div>
      )}
      {open && (
        <Dialog title={open === 'WAIVE' ? `Waive “${item.label}”` : `Mark “${item.label}” not applicable`} onClose={() => setOpen(null)} footer={<>
          <button className="apex-btn apex-btn-secondary" onClick={() => setOpen(null)}>Cancel</button>
          <button className="apex-btn apex-btn-primary" disabled={!reason.trim() || run.isPending} onClick={() => run.mutate({ action: open, reason })}>Confirm</button>
        </>}>
          <label className="block text-sm"><span className="mb-1 block font-medium">Reason (recorded with your name)</span><textarea className="apex-input w-full" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        </Dialog>
      )}
      <RemediationDialog {...a.remediation.dialogProps} runAction={a.runner} />
    </li>
  );
}

// ── F&F ──
function FnfSection({ exit, mode, meId, isAdmin, onChanged }: { exit: ExitTimeline; mode: 'staff' | 'self'; meId?: string; isAdmin: boolean; onChanged: () => void }) {
  const s = exit.settlement as FnfStaff | null;
  const a = useActions(onChanged);
  const [releaseRef, setReleaseRef] = useState('');
  const [adj, setAdj] = useState({ kind: 'OTHER', direction: 'DEBIT', amount: '', reasonCode: 'OTHER_ADJUSTMENT', reference: '', note: '' });
  const [showAdj, setShowAdj] = useState(false);
  const relKey = useRef(newKey());
  const adjKey = useRef(newKey());
  const release = useMutation({ mutationFn: () => transitionsApi.releaseFnf(exit.id, { releaseReference: releaseRef, idempotencyKey: relKey.current }), onSuccess: () => { toast.success('F&F released.'); a.done(); }, onError: a.fail });
  const request = useMutation({
    mutationFn: () => transitionsApi.requestAdjustment(exit.id, { ...adj, amount: Number(adj.amount), idempotencyKey: adjKey.current }),
    onSuccess: () => { toast.success('Adjustment sent for a second Admin to approve.'); setShowAdj(false); adjKey.current = newKey(); a.done(); },
    onError: a.fail,
  });
  const decide = useMutation({ mutationFn: (v: { id: string; decision: 'APPROVE' | 'REJECT'; reason?: string }) => transitionsApi.decideAdjustment(v.id, v), onSuccess: () => a.done(), onError: a.fail });
  if (!s) return null;
  const REASONS: Record<string, string[]> = {
    ATTENDANCE: ['UNPAID_ABSENCE', 'ATTENDANCE_CORRECTION'], MISCONDUCT: ['POLICY_BREACH'], ASSET_RECOVERY: ['ASSET_NOT_RETURNED', 'ASSET_DAMAGE'],
    NOTICE_RECOVERY: ['NOTICE_SHORTFALL', 'NOTICE_BUYOUT'], OTHER: ['REIMBURSEMENT', 'BONUS_OR_INCENTIVE', 'LEAVE_ENCASHMENT', 'OTHER_ADJUSTMENT'],
  };
  return (
    <section aria-label="Full and final settlement" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Full and final settlement</h4>
        <Badge tone={s.state === 'RELEASED' ? 'good' : s.state === 'ON_HOLD_REVIEW_REQUIRED' ? 'warn' : 'neutral'}>{FNF_LABEL[s.state]}</Badge>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        Deadline {fmt(s.deadlineOn)} (eighth working day after the last working day). Nothing is forfeited or deducted automatically.
        {s.state === 'ON_HOLD_REVIEW_REQUIRED' && ' The deadline passed with clearance or an adjustment still open; HR and Admin are reminded every 3 working days.'}
      </p>
      {s.adjustments.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <caption className="sr-only">Approved F&F adjustments</caption>
            <thead><tr className="text-left text-xs" style={{ color: 'var(--text-tertiary)' }}><th className="py-1 pr-2">Type</th><th className="pr-2">Debit / credit</th><th className="pr-2">Amount</th><th>Reason</th></tr></thead>
            <tbody>
              {s.adjustments.map((x) => (
                <tr key={x.id} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="py-1 pr-2">{x.kind.replace(/_/g, ' ').toLowerCase()}{x.reversesId ? ' (reversal)' : ''}</td>
                  <td className="pr-2">{x.direction === 'DEBIT' ? 'Debit' : 'Credit'}</td>
                  <td className="pr-2">{x.currency} {x.amount}</td>
                  <td>{mode === 'self' ? x.reason : x.reasonCode.replace(/_/g, ' ').toLowerCase()}{mode === 'staff' && x.reference ? ` · ${x.reference}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mode === 'staff' && (s.requests ?? []).filter((q) => q.status === 'PENDING').map((q) => (
        <div key={q.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm" style={{ borderColor: 'var(--border-subtle)' }}>
          <span>Pending: {q.direction.toLowerCase()} {q.currency} {q.amount}, {q.reasonCode.replace(/_/g, ' ').toLowerCase()}{q.reversesId ? ' (reversal)' : ''}</span>
          <span className="flex gap-2">
            {isAdmin && q.requestedById !== meId && <>
              <button className="apex-btn apex-btn-primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: q.id, decision: 'APPROVE' })}>Approve</button>
              <button className="apex-btn apex-btn-secondary" disabled={decide.isPending} onClick={() => { const reason = window.prompt('Why are you rejecting this adjustment?'); if (reason) decide.mutate({ id: q.id, decision: 'REJECT', reason }); }}>Reject</button>
            </>}
            {q.requestedById === meId && <em className="text-xs">Waiting for a different Admin</em>}
          </span>
        </div>
      ))}
      {mode === 'staff' && !['RELEASED', 'CANCELLED'].includes(s.state) && (
        <div className="space-y-2">
          <button className="apex-btn apex-btn-secondary" onClick={() => setShowAdj((v) => !v)} aria-expanded={showAdj}>{showAdj ? 'Hide adjustment form' : 'Request an adjustment'}</button>
          {showAdj && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-sm"><span className="block font-medium">Type</span><select className="apex-input w-full" value={adj.kind} onChange={(e) => setAdj({ ...adj, kind: e.target.value, reasonCode: REASONS[e.target.value][0] })}>{Object.keys(REASONS).map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ').toLowerCase()}</option>)}</select></label>
              <label className="text-sm"><span className="block font-medium">Reason</span><select className="apex-input w-full" value={adj.reasonCode} onChange={(e) => setAdj({ ...adj, reasonCode: e.target.value })}>{REASONS[adj.kind].map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ').toLowerCase()}</option>)}</select></label>
              <label className="text-sm"><span className="block font-medium">Debit or credit</span><select className="apex-input w-full" value={adj.direction} onChange={(e) => setAdj({ ...adj, direction: e.target.value })}><option value="DEBIT">Debit</option><option value="CREDIT">Credit</option></select></label>
              <label className="text-sm"><span className="block font-medium">Amount (INR)</span><input type="number" min="0.01" step="0.01" className="apex-input w-full" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} /></label>
              <label className="text-sm sm:col-span-2"><span className="block font-medium">Supporting reference</span><input className="apex-input w-full" maxLength={120} value={adj.reference} onChange={(e) => setAdj({ ...adj, reference: e.target.value })} /></label>
              <label className="text-sm sm:col-span-2"><span className="block font-medium">Internal note (never shown to the employee)</span><textarea className="apex-input w-full" rows={2} maxLength={1000} value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></label>
              <div className="sm:col-span-2"><button className="apex-btn apex-btn-primary" disabled={request.isPending || !(Number(adj.amount) > 0) || !adj.reference.trim()} onClick={() => request.mutate()}>{request.isPending ? 'Sending…' : 'Send for approval'}</button></div>
            </div>
          )}
        </div>
      )}
      {mode === 'staff' && isAdmin && s.state === 'READY_FOR_RELEASE' && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm"><span className="block font-medium">Payment reference</span><input className="apex-input" maxLength={120} value={releaseRef} onChange={(e) => setReleaseRef(e.target.value)} /></label>
          <button className="apex-btn apex-btn-primary" disabled={!releaseRef.trim() || release.isPending} onClick={() => release.mutate()}>Release F&F</button>
        </div>
      )}
      {mode === 'self' && s.state !== 'RELEASED' && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>You will be notified when your settlement is released.</p>}
      <RemediationDialog {...a.remediation.dialogProps} runAction={a.runner} />
    </section>
  );
}

// ── Timeline ──
export function ExitTimelineView({ exit, mode, me, isHR, isAdmin, onChanged }: { exit: ExitTimeline; mode: 'staff' | 'self'; me?: { id: string }; isHR: boolean; isAdmin: boolean; onChanged: () => void }) {
  const [notice, setNotice] = useState(false);
  const a = useActions(onChanged);
  const wKey = useRef(newKey());
  const withdraw = useMutation({ mutationFn: () => transitionsApi.withdraw(exit.id, { idempotencyKey: wKey.current }), onSuccess: () => { toast.success('Resignation withdrawn.'); a.done(); }, onError: a.fail });
  const staff = mode === 'staff';
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={exit.state === 'WITHDRAWN' ? 'neutral' : exit.state === 'COMPLETED' ? 'good' : 'warn'}>{STATE_LABEL[exit.state]}</Badge>
        <span className="text-sm">Submitted {fmt(exit.resignedOn)} · {exit.noticeDays}-day notice · last working day <strong>{fmt(exit.lastWorkingDay)}</strong></span>
      </div>
      <div className="flex flex-wrap gap-2">
        {exit.canWithdraw && <button className="apex-btn apex-btn-secondary" disabled={withdraw.isPending} onClick={() => window.confirm('Withdraw this resignation? Employment continues as before.') && withdraw.mutate()}>Withdraw resignation</button>}
        {staff && isHR && exit.state === 'NOTICE_RUNNING' && <button className="apex-btn apex-btn-secondary" onClick={() => setNotice(true)}>Change notice period</button>}
      </div>
      {exit.state === 'NOTICE_RUNNING' && exit.canWithdraw && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Withdrawal closes when the last working day starts ({fmt(exit.withdrawalClosesAt)}).</p>}

      <section aria-label="Clearance checklist" className="space-y-2">
        <h4 className="text-sm font-semibold">Clearance</h4>
        <ul className="space-y-2">
          {exit.clearance.map((i) => <ClearanceRow key={i.id} item={i} canManage={staff && isHR} canProgress={staff} onChanged={onChanged} />)}
        </ul>
      </section>

      <FnfSection exit={exit} mode={mode} meId={me?.id} isAdmin={isAdmin} onChanged={onChanged} />

      <section aria-label="History" className="space-y-1">
        <h4 className="text-sm font-semibold">History</h4>
        <ol className="space-y-1 border-l pl-3" style={{ borderColor: 'var(--border-subtle)' }}>
          {exit.events.map((e) => <li key={e.id} className="text-sm"><span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{fmt(e.timestamp)}</span> {EVENT_LABEL[e.action] ?? e.action.replace(/_/g, ' ').toLowerCase()}</li>)}
        </ol>
      </section>
      {notice && <NoticeDialog exit={exit} onClose={() => setNotice(false)} onSaved={onChanged} />}
      <RemediationDialog {...a.remediation.dialogProps} runAction={a.runner} />
    </div>
  );
}

// ── Start / verify ──
function StartExit({ userId, isHR, self, verified, onChanged }: { userId: string; isHR: boolean; self: boolean; verified: boolean; onChanged: () => void }) {
  const a = useActions(onChanged);
  const key = useRef(newKey());
  const vKey = useRef(newKey());
  const [resignedOn, setResignedOn] = useState('');
  const [backReason, setBackReason] = useState('');
  const [backRef, setBackRef] = useState('');
  const [status, setStatus] = useState<'PROBATION' | 'CONFIRMED'>('CONFIRMED');
  const start = useMutation({
    mutationFn: () => transitionsApi.startExit(userId, { resignedOn: resignedOn || undefined, backdateReason: backReason || undefined, backdateReference: backRef || undefined, idempotencyKey: key.current }),
    onSuccess: () => { toast.success('Resignation recorded.'); a.done(); },
    onError: a.fail,
  });
  const verify = useMutation({ mutationFn: () => transitionsApi.verifyProbation(userId, status, vKey.current), onSuccess: () => { toast.success('Probation status verified.'); vKey.current = newKey(); a.done(); }, onError: a.fail });
  return (
    <div className="space-y-3">
      {isHR && !verified && (
        <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <p className="text-sm font-medium">Verify probation status</p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Decides the notice period: 15 days on probation, 30 once confirmed. Required before a resignation.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select aria-label="Probation status" className="apex-input" value={status} onChange={(e) => setStatus(e.target.value as any)}><option value="CONFIRMED">Confirmed</option><option value="PROBATION">On probation</option></select>
            <button className="apex-btn apex-btn-secondary" disabled={verify.isPending} onClick={() => verify.mutate()}>Verify</button>
          </div>
        </div>
      )}
      {(isHR || self) && (
        <div className="space-y-2">
          <p className="text-sm font-medium">{self ? 'Submit your resignation' : 'Record a resignation'}</p>
          {isHR && !self && (
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="text-sm"><span className="block font-medium">Resignation date (optional)</span><input type="date" className="apex-input w-full" max={new Date().toISOString().slice(0, 10)} value={resignedOn} onChange={(e) => setResignedOn(e.target.value)} /></label>
              {resignedOn && <>
                <label className="text-sm"><span className="block font-medium">Backdating reason</span><input className="apex-input w-full" value={backReason} onChange={(e) => setBackReason(e.target.value)} /></label>
                <label className="text-sm"><span className="block font-medium">Supporting reference</span><input className="apex-input w-full" value={backRef} onChange={(e) => setBackRef(e.target.value)} /></label>
              </>}
            </div>
          )}
          <button className="apex-btn apex-btn-primary" disabled={start.isPending} onClick={() => window.confirm(self ? 'Submit your resignation? Your notice period starts today.' : 'Record this resignation?') && start.mutate()}>{start.isPending ? 'Saving…' : self ? 'Submit resignation' : 'Record resignation'}</button>
        </div>
      )}
      <RemediationDialog {...a.remediation.dialogProps} runAction={a.runner} />
    </div>
  );
}

/** The Exit tab on a user's profile (HR / Admin / the person's supervisors). */
export function ExitTab({ userId, viewer }: { userId: string; viewer: { id: string; isHR: boolean; isAdmin: boolean } }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['exit', userId], queryFn: () => transitionsApi.exitForUser(userId), retry: false });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['exit', userId] }); qc.invalidateQueries({ queryKey: ['users'] }); };
  if (q.isLoading) return <p className="text-sm" role="status">Loading exit details…</p>;
  if (q.isError) return <p className="text-sm" role="alert">Exit details are not available right now.</p>;
  const cases = q.data?.cases ?? [];
  const open = cases.find((c) => ['NOTICE_RUNNING', 'CLEARANCE_IN_PROGRESS', 'CLEARED'].includes(c.state));
  const past = cases.filter((c) => c !== open);
  return (
    <div className="space-y-6">
      {open ? <ExitTimelineView exit={open} mode="staff" me={viewer} isHR={viewer.isHR || viewer.isAdmin} isAdmin={viewer.isAdmin} onChanged={refresh} />
        : <StartExit userId={userId} isHR={viewer.isHR || viewer.isAdmin} self={false} verified={!!q.data?.employmentPeriod?.probationVerifiedAt} onChanged={refresh} />}
      {past.length > 0 && (
        <section aria-label="Earlier exits"><h4 className="mb-2 text-sm font-semibold">Earlier exits</h4>
          <ul className="space-y-1 text-sm">{past.map((c) => <li key={c.id}>{fmt(c.resignedOn)}: {STATE_LABEL[c.state]}</li>)}</ul>
        </section>
      )}
    </div>
  );
}

/** The employee's own "My resignation" page. */
export function MyResignation({ me }: { me: { id: string } }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['exit', me.id], queryFn: () => transitionsApi.exitForUser(me.id), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ['exit', me.id] });
  if (q.isLoading) return <p role="status">Loading…</p>;
  if (q.isError) return <p role="alert">This page is not available right now.</p>;
  const cases = q.data?.cases ?? [];
  const open = cases.find((c) => ['NOTICE_RUNNING', 'CLEARANCE_IN_PROGRESS', 'CLEARED'].includes(c.state));
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-4">
      <header><h1 className="text-xl font-semibold">My resignation</h1><p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Your notice period, clearance and settlement. Only you and authorised reviewers can see this.</p></header>
      {open ? <ExitTimelineView exit={open} mode="self" me={me} isHR={false} isAdmin={false} onChanged={refresh} />
        : <StartExit userId={me.id} isHR={false} self verified onChanged={refresh} />}
      {cases.filter((c) => c !== open).map((c) => <p key={c.id} className="text-sm">{fmt(c.resignedOn)}: {STATE_LABEL[c.state]}</p>)}
    </div>
  );
}

/** Clearance items the viewer owns, across all open exits. */
export function MyClearanceItems() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['clearance-mine'], queryFn: transitionsApi.myClearance, retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ['clearance-mine'] });
  if (q.isLoading) return <p role="status">Loading…</p>;
  if (!q.data?.length) return <p className="text-sm">You have no clearance items to complete.</p>;
  return (
    <ul className="space-y-2">
      {q.data.map((i) => (
        <li key={i.id}>
          <p className="mb-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>{i.employee.name} · last working day {fmt(i.lastWorkingDay)}</p>
          <ul><ClearanceRow item={i} canManage={false} canProgress onChanged={refresh} /></ul>
        </li>
      ))}
    </ul>
  );
}
