'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CorrectionScreenshots } from './CorrectionScreenshots';
import { decideRegularization, getPendingRegularizations, stageLabel, type Regularization } from './regularization-api';
import { formatTime } from './attendance-status';
import { useAuthStore } from '@apex/core-identity';
import { refreshAttendanceViews } from './attendance-refresh';

export function RegularizationQueue({ scope }: { scope: 'team' | 'company' }) {
  const qc = useQueryClient();
  const actorId = useAuthStore((state) => state.user?.id);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{ id: string; decision: 'APPROVE' | 'REJECT' } | null>(null);
  const [reason, setReason] = useState('');
  const [creatorConfirmed, setCreatorConfirmed] = useState(false);
  const [grantedStatus, setGrantedStatus] = useState<'PRESENT' | 'HALF_DAY' | ''>('');
  const query = useQuery({ queryKey: ['regularization-queue', scope], queryFn: () => getPendingRegularizations(scope), staleTime: 30_000, retry: false });
  const rows = query.data?.items ?? [];
  const settle = useMutation({
    mutationFn: ({ row, decision }: { row: Regularization; decision: 'APPROVE' | 'REJECT' }) => decideRegularization(row.id, { decision, reason: reason.trim(), reviewedFingerprint: row.current?.fingerprint ?? null, confirmCreatorDecision: row.createdById === actorId ? creatorConfirmed : undefined, grantedStatus: decision === 'APPROVE' && grantedStatus ? grantedStatus : undefined }),
    onSuccess: () => { setError(null); setDeciding(null); setReason(''); setCreatorConfirmed(false); setGrantedStatus(''); void refreshAttendanceViews(qc); },
    onError: (err: any) => { const p = err?.response?.data ?? err; setError(p?.message ?? 'The decision could not be recorded.'); if (p?.code === 'CORRECTION_STALE' || p?.code === 'CORRECTION_ALREADY_DECIDED') qc.invalidateQueries({ queryKey: ['regularization-queue', scope] }); },
  });
  if (query.isLoading) return <p className="apex-text-muted py-6 text-center text-sm">Loading requests…</p>;
  if (query.isError) {
    const status = (query.error as any)?.response?.status;
    return <div role="alert" className="py-6 text-center"><p className="apex-text-muted text-sm">{status === 403 ? 'The company queue is for HR and administrators.' : 'The review queue could not be loaded.'}</p><button type="button" className="apex-btn apex-btn-secondary mt-3" onClick={() => query.refetch()}>Retry</button></div>;
  }
  if (!rows.length) return <p className="apex-text-muted py-6 text-center text-sm">Nothing is waiting for your review.</p>;
  return <div className="grid grid-cols-1 gap-4">
    {error && <p role="alert" className="col-span-full text-xs text-red-600 dark:text-red-400">{error}</p>}
    {rows.map((row) => { const selected = deciding?.id === row.id; const isCreatorDecision = row.createdById === actorId; const needsStatus = row.requestType === 'INCORRECT_ATTENDANCE_STATUS' && deciding?.decision === 'APPROVE'; return <article key={row.id} className="apex-card" aria-label={`Correction for ${row.user?.name ?? 'employee'}`}>
      <div className="flex items-start justify-between gap-4"><div className="min-w-0 flex-1 rounded-xl border border-[#0F172A] p-3"><p className="flex flex-wrap items-baseline gap-x-1.5"><span className="text-[21px] font-semibold leading-tight text-[#0F172A] dark:text-slate-100">{row.user?.name ?? 'Employee'}</span><span className="text-sm font-medium text-[#334155] dark:text-slate-300">· {new Date(row.date).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</span></p><p className="mt-2 text-sm text-[#64748B] dark:text-slate-400">{row.reason}</p>{row.eligibleVia && <p className="mt-1.5 text-xs font-medium text-[#16A34A] dark:text-green-400">Eligible as {eligibilityLabel(row.eligibleVia)}</p>}</div><span className="apex-text-muted shrink-0 rounded-md bg-[var(--bg-tertiary)] px-2 py-1 text-[11px]">{stageLabel(row.status, row.applicationStatus)}</span></div>
      {row.status === 'STALE_REVIEW_REQUIRED' && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">Attendance changed after the earlier review. Compare the current values and decide this same request again.</p>}
      <CorrectionScreenshots requestId={row.id} files={row.screenshots ?? []} />
      <div className="mt-4 h-px w-full bg-[#2563EB]" aria-hidden="true" />
      <dl className="mt-3 grid grid-cols-2 gap-4 2xl:grid-cols-4"><Fact label="Requested in" value={formatTime(row.requestedPunchIn)} /><Fact label="Requested out" value={formatTime(row.requestedPunchOut)} /><Fact label="Current in" value={formatTime(row.current?.punchInAt ?? null)} /><Fact label="Current out" value={formatTime(row.current?.punchOutAt ?? null)} /></dl>
      {selected ? <div className="mt-3 rounded-lg border border-[var(--border-secondary)] p-3"><label htmlFor={`decision-reason-${row.id}`} className="apex-text text-xs font-medium">Reason for {deciding.decision === 'APPROVE' ? 'approval' : 'rejection'}</label><textarea id={`decision-reason-${row.id}`} name="decisionReason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="apex-input mt-1 w-full text-sm" placeholder="This becomes part of the audit history." />{needsStatus && <><label htmlFor={`granted-status-${row.id}`} className="apex-text mt-3 block text-xs font-medium">Status to grant</label><select id={`granted-status-${row.id}`} name="grantedStatus" value={grantedStatus} onChange={(e) => setGrantedStatus(e.target.value as 'PRESENT' | 'HALF_DAY' | '')} className="apex-input mt-1 w-full text-sm"><option value="">Choose a status</option><option value="PRESENT">Present</option><option value="HALF_DAY">Half Day</option></select><p className="apex-text-muted mt-1 text-xs">If the day cannot take this status, the approval is held for HR instead of changing attendance.</p></>}{isCreatorDecision && <label htmlFor={`creator-confirm-${row.id}`} className="apex-text mt-3 flex items-start gap-2 text-xs"><input id={`creator-confirm-${row.id}`} name="confirmCreatorDecision" type="checkbox" checked={creatorConfirmed} onChange={(e) => setCreatorConfirmed(e.target.checked)} className="mt-0.5" /><span>I entered this manual recovery and separately confirm that I am also making its final decision.</span></label>}<div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => { setDeciding(null); setReason(''); setCreatorConfirmed(false); setGrantedStatus(''); }} className="apex-btn apex-btn-secondary">Cancel</button><button type="button" disabled={settle.isPending || reason.trim().length < 3 || (isCreatorDecision && !creatorConfirmed) || (needsStatus && !grantedStatus)} onClick={() => settle.mutate({ row, decision: deciding.decision })} className="apex-btn apex-btn-primary disabled:opacity-50">Confirm {deciding.decision === 'APPROVE' ? 'approval' : 'rejection'}</button></div></div> : <div className="mt-5 flex justify-end gap-3"><button type="button" onClick={() => { setDeciding({ id: row.id, decision: 'REJECT' }); setReason(''); setCreatorConfirmed(false); setGrantedStatus(''); }} className="inline-flex items-center justify-center rounded-lg border border-red-500 px-4 py-2 text-sm font-semibold text-red-600 transition-all duration-200 hover:bg-red-500 hover:text-white hover:shadow-[0_0_16px_rgba(239,68,68,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:text-red-400">Reject</button><button type="button" onClick={() => { setDeciding({ id: row.id, decision: 'APPROVE' }); setReason(''); setCreatorConfirmed(false); setGrantedStatus(''); }} className="inline-flex items-center justify-center rounded-lg border border-green-600 bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-all duration-200 hover:border-green-500 hover:bg-green-500 hover:shadow-[0_0_16px_rgba(34,197,94,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2">Approve</button></div>}
    </article>; })}
  </div>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-semibold uppercase tracking-wide text-[#475569] dark:text-slate-300">{label}</dt><dd className="mt-1 text-sm font-semibold text-[#0F172A] dark:text-slate-100">{value}</dd></div>; }
function eligibilityLabel(via: string) { return ({ EMPLOYEE_TL: 'Team Lead', REPORTING_MANAGER: 'Manager', HR: 'HR', ADMIN: 'Admin', SUPER_ADMIN: 'Super Admin' } as Record<string, string>)[via] ?? via; }
