'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FileText, LockKeyhole, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { usersApi } from '@apex/core-users/api';
import { changeRequestsApi } from '@apex/core-users-change-requests/api';

type FieldDefinition = { key: string; label: string; type?: 'date' | 'email' | 'tel' | 'select' | 'textarea'; options?: string[] };

const FIELDS: FieldDefinition[] = [
  { key: 'legalName', label: 'Legal name' },
  { key: 'dateOfBirth', label: 'Date of birth', type: 'date' },
  { key: 'gender', label: 'Gender', type: 'select', options: ['Female', 'Male', 'Non-binary', 'Prefer not to say'] },
  { key: 'bloodGroup', label: 'Blood group', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
  { key: 'phone', label: 'Mobile number', type: 'tel' },
  { key: 'personalEmail', label: 'Personal email', type: 'email' },
  { key: 'currentAddress', label: 'Current address', type: 'textarea' },
  { key: 'permanentAddress', label: 'Permanent address', type: 'textarea' },
  { key: 'emergencyName', label: 'Emergency contact name' },
  { key: 'emergencyRelation', label: 'Emergency contact relationship' },
  { key: 'emergencyPhone', label: 'Emergency contact phone', type: 'tel' },
];

const PENDING = new Set(['AWAITING_EMPLOYEE_CONFIRMATION', 'PENDING_HR_REVIEW']);
const STATUS_LABELS: Record<string, string> = {
  AWAITING_EMPLOYEE_CONFIRMATION: 'Awaiting your confirmation',
  PENDING_HR_REVIEW: 'Pending HR review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  DECLINED_BY_EMPLOYEE: 'Declined by employee',
};

function shownValue(value: unknown, field?: string) {
  if (value === null || value === undefined || value === '') return 'Not provided';
  if (field === 'dateOfBirth') return new Date(value as any).toLocaleDateString('en-IN');
  return String(value);
}

export function PersonalInformationSection({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [declineReason, setDeclineReason] = useState('');

  const profile = useQuery({
    queryKey: ['my-official-profile', userId],
    queryFn: () => usersApi.getProfile(userId) as Promise<any>,
    enabled: Boolean(userId),
  });
  const requests = useQuery({
    queryKey: ['my-personal-information-requests'],
    queryFn: () => changeRequestsApi.listMyPersonalInformation() as Promise<any[]>,
  });
  const pending = (requests.data ?? []).find((request: any) => PENDING.has(request.status));
  const changes = useMemo(() => Object.entries(draft)
    .filter(([, value]) => value.trim() !== '')
    .map(([field, newValue]) => ({ field, newValue })), [draft]);
  const needsEvidence = changes.some((change) => ['legalName', 'dateOfBirth'].includes(change.field));

  const resetForm = () => {
    setEditing(false); setDraft({}); setReason(''); setFiles([]);
  };
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['my-personal-information-requests'] }),
      queryClient.invalidateQueries({ queryKey: ['my-official-profile', userId] }),
    ]);
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (!changes.length) throw new Error('Enter at least one proposed correction');
      if (!reason.trim()) throw new Error('A reason is required');
      if (needsEvidence && files.length === 0) throw new Error('Attach evidence for legal-name or date-of-birth changes');
      const supportingDocumentIds: string[] = [];
      for (const file of files) {
        if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) {
          throw new Error('Evidence must be PDF, JPG or PNG and no larger than 5 MB');
        }
        const uploaded = await usersApi.uploadDocument(userId, file, 'Personal Information Change Evidence') as any;
        if (uploaded?.document?.id) supportingDocumentIds.push(uploaded.document.id);
      }
      return changeRequestsApi.createPersonalInformation(userId, { changes, reason: reason.trim(), supportingDocumentIds });
    },
    onSuccess: async () => { toast.success('Personal information request submitted'); resetForm(); await refresh(); },
    onError: (error: any) => toast.error(error?.message ?? 'Request could not be submitted'),
  });

  const confirm = useMutation({
    mutationFn: (requestId: string) => changeRequestsApi.confirmPersonalInformation(requestId, confirmPassword),
    onSuccess: async () => { toast.success('Correction confirmed and sent to HR'); setConfirmPassword(''); await refresh(); },
    onError: (error: any) => toast.error(error?.message ?? 'Confirmation failed'),
  });
  const decline = useMutation({
    mutationFn: (requestId: string) => changeRequestsApi.declinePersonalInformation(requestId, declineReason),
    onSuccess: async () => { toast.success('Correction declined'); setDeclineReason(''); await refresh(); },
    onError: (error: any) => toast.error(error?.message ?? 'Decline failed'),
  });

  if (profile.isLoading || requests.isLoading) return <section className="apex-card p-6 text-sm" role="status">Loading personal information…</section>;
  if (profile.isError || requests.isError) return <section className="apex-card p-6 text-sm" role="alert">Personal information could not be loaded. <button className="underline" onClick={() => { profile.refetch(); requests.refetch(); }}>Retry</button></section>;
  const person = profile.data ?? {};

  return (
    <section className="apex-card space-y-5 p-6" aria-labelledby="personal-information-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="personal-information-title" className="font-semibold" style={{ color: 'var(--text-primary)' }}>Personal information</h3>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>Keep your information current. Changes to official records require HR approval and cannot be edited or withdrawn after submission.</p>
        </div>
        <button type="button" className="apex-btn-primary px-4 py-2 text-sm disabled:opacity-50" disabled={Boolean(pending)} onClick={() => setEditing(true)}>
          {pending ? 'Request pending' : 'Request an update'}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => <div key={field.key} className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-sunken)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>{field.label}</p>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-primary)' }}>{shownValue(person[field.key], field.key)}</p>
        </div>)}
      </div>

      {pending?.status === 'AWAITING_EMPLOYEE_CONFIRMATION' && <div className="rounded-xl border p-4" style={{ borderColor: 'var(--accent-border)', backgroundColor: 'var(--accent-subtle)' }}>
        <div className="flex items-center gap-2"><LockKeyhole size={16} /><h4 className="font-semibold">HR correction needs your confirmation</h4></div>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>Review every proposed value below. Your current password is required for fresh authentication.</p>
        <div className="my-3 space-y-2">{(pending.changes ?? []).map((change: any) => <div key={change.field} className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{FIELDS.find((field) => field.key === change.field)?.label ?? change.field}</span><span>{shownValue(change.oldValue, change.field)}</span><ArrowRight size={14} /><strong>{shownValue(change.newValue, change.field)}</strong></div>)}</div>
        <div className="grid gap-2 sm:grid-cols-2"><input type="password" autoComplete="current-password" className="apex-input" placeholder="Current password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /><button type="button" className="apex-btn-primary" disabled={!confirmPassword || confirm.isPending} onClick={() => confirm.mutate(pending.id)}>Confirm correction</button></div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2"><input className="apex-input" placeholder="Required reason to decline" value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} /><button type="button" className="apex-btn apex-btn-secondary" disabled={!declineReason.trim() || decline.isPending} onClick={() => decline.mutate(pending.id)}>Decline</button></div>
      </div>}

      {editing && <div className="rounded-2xl border p-4 sm:p-5" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--surface-elevated)' }}>
        <div className="mb-4 flex items-center justify-between"><div><h4 className="font-semibold">Propose corrections</h4><p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Leave fields blank when they do not need correction.</p></div><button type="button" aria-label="Close request form" onClick={resetForm}><X size={18} /></button></div>
        <div className="grid gap-4 sm:grid-cols-2">{FIELDS.map((field) => <label key={field.key} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}><span className="apex-label">{field.label}</span>{field.type === 'select' ? <select className="apex-input" value={draft[field.key] ?? ''} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">No change</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : field.type === 'textarea' ? <textarea className="apex-input" rows={2} value={draft[field.key] ?? ''} placeholder={shownValue(person[field.key], field.key)} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} /> : <input className="apex-input" type={field.type ?? 'text'} value={draft[field.key] ?? ''} placeholder={shownValue(person[field.key], field.key)} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} />}</label>)}</div>
        {changes.length > 0 && <div className="my-4 rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)' }}><p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>Before and after</p>{changes.map((change) => <div key={change.field} className="flex flex-wrap items-center gap-2 py-1 text-sm"><span className="w-36 font-medium">{FIELDS.find((field) => field.key === change.field)?.label}</span><span>{shownValue(person[change.field], change.field)}</span><ArrowRight size={14} /><strong>{shownValue(change.newValue, change.field)}</strong></div>)}</div>}
        <label><span className="apex-label">Reason for request</span><textarea className="apex-input" rows={3} maxLength={1000} required value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <label className="mt-4 block"><span className="apex-label">Supporting documents {needsEvidence ? '(required)' : '(optional)'}</span><input type="file" multiple accept="application/pdf,image/jpeg,image/png" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} className="block w-full text-sm" /><span className="mt-1 block text-xs" style={{ color: 'var(--text-tertiary)' }}>PDF, JPG or PNG · 5 MB each</span></label>
        <div className="mt-5 flex justify-end gap-2"><button type="button" className="apex-btn apex-btn-secondary" onClick={resetForm}>Cancel</button><button type="button" className="apex-btn-primary px-4 py-2 text-sm" disabled={submit.isPending || changes.length === 0 || !reason.trim()} onClick={() => submit.mutate()}>{submit.isPending ? 'Submitting…' : 'Submit for HR review'}</button></div>
      </div>}

      <div>
        <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold"><FileText size={15} /> Request history</h4>
        {(requests.data ?? []).length === 0 ? <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No personal information requests yet.</p> : <div className="space-y-2">{(requests.data ?? []).map((request: any) => <details key={request.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--border-subtle)' }}><summary className="cursor-pointer text-sm font-medium">{STATUS_LABELS[request.status] ?? request.status} · {new Date(request.createdAt).toLocaleDateString('en-IN')}</summary><div className="mt-3 space-y-2 text-sm">{(request.changes ?? []).map((change: any) => <div key={change.field} className="flex flex-wrap items-center gap-2"><span className="font-medium">{FIELDS.find((field) => field.key === change.field)?.label ?? change.field}</span><span>{shownValue(change.oldValue, change.field)}</span><ArrowRight size={13} /><span>{shownValue(change.newValue, change.field)}</span></div>)}<p><strong>Reason:</strong> {request.reason}</p>{request.rejectionReason && <p><strong>Decision reason:</strong> {request.rejectionReason}</p>}{request.employeeDeclineReason && <p><strong>Decline reason:</strong> {request.employeeDeclineReason}</p>}</div></details>)}</div>}
      </div>
    </section>
  );
}
