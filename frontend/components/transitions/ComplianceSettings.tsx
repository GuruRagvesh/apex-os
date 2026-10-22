'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { RemediationDialog, useRemediation } from '@apex/shared-remediation';
import { createRemediationActionRunner } from '@apex/shared-remediation/api';
import { api, unwrap as r } from '@apex/shared-auth';
import { HoldView, messageFor, newKey, transitionsApi } from './transitions-api';

/**
 * Settings → Compliance (Admin / Super Admin). Retention rules change only by
 * a proposal that a DIFFERENT Admin approves; legal holds go
 * REQUESTED → ACTIVE / REJECTED with a different confirmer. Nothing here seeds
 * or invents a retention period.
 */

const CATEGORY_LABEL: Record<string, string> = { ATTENDANCE: 'Attendance records', LEAVE: 'Leave records', PAYROLL: 'Payroll records' };
const HEALTH_LABEL: Record<string, string> = { OK: 'Approved', MISSING: 'No rule', INACTIVE: 'Inactive', INVALID: 'Invalid', LEGACY_UNAPPROVED: 'Legacy, not approved' };
const HOLD_REASONS = ['LITIGATION', 'REGULATORY_INQUIRY', 'INTERNAL_INVESTIGATION', 'AUDIT', 'EMPLOYMENT_DISPUTE', 'OTHER'];
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const card = 'apex-card space-y-3 p-4 sm:p-5';

