'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPunchReviews, resolvePunchReview } from './console-api';

const reason: Record<string, string> = {
  DEVICE_ID_UNAVAILABLE: 'Device ID unavailable',
  ACCURACY_UNAVAILABLE: 'GPS accuracy unavailable',
  POLICY_SETUP_PENDING: 'Attendance policy setup pending',
};

export function PunchReviewQueue() {
  const qc = useQueryClient();
  const [note, setNote] = useState<Record<string, string>>({});
  const query = useQuery({ queryKey: ['punch-reviews', 'PENDING'], queryFn: () => getPunchReviews('PENDING'), retry: false });
  const resolve = useMutation({ mutationFn: ({ id, status }: { id: string; status: 'REVIEWED' | 'DISMISSED' }) => resolvePunchReview(id, status, note[id]), onSuccess: () => qc.invalidateQueries({ queryKey: ['punch-reviews'] }) });
  if (query.isLoading) return <p className="apex-text-muted py-6 text-center text-sm">Loading punch reviews…</p>;
  if (query.isError) return <p role="alert" className="py-6 text-center text-sm text-red-600">Punch reviews could not be loaded.</p>;
  const items = query.data?.items ?? [];
  if (!items.length) return <p className="apex-text-muted py-6 text-center text-sm">No punch evidence needs review.</p>;
  return <div className="space-y-3">{items.map((item) => <article key={item.id} className="apex-card"><div className="flex flex-wrap justify-between gap-2"><div><p className="apex-text text-sm font-semibold">{item.employee.name}</p><p className="apex-text-muted text-xs">{item.evidence.businessDate} · {item.evidence.type === 'PUNCH_IN' ? 'Punch in' : 'Punch out'} · {item.evidence.deviceLabel}</p></div><span className="text-xs text-amber-600">{item.reasonCodes.filter((x) => !x.startsWith('POLICY_BLOCKER:')).map((x) => reason[x] ?? x).join(' · ')}</span></div><p className="apex-text-muted mt-2 text-xs">{item.evidence.captureChannel === 'PHONE_HANDOFF' ? 'Captured through phone handoff' : 'Captured on the current device'}. Missing device identification does not invalidate this punch.</p><label htmlFor={`review-note-${item.id}`} className="apex-label mt-3">Review note</label><input id={`review-note-${item.id}`} name="reviewNote" value={note[item.id] ?? ''} onChange={(e) => setNote((n) => ({ ...n, [item.id]: e.target.value }))} className="apex-input w-full" placeholder="Required only when dismissing" /><div className="mt-3 flex justify-end gap-2"><button type="button" disabled={resolve.isPending || !(note[item.id] ?? '').trim()} onClick={() => resolve.mutate({ id: item.id, status: 'DISMISSED' })} className="apex-btn apex-btn-secondary disabled:opacity-50">Dismiss with note</button><button type="button" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: item.id, status: 'REVIEWED' })} className="apex-btn apex-btn-primary">Mark reviewed</button></div></article>)}</div>;
}
