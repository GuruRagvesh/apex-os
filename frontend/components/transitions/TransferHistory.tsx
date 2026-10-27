'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { RemediationDialog, useRemediation } from '@apex/shared-remediation';
import { createRemediationActionRunner } from '@apex/shared-remediation/api';
import { messageFor, newKey, TransferView, transitionsApi } from './transitions-api';

const STATUS_LABEL: Record<string, string> = { SCHEDULED: 'Scheduled', REVIEW_REQUIRED: 'Needs review', COMPLETED: 'Completed', CANCELLED: 'Cancelled', FAILED: 'Failed' };
const REVIEW_REASON: Record<string, string> = {
  TRANSFER_STALE_AT_ACTIVATION: 'Something changed after it was scheduled, so it was not applied.',
  TRANSFER_EFFECTIVE_DAY_NOT_CLEAN: 'The effective day already has attendance or payroll activity, so it was not applied.',
};
const IMPACT_LABEL: Record<string, string> = {
  PROFILE: 'Attendance profile', HIERARCHY: 'Reporting line', OWN_LEAVE_REQUEST: 'Pending leave', LEAVE_APPROVAL: 'Leave awaiting their approval', CORRECTION: 'Correction',
  TICKET_REVIEW: 'Ticket in review', TICKET: 'Ticket', PROJECT: 'Project', TEAM_MEMBERSHIP: 'Team membership', CHANGE_REQUEST: 'Change request', PERMISSION: 'Permissions',
};
const day = (iso?: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function TransferCard({ t, isAdmin, onChanged }: { t: TransferView; isAdmin: boolean; onChanged: () => void }) {
  const remediation = useRemediation();
  const runner = useMemo(createRemediationActionRunner, []);
  const cancelKey = useRef(newKey());
  const [open, setOpen] = useState(false);
  const cancel = useMutation({
    mutationFn: (reason: string) => transitionsApi.cancelTransfer(t.id, reason, cancelKey.current),
    onSuccess: () => { toast.success('Transfer cancelled.'); onChanged(); },
    onError: (err: any) => { if (!remediation.openFrom(err)) toast.error(messageFor(err)); },
  });
  const review = useMutation({ mutationFn: (id: string) => transitionsApi.markImpactReviewed(id), onSuccess: onChanged, onError: (e: any) => toast.error(messageFor(e)) });
  const pending = (t.impacts ?? []).filter((i) => i.reviewStatus === 'PENDING_REVIEW');
  return (
    <li className="space-y-2 rounded-xl border p-3 sm:p-4" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {t.employee && <Link href={`/users/${t.userId}?tab=transfers`} className="underline">{t.employee.name}</Link>}{t.employee ? ': ' : ''}
          {t.fromDepartment?.name ?? 'No department'} → {t.toDepartment?.name ?? 'No department'}; {t.fromRole.name} → {t.toRole.name}
        </p>
        <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: 'var(--bg-tertiary)' }}>{STATUS_LABEL[t.status] ?? t.status}</span>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        {t.status === 'COMPLETED' ? `Applied ${day(t.appliedAt)}` : `Effective ${day(t.effectiveOn)}`}
        {t.reason ? ` · ${t.reason}` : ''}
      </p>
      {t.status === 'REVIEW_REQUIRED' && <p role="status" className="text-sm">{REVIEW_REASON[t.reviewReasonCode ?? ''] ?? 'Review required.'} {isAdmin && 'Preview it again from the user’s profile to re-confirm, or cancel it.'}</p>}
      {isAdmin && (t.status === 'SCHEDULED' || t.status === 'REVIEW_REQUIRED') && (
        <button className="apex-btn apex-btn-secondary" disabled={cancel.isPending} onClick={() => { const reason = window.prompt('Why are you cancelling this transfer?'); if (reason?.trim()) cancel.mutate(reason.trim()); }}>Cancel transfer</button>
      )}
      {(t.impacts?.length ?? 0) > 0 && (
        <div>
          <button className="text-xs underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? 'Hide' : 'Show'} impact review ({pending.length} to review)</button>
          {open && (
            <ul className="mt-2 space-y-1">
              {t.impacts!.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{IMPACT_LABEL[i.kind] ?? i.kind}: {i.action.replace(/_/g, ' ').toLowerCase()}</span>
                  {i.reviewStatus === 'PENDING_REVIEW' && isAdmin
                    ? <button className="apex-btn apex-btn-secondary" disabled={review.isPending} onClick={() => review.mutate(i.id)}>Mark reviewed</button>
                    : <span className="text-xs opacity-70">{i.reviewStatus === 'REVIEWED' ? 'Reviewed' : i.reviewStatus === 'NO_ACTION' ? 'No action needed' : 'Needs review'}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <RemediationDialog {...remediation.dialogProps} runAction={runner} />
    </li>
  );
}

/** A person's transfer history (User detail "Transfers" tab). */
export function TransfersTab({ userId, isAdmin, onTransfer }: { userId: string; isAdmin: boolean; onTransfer?: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['transfers', userId], queryFn: () => transitionsApi.transferHistory(userId), retry: false });
  const caps = useQuery({ queryKey: ['transition-capabilities'], queryFn: transitionsApi.capabilities, retry: false, staleTime: 60_000 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['transfers'] }); qc.invalidateQueries({ queryKey: ['users'] }); };
  return (
    <div className="space-y-4">
      {isAdmin && onTransfer && (
        caps.data?.transfer.enabled
          ? <button className="apex-btn apex-btn-primary" onClick={onTransfer}>Transfer…</button>
          : <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Transfers are not enabled on this server yet.</p>
      )}
      {q.isLoading && <p role="status" className="text-sm">Loading…</p>}
      {q.isError && <p role="alert" className="text-sm">Transfer history is not available right now.</p>}
      {q.data && q.data.length === 0 && <p className="text-sm">No transfers recorded.</p>}
      <ul className="space-y-3">{(q.data ?? []).map((t) => <TransferCard key={t.id} t={t} isAdmin={isAdmin} onChanged={refresh} />)}</ul>
    </div>
  );
}

/** Company transfer review: scheduled, needs-review and impacts still to review. */
export function TransferReviewList({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['transfers', 'review', status], queryFn: () => transitionsApi.transferReview(status ? { status } : undefined), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ['transfers'] });
  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-4">
      <header>
        <h1 className="text-xl font-semibold">Transfer review</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Scheduled transfers, transfers that need a decision, and completed transfers with items still to review.</p>
      </header>
      <label className="block text-sm"><span className="mb-1 block font-medium">Show</span>
        <select className="apex-input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Needs attention</option><option value="SCHEDULED">Scheduled</option><option value="REVIEW_REQUIRED">Needs review</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option>
        </select>
      </label>
      {q.isLoading && <p role="status">Loading…</p>}
      {q.isError && <p role="alert">The review list is not available right now.</p>}
      {q.data && q.data.items.length === 0 && <p className="text-sm">Nothing to review.</p>}
      <ul className="space-y-3">{(q.data?.items ?? []).map((t) => <TransferCard key={t.id} t={t} isAdmin={isAdmin} onChanged={refresh} />)}</ul>
    </div>
  );
}
