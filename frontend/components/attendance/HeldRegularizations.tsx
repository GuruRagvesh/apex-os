'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { applyHeldRegularization, getHeldRegularizations } from './regularization-api';
import { refreshAttendanceViews } from './attendance-refresh';
import { formatTime } from './attendance-status';

const reasonText: Record<string, string> = { DAY_LOCKED: 'Day locked', DAY_FINALIZED: 'Day finalized', DAY_MANUALLY_CORRECTED: 'Day changed by another correction', HISTORICAL_RECOVERY_DAY: 'Historical recovery day', MONTH_FINALIZED: 'Payroll month finalized', MONTH_SENT: 'Payroll month sent' };
export function HeldRegularizations() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['regularization-held'], queryFn: getHeldRegularizations, retry: false });
  const apply = useMutation({ mutationFn: (row: any) => applyHeldRegularization(row.id, row.current?.fingerprint ?? null), onSuccess: () => { void refreshAttendanceViews(qc); }, onError: () => query.refetch() });
  if (query.isLoading) return <p className="apex-text-muted text-sm">Loading approved corrections awaiting application…</p>;
  const rows = query.data?.items ?? [];
  if (!rows.length) return null;
  return <section className="space-y-3" aria-labelledby="held-corrections-title"><div><h2 id="held-corrections-title" className="apex-text font-semibold">Approved corrections requiring attention</h2><p className="apex-text-muted text-xs">Reopen the protected day or payroll month, review the current values, then apply.</p></div>{rows.map((row) => <article key={row.id} className="apex-card"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="apex-text text-sm font-semibold">{row.user?.name ?? 'Employee'} · {row.date.slice(0, 10)}</p><p className="text-xs text-amber-600">{reasonText[row.applicationFailureReason ?? ''] ?? row.applicationFailureReason}</p><p className="apex-text-muted mt-1 text-xs">Current: {formatTime(row.current?.punchInAt ?? null)} – {formatTime(row.current?.punchOutAt ?? null)}</p></div><button type="button" disabled={apply.isPending} onClick={() => apply.mutate(row)} className="apex-btn apex-btn-primary disabled:opacity-50">Review current values and apply</button></div>{apply.isError && <p role="alert" className="mt-2 text-xs text-red-600">The day changed or remains protected. The approval is still recorded and nothing was overwritten; review the refreshed values before trying again.</p>}</article>)}</section>;
}