function RetentionBlock({ meId }: { meId?: string }) {
  const qc = useQueryClient();
  const remediation = useRemediation();
  const runner = useMemo(createRemediationActionRunner, []);
  const q = useQuery({ queryKey: ['retention'], queryFn: transitionsApi.retention, retry: false });
  const key = useRef(newKey());
  const [form, setForm] = useState({ category: 'ATTENDANCE', action: 'CREATE', retentionMonths: '', noExpiry: false, policyReference: '', reason: '' });
  const fail = (err: any) => { if (!remediation.openFrom(err)) toast.error(messageFor(err)); };
  const refresh = () => qc.invalidateQueries({ queryKey: ['retention'] });
  const propose = useMutation({
    mutationFn: () => transitionsApi.proposeRetention({
      category: form.category, action: form.action, reason: form.reason, policyReference: form.policyReference || undefined,
      noExpiry: form.action !== 'DEACTIVATE' && form.noExpiry, retentionMonths: form.noExpiry || form.action === 'DEACTIVATE' ? undefined : Number(form.retentionMonths), idempotencyKey: key.current,
    }),
    onSuccess: () => { toast.success('Proposal sent. A different Admin must approve it.'); key.current = newKey(); setForm({ ...form, reason: '', policyReference: '', retentionMonths: '' }); refresh(); },
    onError: fail,
  });
  const decide = useMutation({ mutationFn: (v: { id: string; decision: 'APPROVE' | 'REJECT'; reason?: string }) => transitionsApi.decideRetention(v.id, v), onSuccess: refresh, onError: fail });
  const cancel = useMutation({ mutationFn: (id: string) => transitionsApi.cancelRetention(id), onSuccess: refresh, onError: fail });
  const pending = (q.data?.proposals ?? []).filter((p) => p.status === 'PENDING');
  if (q.isLoading) return <p role="status">Loading retention rules…</p>;
  if (q.isError) return <p role="alert">Retention rules are not available right now.</p>;
  const data = q.data!;
  return (
    <section className={card} aria-label="Retention rules">
      <h2 className="text-lg font-semibold">Record retention</h2>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        An approved rule decides how long attendance, leave and payroll records are kept before Permanent Delete is allowed. No period is assumed: a missing rule is shown below.
        {data.readiness.defaultDenyOn ? ' This server blocks deletion when a rule is missing, inactive or invalid.' : ' This server currently only warns when a rule is missing.'}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <caption className="sr-only">Current retention rules</caption>
          <thead><tr className="text-left text-xs" style={{ color: 'var(--text-tertiary)' }}><th className="py-1 pr-2">Records</th><th className="pr-2">Status</th><th className="pr-2">Keep for</th><th>Version</th></tr></thead>
          <tbody>
            {data.readiness.categories.map((c) => {
              const rule = data.rules.find((x) => x.category === c.category);
              return (
                <tr key={c.category} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="py-1 pr-2">{CATEGORY_LABEL[c.category]}</td>
                  <td className="pr-2">{HEALTH_LABEL[c.health] ?? c.health}</td>
                  <td className="pr-2">{c.health === 'OK' ? (rule?.noExpiry ? 'Indefinitely' : `${rule?.retentionMonths} months`) : '—'}</td>
                  <td>{c.version ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pending.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Waiting for approval</h3>
          {pending.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm" style={{ borderColor: 'var(--border-subtle)' }}>
              <span>{CATEGORY_LABEL[p.category]}: {p.action.toLowerCase()} {p.action !== 'DEACTIVATE' && (p.noExpiry ? '(retain indefinitely)' : `(${p.retentionMonths} months)`)}. {p.reason}</span>
              <span className="flex gap-2">
                {p.proposedById !== meId ? <>
                  <button className="apex-btn apex-btn-primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: p.id, decision: 'APPROVE' })}>Approve</button>
                  <button className="apex-btn apex-btn-secondary" disabled={decide.isPending} onClick={() => { const reason = window.prompt('Why are you rejecting this?'); if (reason?.trim()) decide.mutate({ id: p.id, decision: 'REJECT', reason: reason.trim() }); }}>Reject</button>
                </> : <>
                  <em className="text-xs">Waiting for a different Admin</em>
                  <button className="apex-btn apex-btn-secondary" disabled={cancel.isPending} onClick={() => cancel.mutate(p.id)}>Cancel</button>
                </>}
              </span>
            </div>
          ))}
        </div>
      )}

      <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); propose.mutate(); }} aria-label="Propose a retention change">
        <h3 className="text-sm font-semibold sm:col-span-2">Propose a change</h3>
        <label className="text-sm"><span className="block font-medium">Records</span><select className="apex-input w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="text-sm"><span className="block font-medium">Change</span><select className="apex-input w-full" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}><option value="CREATE">New rule</option><option value="UPDATE">Update rule</option><option value="DEACTIVATE">Deactivate rule</option></select></label>
        {form.action !== 'DEACTIVATE' && <>
          <label className="text-sm"><span className="block font-medium">Keep for (months)</span><input type="number" min={1} max={1200} disabled={form.noExpiry} className="apex-input w-full" value={form.retentionMonths} onChange={(e) => setForm({ ...form, retentionMonths: e.target.value })} /></label>
          <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={form.noExpiry} onChange={(e) => setForm({ ...form, noExpiry: e.target.checked })} />Retain indefinitely</label>
          <label className="text-sm sm:col-span-2"><span className="block font-medium">Policy reference</span><input className="apex-input w-full" maxLength={200} value={form.policyReference} onChange={(e) => setForm({ ...form, policyReference: e.target.value })} /></label>
        </>}
        <label className="text-sm sm:col-span-2"><span className="block font-medium">Reason</span><input className="apex-input w-full" maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        <div className="sm:col-span-2"><button type="submit" className="apex-btn apex-btn-primary" disabled={propose.isPending || !form.reason.trim() || (form.action !== 'DEACTIVATE' && !form.policyReference.trim()) || (form.action !== 'DEACTIVATE' && !form.noExpiry && !(Number(form.retentionMonths) > 0))}>{propose.isPending ? 'Sending…' : 'Send for approval'}</button></div>
      </form>

      {data.versions.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">Rule history</summary>
          <ul className="mt-2 space-y-1 text-sm">{data.versions.map((v) => <li key={v.id}>{CATEGORY_LABEL[v.category]} v{v.version}: {v.status === 'ACTIVE' ? (v.noExpiry ? 'indefinitely' : `${v.retentionMonths} months`) : 'deactivated'} · approved {when(v.approvedAt)}</li>)}</ul>
        </details>
      )}
      <RemediationDialog {...remediation.dialogProps} runAction={runner} />
    </section>
  );
}

