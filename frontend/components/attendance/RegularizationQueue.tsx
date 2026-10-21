'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CorrectionScreenshots } from './CorrectionScreenshots';
import { decideRegularization, getPendingRegularizations, stageLabel, type Regularization } from './regularization-api';
import { formatTime } from './attendance-status';
import { useAuthStore } from '@apex/core-identity';

export function RegularizationQueue({ scope }: { scope: 'team' | 'company' }) {
  const qc = useQueryClient();
  const actorId = useAuthStore((state) => state.user?.id);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{ id: string; decision: 'APPROVE' | 'REJECT' } | null>(null);
  const [reason, setReason] = useState('');
  const [creatorConfirmed, setCreatorConfirmed] = useState(false);
  const query = useQuery({ queryKey: ['regularization-queue', scope], queryFn: () => getPendingRegularizations(scope), staleTime: 30_000, retry: false });
  const rows = query.data?.items ?? [];
  const settle = useMutation({
    mutationFn: ({ row, decision }: { row: Regularization; decision: 'APPROVE' | 'REJECT' }) => decideRegularization(row.id, { decision, reason: reason.trim(), reviewedFingerprint: row.current?.fingerprint ?? null, confirmCreatorDecision: row.createdById === actorId ? creatorConfirmed : undefined }),
    onSuccess: () => { setError(null); setDeciding(null); setReason(''); setCreatorConfirmed(false); qc.invalidateQueries({ queryKey: ['regularization-queue'] }); qc.invalidateQueries({ queryKey: ['regularization-counts'] }); },
    onError: (err: any) => { const p = err?.response?.data ?? err; setError(p?.message ?? 'The decision could not be recorded.'); if (p?.code === 'CORRECTION_STALE' || p?.code === 'CORRECTION_ALREADY_DECIDED') qc.invalidateQueries({ queryKey: ['regularization-queue', scope] }); },
  });
  if (query.isLoading) return <p className="apex-text-muted py-6 text-center text-sm">Loading requests…</p>;
  if (query.isError) {
    const status = (query.error as any)?.response?.status;
    return <div role="alert" className="py-6 text-center"><p className="apex-text-muted text-sm">{status === 403 ? 'The company queue is for HR and administrators.' : 'The review queue could not be loaded.'}</p><button type="button" className="apex-btn apex-btn-secondary mt-3" onClick={() => query.refetch()}>Retry</button></div>;
  }
  if (!rows.length) return <p className="apex-text-muted py-6 text-center text-sm">Nothing is waiting for your review.</p>;
  return <div className="space-y-3">
    {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    {rows.map((row) => { const selected = deciding?.id === row.id; const isCreatorDecision = row.createdById === actorId; return <article key={row.id} className="apex-card" aria-label={`Correction for ${row.user?.name ?? 'employee'}`}>
      <div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="apex-text text-sm font-semibold">{row.user?.name ?? 'Employee'} <span className="apex-text-muted font-normal">· {new Date(row.date).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</span></p><p className="apex-text-muted mt-1 text-xs">{row.reason}</p>{row.eligibleVia && <p className="apex-text-subtle mt-1 text-[11px]">Eligible as {eligibilityLabel(row.eligibleVia)}</p>}</div><span className="apex-text-muted shrink-0 rounded-md bg-[var(--bg-tertiary)] px-2 py-1 text-[11px]">{stageLabel(row.status, row.applicationStatus)}</span></div>
      {row.status === 'STALE_REVIEW_REQUIRED' && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">Attendance changed after the earlier review. Compare the current values and decide this same request again.</p>}
      <CorrectionScreenshots requestId={row.id} files={row.screenshots ?? []} />
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"><Fact label="Requested in" value={formatTime(row.requestedPunchIn)} /><Fact label="Requested out" value={formatTime(row.requestedPunchOut)} /><Fact label="Current in" value={formatTime(row.current?.punchInAt ?? null)} /><Fact label="Current out" value={formatTime(row.current?.punchOutAt ?? null)} /></dl>
      {selected ? <div className="mt-3 rounded-lg border border-[var(--border-secondary)] p-3"><label htmlFor={`decision-reason-${row.id}`} className="apex-text text-xs font-medium">Reason for {deciding.decision === 'APPROVE' ? 'approval' : 'rejection'}</label><textarea id={`decision-reason-${row.id}`} name="decisionReason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="apex-input mt-1 w-full text-sm" placeholder="This becomes part of the audit history." />{isCreatorDecision && <label htmlFor={`creator-confirm-${row.id}`} className="apex-text mt-3 flex items-start gap-2 text-xs"><input id={`creator-confirm-${row.id}`} name="confirmCreatorDecision" type="checkbox" checked={creatorConfirmed} onChange={(e) => setCreatorConfirmed(e.target.checked)} className="mt-0.5" /><span>I entered this manual recovery and separately confirm that I am also making its final decision.</span></label>}<div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => { setDeciding(null); setReason(''); setCreatorConfirmed(false); }} className="apex-btn apex-btn-secondary">Cancel</button><button type="button" disabled={settle.isPending || reason.trim().length < 3 || (isCreatorDecision && !creatorConfirmed)} onClick={() => settle.mutate({ row, decision: deciding.decision })} className="apex-btn apex-btn-primary disabled:opacity-50">Confirm {deciding.decision === 'APPROVE' ? 'approval' : 'rejection'}</button></div></div> : <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => { setDeciding({ id: row.id, decision: 'REJECT' }); setReason(''); setCreatorConfirmed(false); }} className="apex-btn apex-btn-secondary">Reject</button><button type="button" onClick={() => { setDeciding({ id: row.id, decision: 'APPROVE' }); setReason(''); setCreatorConfirmed(false); }} className="apex-btn apex-btn-primary">Approve</button></div>}
    </article>; })}
  </div>;
}
function Fact({ label, value }: { label: string; value: string }) { return <div><dt className="apex-text-subtle text-[11px] uppercase tracking-wide">{label}</dt><dd className="apex-text mt-0.5 text-sm">{value}</dd></div>; }
function eligibilityLabel(via: string) { return ({ EMPLOYEE_TL: 'Team Lead', REPORTING_MANAGER: 'Manager', HR: 'HR', ADMIN: 'Admin', SUPER_ADMIN: 'Super Admin' } as Record<string, string>)[via] ?? via; }
