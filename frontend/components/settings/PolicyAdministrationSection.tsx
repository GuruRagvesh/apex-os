'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookOpenCheck, LockKeyhole, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { settingsApi } from '@/lib/api';

type Domain = 'COMPANY' | 'SYSTEM';
type Part = { number: string; title: string; text: string };
type Section = { number: string; title: string; parts: Part[] };
type Content = { rules?: string[]; process?: string[]; examples?: string[]; documentSections?: Section[]; body?: string };
type Revision = { version: number; status: string; title: string; summary: string; guidance: string; owner: string; content: Content; effectiveFrom: string | null };
type Item = { key: string; title?: string; summary?: string; guidance?: string; owner?: string; state?: string; version?: number; rules?: string[]; process?: string[]; examples?: string[]; documentSections?: Section[]; published: Revision | null; draft: Revision | null };
type Administration = { company: Item[]; system: Item[]; canEditCompany: boolean; canEditSystem: boolean };
type Form = { title: string; summary: string; guidance: string; owner: string; content: Content };

const blankForm: Form = { title: '', summary: '', guidance: '', owner: '', content: { body: '' } };
function formFor(item: Item | null, domain: Domain): Form {
  if (!item) return structuredClone(blankForm);
  const current = item.draft ?? item.published;
  return {
    title: current?.title ?? item.title ?? '',
    summary: current?.summary ?? item.summary ?? '',
    guidance: current?.guidance ?? item.guidance ?? item.summary ?? '',
    owner: current?.owner ?? item.owner ?? '',
    content: structuredClone(current?.content ?? (domain === 'COMPANY'
      ? item.documentSections ? { documentSections: item.documentSections } : { rules: item.rules ?? [], process: item.process ?? [], examples: item.examples ?? [] }
      : { body: '' })),
  };
}
const splitLines = (value: string) => value.split('\n').map((line) => line.trim()).filter(Boolean);