function HoldsBlock({ meId, isAdmin }: { meId?: string; isAdmin: boolean }) {
  const qc = useQueryClient();
  const remediation = useRemediation();
  const runner = useMemo(createRemediationActionRunner, []);
  const holds = useQuery({ queryKey: ['legal-holds'], queryFn: () => transitionsApi.holds(), retry: false });
  const people = useQuery({ queryKey: ['users-directory'], queryFn: () => r<any[]>(api.get('/users/directory')), retry: false });
  const key = useRef(newKey());
  const [form, setForm] = useState({ userId: '', reasonCode: HOLD_REASONS[0], notes: '', reference: '' });
  const fail = (err: any) => { if (!remediation.openFrom(err)) toast.error(messageFor(err)); };
  const refresh = () => qc.invalidateQueries({ queryKey: ['legal-holds'] });
  const request = useMutation({
    mutationFn: () => transitionsApi.requestHold(form.userId, { reasonCode: form.reasonCode, notes: form.notes || undefined, reference: form.reference || undefined, idempotencyKey: key.current }),
    onSuccess: () => { toast.success('Hold requested. A different Admin must confirm it.'); key.current = newKey(); setForm({ ...form, notes: '', reference: '' }); refresh(); },
    onError: fail,
  });
  const act = useMutation({ mutationFn: (v: { id: string; action: any; reason?: string }) => transitionsApi.holdAction(v.id, v.action, { reason: v.reason }), onSuccess: refresh, onError: fail });
  const ask = (h: HoldView, action: 'reject' | 'release') => { const reason = window.prompt(action === 'reject' ? 'Why is this hold being rejected?' : 'Why is this hold being released?'); if (reason?.trim()) act.mutate({ id: h.id, action, reason: reason.trim() }); };
  return (
    <section className={card} aria-label="Legal holds">
      <h2 className="text-lg font-semibold">Legal holds</h2>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>A requested or active hold blocks Permanent Delete. A different Admin must confirm a request; there is no one-person shortcut. Notes and references are visible to Admins and the requester only.</p>
      <ul className="space-y-2">
        {(holds.data ?? []).map((h) => (
          <li key={h.id} className="space-y-1 rounded-lg border p-2 text-sm" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span><strong>{h.employee?.name ?? 'Employee'}</strong>: {h.reasonCode.replace(/_/g, ' ').toLowerCase()} · {h.status.toLowerCase()}{h.blocksDeletion ? ' · blocks deletion' : ''}</span>
              <span className="flex flex-wrap gap-2">
                {h.status === 'REQUESTED' && isAdmin && h.requestedById !== meId && <>
                  <button className="apex-btn apex-btn-primary" disabled={act.isPending} onClick={() => act.mutate({ id: h.id, action: 'confirm' })}>Confirm</button>
                  <button className="apex-btn apex-btn-secondary" disabled={act.isPending} onClick={() => ask(h, 'reject')}>Reject</button>
                </>}
                {h.status === 'REQUESTED' && (h.requestedById === meId || isAdmin) && <button className="apex-btn apex-btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ id: h.id, action: 'withdraw' })}>Withdraw</button>}
                {h.status === 'ACTIVE' && isAdmin && <button className="apex-btn apex-btn-secondary" disabled={act.isPending} onClick={() => ask(h, 'release')}>Release</button>}
                {h.status === 'LEGACY' && isAdmin && <button className="apex-btn apex-btn-secondary" disabled={act.isPending} onClick={() => act.mutate({ id: h.id, action: 'adopt' })}>Adopt legacy hold</button>}
              </span>
            </div>
            {h.status === 'REQUESTED' && h.requestedById === meId && <p className="text-xs">Waiting for a different Admin to confirm.</p>}
            {(h.notes || h.reference) && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{h.reference ? `Ref ${h.reference}. ` : ''}{h.notes}</p>}
          </li>
        ))}
        {holds.data?.length === 0 && <li className="text-sm">No legal holds.</li>}
      </ul>
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); request.mutate(); }} aria-label="Request a legal hold">
        <h3 className="text-sm font-semibold sm:col-span-2">Request a hold</h3>
        <label className="text-sm"><span className="block font-medium">Person</span>
          <select className="apex-input w-full" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
            <option value="">Choose…</option>{(people.data ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.name}{u.employeeId ? ` (${u.employeeId})` : ''}</option>)}
          </select>
        </label>
        <label className="text-sm"><span className="block font-medium">Reason</span><select className="apex-input w-full" value={form.reasonCode} onChange={(e) => setForm({ ...form, reasonCode: e.target.value })}>{HOLD_REASONS.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ').toLowerCase()}</option>)}</select></label>
        <label className="text-sm"><span className="block font-medium">Reference (confidential)</span><input className="apex-input w-full" maxLength={200} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></label>
        <label className="text-sm"><span className="block font-medium">Notes (confidential)</span><input className="apex-input w-full" maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        <div className="sm:col-span-2"><button type="submit" className="apex-btn apex-btn-primary" disabled={request.isPending || !form.userId}>{request.isPending ? 'Sending…' : 'Request hold'}</button></div>
      </form>
      <RemediationDialog {...remediation.dialogProps} runAction={runner} />
    </section>
  );
}