export function PolicyAdministrationSection({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState<Domain>('COMPANY');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<Form>(structuredClone(blankForm));
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toLocaleDateString('en-CA'));
  const { data, isLoading, isError, refetch } = useQuery<Administration>({ queryKey: ['settings', 'policy-administration'], queryFn: settingsApi.getPolicyAdministration });
  const items = domain === 'COMPANY' ? data?.company ?? [] : data?.system ?? [];
  const selected = creating ? null : items.find((item) => item.key === selectedKey) ?? null;
  const canEdit = domain === 'COMPANY' ? data?.canEditCompany : data?.canEditSystem;
  const hasUnsavedChanges = JSON.stringify(form) !== JSON.stringify(formFor(selected, domain));
  const visibleItems = useMemo(() => items.filter((item) => {
    const text = `${item.draft?.title ?? item.published?.title ?? item.title ?? ''} ${item.key}`.toLowerCase();
    return text.includes(search.toLowerCase());
  }), [items, search]);

  useEffect(() => {
    if (!data) return;
    if (domain === 'COMPANY' && !selectedKey) setSelectedKey(data.company[0]?.key ?? null);
  }, [data, domain, selectedKey]);
  useEffect(() => { setForm(formFor(selected, domain)); }, [selectedKey, domain, creating, data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['settings', 'policy-administration'] });
  const save = useMutation({
    mutationFn: async () => {
      const key = creating ? `system-${form.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : selectedKey;
      if (!key) throw new Error('Choose a policy');
      await settingsApi.savePolicyDraft(key, { domain, ...form });
      return key;
    },
    onSuccess: (key) => { toast.success('Draft saved'); setCreating(false); setSelectedKey(key); refresh(); },
    onError: (error: any) => toast.error(error?.response?.data?.message ?? error?.message ?? 'Could not save draft'),
  });
  const publish = useMutation({
    mutationFn: () => settingsApi.publishPolicyDraft(selectedKey!, effectiveFrom),
    onSuccess: () => { toast.success('Policy version published'); refresh(); queryClient.invalidateQueries({ queryKey: ['settings', 'my-policy-center'] }); },
    onError: (error: any) => toast.error(error?.response?.data?.message ?? error?.message ?? 'Could not publish policy'),
  });

  const setLines = (key: 'rules' | 'process' | 'examples', value: string) => setForm((old) => ({ ...old, content: { ...old.content, [key]: splitLines(value) } }));
  const setPart = (sectionIndex: number, partIndex: number, text: string) => setForm((old) => {
    const sections = structuredClone(old.content.documentSections ?? []);
    sections[sectionIndex].parts[partIndex].text = text;
    return { ...old, content: { documentSections: sections } };
  });

  if (isLoading) return <div className="apex-card p-8" aria-busy="true">Loading policy administration…</div>;
  if (isError || !data) return <div className="apex-card p-8" role="alert">Policy administration is unavailable. <button onClick={() => refetch()} className="apex-btn apex-btn-secondary ml-3">Try again</button></div>;
  return <section className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">Policy library</p>
        <h1 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">Manage policies</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Edit the wording employees read. Publishing creates a new version; it does not change attendance, leave, payroll or ticket logic.</p>
      </div>
      <button type="button" onClick={onBack} className="apex-btn apex-btn-secondary inline-flex min-h-11 items-center gap-2"><ArrowLeft size={16} />Back to My Policies</button>
    </header>
    <div className="flex gap-2 border-b border-[var(--border-subtle)]" role="tablist" aria-label="Policy domain">
      {(['COMPANY', 'SYSTEM'] as const).map((entry) => <button key={entry} type="button" role="tab" aria-selected={domain === entry} onClick={() => { setDomain(entry); setSelectedKey(null); setCreating(false); }}
        className="border-b-2 px-4 py-3 text-sm font-semibold" style={{ borderColor: domain === entry ? 'var(--accent)' : 'transparent', color: domain === entry ? 'var(--accent)' : 'var(--text-secondary)' }}>
        {entry === 'COMPANY' ? 'Company Policies' : 'System Policies'}
      </button>)}
    </div>
    <div className="grid min-w-0 gap-5 xl:grid-cols-[290px_minmax(0,1fr)]">
      <aside className="apex-card h-fit p-3">
        <div className="relative mb-3"><Search size={16} className="absolute left-3 top-3 text-[var(--text-tertiary)]" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="apex-input w-full pl-9" placeholder="Find a policy" aria-label="Find a policy" /></div>
        {domain === 'SYSTEM' && canEdit && <button type="button" onClick={() => { setCreating(true); setSelectedKey(null); }} className="apex-btn apex-btn-secondary mb-3 flex w-full items-center justify-center gap-2"><Plus size={16} />New system policy</button>}
        <div className="max-h-[65vh] space-y-1 overflow-y-auto">
          {visibleItems.map((item) => <button key={item.key} type="button" onClick={() => { setCreating(false); setSelectedKey(item.key); }} className="w-full rounded-lg px-3 py-2.5 text-left hover:bg-[var(--accent-subtle)]" style={{ backgroundColor: selectedKey === item.key && !creating ? 'var(--accent-subtle)' : undefined }}>
            <span className="block text-sm font-medium text-[var(--text-primary)]">{item.draft?.title ?? item.published?.title ?? item.title}</span>
            <span className="mt-1 block text-xs text-[var(--text-secondary)]">{item.draft ? `Draft v${item.draft.version}` : item.published ? `Published v${item.published.version}` : item.state === 'HOLD' ? 'Awaiting authorization' : domain === 'SYSTEM' ? 'Not published' : 'Catalog version'}</span>
          </button>)}
          {visibleItems.length === 0 && <p className="p-3 text-sm text-[var(--text-secondary)]">{domain === 'SYSTEM' ? 'No system policy documents have been created yet.' : 'No matching company policies.'}</p>}
        </div>
      </aside>
      <div className="apex-card min-w-0 p-5 sm:p-6">
        {!selected && !creating ? <div className="py-12 text-center text-sm text-[var(--text-secondary)]">{domain === 'SYSTEM' ? 'System policies are separate from company policies. A Super Admin can create the first version here.' : 'Select a policy to review its content.'}</div> : <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">{domain === 'COMPANY' ? 'Company policy' : 'System policy'}</p><h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{creating ? 'New system policy' : selected?.title}</h2></div>
            {!canEdit && <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-[var(--text-secondary)]"><LockKeyhole size={14} />Read only</span>}
          </div>
          {selected?.state === 'HOLD' && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">This policy can be prepared as a draft, but publication requires separate formal authorization.</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            {([['title', 'Title'], ['owner', 'Policy owner'], ['summary', 'Short summary'], ['guidance', 'Employee guidance']] as const).map(([key, label]) => <label key={key} className={key === 'summary' || key === 'guidance' ? 'sm:col-span-2' : ''}><span className="apex-label">{label}</span><textarea rows={key === 'summary' || key === 'guidance' ? 2 : 1} value={form[key]} disabled={!canEdit} onChange={(event) => setForm((old) => ({ ...old, [key]: event.target.value }))} className="apex-input mt-1 w-full resize-y disabled:opacity-70" /></label>)}
          </div>
          {domain === 'SYSTEM' ? <label className="block"><span className="apex-label">Policy text</span><textarea rows={14} value={form.content.body ?? ''} disabled={!canEdit} onChange={(event) => setForm((old) => ({ ...old, content: { body: event.target.value } }))} className="apex-input mt-1 w-full resize-y disabled:opacity-70" /></label>
            : form.content.documentSections ? <div className="space-y-5"><h3 className="font-semibold text-[var(--text-primary)]">Document sections</h3>{form.content.documentSections.map((section, sectionIndex) => <section key={section.number} className="rounded-xl border border-[var(--border-subtle)] p-4"><h4 className="font-medium text-[var(--text-primary)]">{section.number === '0' ? section.title : `${section.number}. ${section.title}`}</h4><div className="mt-3 space-y-3">{section.parts.map((part, partIndex) => <label key={`${section.number}-${part.number}-${partIndex}`} className="block"><span className="apex-label">{part.number} {part.title || 'Introduction'}</span><textarea rows={Math.min(12, Math.max(4, Math.ceil(part.text.length / 110)))} value={part.text} disabled={!canEdit} onChange={(event) => setPart(sectionIndex, partIndex, event.target.value)} className="apex-input mt-1 w-full resize-y disabled:opacity-70" /></label>)}</div></section>)}</div>
              : <div className="grid gap-4">{(['rules', 'process', 'examples'] as const).map((key) => <label key={key}><span className="apex-label">{key === 'process' ? 'How it works' : key[0].toUpperCase() + key.slice(1)} · one item per line</span><textarea rows={6} value={(form.content[key] ?? []).join('\n')} disabled={!canEdit} onChange={(event) => setLines(key, event.target.value)} className="apex-input mt-1 w-full resize-y disabled:opacity-70" /></label>)}</div>}
          {canEdit && <div className="flex flex-wrap items-end gap-3 border-t border-[var(--border-subtle)] pt-5">
            <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className="apex-btn-primary min-h-11 px-5 disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save draft'}</button>
            {selected?.draft && <><label><span className="apex-label">Effective date</span><input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className="apex-input mt-1" /></label><button type="button" disabled={publish.isPending || selected.state === 'HOLD' || hasUnsavedChanges} onClick={() => publish.mutate()} className="apex-btn apex-btn-secondary min-h-11 disabled:opacity-50">{publish.isPending ? 'Publishing…' : `Publish v${selected.draft.version}`}</button></>}
            <p className="w-full text-xs text-[var(--text-secondary)]">{hasUnsavedChanges && selected?.draft ? 'Save your latest changes before publishing. ' : ''}A new version needs a fresh employee acknowledgement once effective.</p>
          </div>}
        </div>}
      </div>
    </div>
    <p className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]"><BookOpenCheck size={14} />Policy wording is versioned separately from operational settings.</p>
  </section>;
}