const SWITCH_LABEL: Record<string, { label: string; help: string }> = {
  transfer: { label: 'Department and role transfers', help: 'Preview-first transfers and the Transfer review list.' },
  exit: { label: 'Resignation, clearance and F&F', help: 'Resignation, notice, clearance, F&F, automatic separation.' },
  compliance: { label: 'Retention and legal-hold administration', help: 'Proposals, approvals and hold requests.' },
  retentionDefaultDeny: { label: 'Block deletion without an approved retention rule', help: 'Turn on only after the readiness table above shows every category approved.' },
  payrollAck: { label: 'Require acknowledgement of unresolved leave setup at payroll finalize', help: 'Finalize needs an explicit acknowledgement of any days left out of the totals.' },
};

function SwitchesBlock({ isSuper }: { isSuper: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['transition-capabilities'], queryFn: transitionsApi.capabilities, retry: false });
  const set = useMutation({ mutationFn: (v: { c: any; on: boolean }) => transitionsApi.setCapability(v.c, v.on), onSuccess: () => qc.invalidateQueries({ queryKey: ['transition-capabilities'] }), onError: (e: any) => toast.error(messageFor(e)) });
  if (!q.data) return null;
  return (
    <section className={card} aria-label="Rollout switches">
      <h2 className="text-lg font-semibold">Rollout</h2>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Each feature is off until its database migration is applied and a Super Admin turns it on. Changes are audited.</p>
      <ul className="space-y-2">
        {(Object.keys(SWITCH_LABEL) as Array<keyof typeof SWITCH_LABEL>).map((c) => {
          const cap = (q.data as any)[c];
          return (
            <li key={c} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span><strong>{SWITCH_LABEL[c].label}</strong><br /><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{SWITCH_LABEL[c].help}{!cap.schemaReady ? ' Database migration not applied.' : ''}</span></span>
              <label className="flex items-center gap-2">
                <input type="checkbox" role="switch" aria-label={SWITCH_LABEL[c].label} checked={cap.switchOn} disabled={!isSuper || set.isPending || (!cap.schemaReady && !cap.switchOn)} onChange={(e) => set.mutate({ c, on: e.target.checked })} />
                {cap.switchOn ? 'On' : 'Off'}
              </label>
            </li>
          );
        })}
      </ul>
      {!isSuper && <p className="text-xs">Only a Super Admin can change these.</p>}
    </section>
  );
}

export function ComplianceSettings({ me, isSuperAdmin }: { me?: { id: string }; isSuperAdmin: boolean }) {
  return (
    <div className="space-y-6">
      <RetentionBlock meId={me?.id} />
      <HoldsBlock meId={me?.id} isAdmin />
      <SwitchesBlock isSuper={isSuperAdmin} />
    </div>
  );
}
