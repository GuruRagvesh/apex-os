'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, BookOpenCheck, CheckCircle2, ChevronRight, Clock3,
  FileText, HelpCircle, ListTree, Printer, Search, ShieldAlert, UserRoundCheck,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { settingsApi } from '@/lib/api';

type Acknowledgement = { acknowledgedAt: string | null; viewedAt: string };
type DocumentPart = { number: string; title: string; text: string };
type DocumentSection = { number: string; title: string; parts: DocumentPart[] };
type Policy = {
  key: string;
  code: string;
  title: string;
  summary: string;
  guidance: string;
  state: 'PUBLISHED' | 'HOLD' | 'REFERENCE';
  stateReason?: string;
  version: number;
  acknowledgement: Acknowledgement | null;
  acknowledgementRequired?: boolean;
  rules: string[];
  process: string[];
  examples: string[];
  owner: string;
  domain: 'COMPANY' | 'SYSTEM';
  canonicalKey?: string;
  canonicalSection?: string;
  documentSections?: DocumentSection[];
  body?: string;
};
type PolicySection = { key: string; code: string; title: string; description: string; items: Policy[] };
type PolicyCenterResponse = {
  version: number;
  sections: PolicySection[];
  systemPolicies?: Policy[];
  summary: { total: number; acknowledged: number; pending: number; awaitingPublication: number; linkedTopics: number };
};

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-card)' }}>
    <div className="flex items-center gap-2" style={{ color: 'var(--accent)' }}>
      {icon}<span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
    </div>
    <p className="mt-2 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</p>
  </div>;
}

function ReaderBlock({ id, title, icon, children }: {
  id: string; title: string; icon: React.ReactNode; children: React.ReactNode;
}) {
  return <section id={id} className="scroll-mt-24 border-b py-8 last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
    <h2 className="flex items-center gap-2 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
      {icon}{title}
    </h2>
    <div className="mt-4 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{children}</div>
  </section>;
}

function DocumentBody({ sections }: { sections: DocumentSection[] }) {
  return <div className="space-y-2">
    {sections.map((section) => <section
      key={section.number}
      id={`document-section-${section.number}`}
      className="scroll-mt-24 border-b py-7 last:border-0"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
        {section.number === '0' ? section.title : `${section.number}. ${section.title}`}
      </h2>
      <div className="mt-5 space-y-6">
        {section.parts.map((part, index) => {
          const [opening, ...bullets] = part.text.split(/\s*•\s*/);
          return <section key={part.number || index} className="space-y-3">
            {part.title && <h3 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {part.number} {part.title}
            </h3>}
            {opening && <p className="text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>{opening}</p>}
            {bullets.length > 0 && <ul className="list-disc space-y-2 pl-6 text-sm leading-7" style={{ color: 'var(--text-secondary)' }}>
              {bullets.map((bullet, bulletIndex) => <li key={bulletIndex}>{bullet}</li>)}
            </ul>}
          </section>;
        })}
      </div>
    </section>)}
  </div>;
}

function PolicyReader({ policy, section, initialDocumentSection, onBack, onAcknowledge, isAcknowledging }: {
  policy: Policy;
  section: PolicySection;
  initialDocumentSection: string | null;
  onBack: () => void;
  onAcknowledge: () => void;
  isAcknowledging: boolean;
}) {
  const acknowledged = policy.acknowledgement?.acknowledgedAt;
  const fullDocument = policy.documentSections;
  useEffect(() => {
    if (!initialDocumentSection) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(`document-section-${initialDocumentSection}`)?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialDocumentSection, policy.key]);

  const toc = fullDocument
    ? fullDocument.map((part) => ({ id: `document-section-${part.number}`, label: part.title }))
    : policy.body ? [{ id: 'overview', label: 'Policy text' }]
    : [
        { id: 'overview', label: 'Overview' },
        { id: 'rules', label: 'Policy rules' },
        { id: 'process', label: 'How it works' },
        { id: 'examples', label: 'Examples' },
        { id: 'help', label: 'Need help?' },
      ];

  return <section className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
      <button type="button" onClick={onBack} className="apex-btn apex-btn-secondary inline-flex min-h-11 items-center gap-2">
        <ArrowLeft size={16} />All policies
      </button>
      <button type="button" onClick={() => window.print()} className="apex-btn apex-btn-secondary inline-flex min-h-11 items-center gap-2">
        <Printer size={16} />Print policy
      </button>
    </div>
    <article className="apex-card overflow-hidden">
      <header className="border-b px-5 py-6 sm:px-8 sm:py-8" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--accent-subtle)' }}>
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
          {policy.domain === 'SYSTEM' ? 'System Policies' : 'Company Policies'} · {section.title}
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: 'var(--text-primary)' }}>{policy.title}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>{policy.summary}</p>
          </div>
          <span className="w-fit rounded-full border px-3 py-1.5 text-xs font-medium" style={{ borderColor: 'var(--accent-border)', backgroundColor: 'var(--surface-card)', color: 'var(--accent-text)' }}>
            Version {policy.version}
          </span>
        </div>
        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-xl border p-3" style={{ borderColor: 'var(--accent-border)', backgroundColor: 'var(--surface-card)' }}>
            <dt className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Policy owner</dt>
            <dd className="mt-1 font-medium" style={{ color: 'var(--text-primary)' }}>{policy.owner}</dd>
          </div>
          <div className="rounded-xl border p-3" style={{ borderColor: 'var(--accent-border)', backgroundColor: 'var(--surface-card)' }}>
            <dt className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Status</dt>
            <dd className="mt-1 font-medium" style={{ color: policy.state === 'PUBLISHED' ? 'var(--success, #047857)' : 'var(--warning, #b45309)' }}>
              {policy.state === 'PUBLISHED' ? 'Available to read' : 'Awaiting publication'}
            </dd>
          </div>
        </dl>
      </header>
      <div className="grid xl:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label={`${policy.title} contents`} className="border-b p-4 print:hidden xl:sticky xl:top-4 xl:h-[calc(100vh-3rem)] xl:overflow-y-auto xl:border-b-0 xl:border-r" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-secondary)' }}>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
            <ListTree size={15} />On this page
          </p>
          <div className="mt-3 flex gap-2 overflow-x-auto xl:block xl:space-y-1">
            {toc.map(({ id, label }) => <a key={id} href={`#${id}`} className="inline-flex min-h-10 flex-none items-center rounded-lg px-3 text-sm transition-colors hover:bg-[var(--accent-subtle)]" style={{ color: 'var(--text-secondary)' }}>
              {label}
            </a>)}
          </div>
        </nav>
        <div className="min-w-0 px-5 py-2 sm:px-8">
          {fullDocument ? <DocumentBody sections={fullDocument} /> : policy.body ? <ReaderBlock id="overview" title="Policy text" icon={<FileText size={19} style={{ color: 'var(--accent)' }} />}>
            <div className="whitespace-pre-wrap">{policy.body}</div>
          </ReaderBlock> : <>
            <ReaderBlock id="overview" title="What this means for you" icon={<UserRoundCheck size={19} style={{ color: 'var(--accent)' }} />}>
              <p>{policy.guidance}</p>
              {policy.state === 'HOLD' && <div className="mt-5 rounded-xl border p-4" style={{ borderColor: 'var(--warning-border, #fcd34d)', backgroundColor: 'var(--warning-subtle, #fffbeb)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>Not yet active.</strong><p className="mt-1">{policy.stateReason}</p>
              </div>}
            </ReaderBlock>
            <ReaderBlock id="rules" title="Policy rules" icon={<FileText size={19} style={{ color: 'var(--accent)' }} />}>
              <ul className="space-y-3">{policy.rules.map((rule) => <li key={rule} className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 flex-none rounded-full" style={{ backgroundColor: 'var(--accent)' }} /><span>{rule}</span></li>)}</ul>
            </ReaderBlock>
            <ReaderBlock id="process" title="How it works" icon={<BookOpenCheck size={19} style={{ color: 'var(--accent)' }} />}>
              <ol className="space-y-3">{policy.process.map((step, index) => <li key={step} className="flex gap-3"><span className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-semibold" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }}>{index + 1}</span><span>{step}</span></li>)}</ol>
            </ReaderBlock>
            <ReaderBlock id="examples" title="Examples" icon={<CheckCircle2 size={19} style={{ color: 'var(--accent)' }} />}>
              <div className="space-y-3">{policy.examples.map((example) => <div key={example} className="rounded-xl border p-4" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-secondary)' }}>{example}</div>)}</div>
            </ReaderBlock>
            <ReaderBlock id="help" title="Need help or have a question?" icon={<HelpCircle size={19} style={{ color: 'var(--accent)' }} />}>
              <p>Contact <strong style={{ color: 'var(--text-primary)' }}>{policy.owner}</strong> through the approved company channel.</p>
            </ReaderBlock>
          </>}
          <section className="my-8 rounded-2xl border p-5 print:hidden sm:p-6" style={{ borderColor: acknowledged ? 'var(--success-border, #a7f3d0)' : 'var(--accent-border)', backgroundColor: acknowledged ? 'var(--success-subtle, #ecfdf5)' : 'var(--accent-subtle)' }}>
            {policy.acknowledgementRequired === false
              ? <><h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Current workspace configuration</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>This System Policy reflects live application settings. It is informational and does not require acknowledgement.</p></>
              : policy.state === 'HOLD'
              ? <><h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Acknowledgement is unavailable</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>This policy needs formal authorization before it can be issued for acknowledgement.</p></>
              : acknowledged
                ? <div className="flex gap-3"><CheckCircle2 className="mt-0.5 flex-none" size={20} style={{ color: 'var(--success, #047857)' }} /><div><h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Acknowledged</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>You acknowledged this version on {new Date(acknowledged).toLocaleDateString('en-IN')}. A later version requires a separate acknowledgement.</p></div></div>
                : <><h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Confirm you have read this policy</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>This records review of this version. It does not act as an electronic signature or change your contractual rights.</p><button type="button" disabled={isAcknowledging} onClick={onAcknowledge} className="apex-btn-primary mt-5 min-h-11 px-5 disabled:opacity-60">{isAcknowledging ? 'Recording acknowledgement…' : 'I have read this policy'}</button></>}
          </section>
        </div>
      </div>
    </article>
  </section>;
}

export function MyPoliciesSection({ canManagePolicies = false, onManagePolicies }: {
  canManagePolicies?: boolean;
  onManagePolicies?: () => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [domain, setDomain] = useState<'COMPANY' | 'SYSTEM'>('COMPANY');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [initialDocumentSection, setInitialDocumentSection] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useQuery<PolicyCenterResponse>({
    queryKey: ['settings', 'my-policy-center'],
    queryFn: () => settingsApi.getMyPolicyCenter(),
  });
  const acknowledge = useMutation({
    mutationFn: ({ key, version }: { key: string; version: number }) => settingsApi.acknowledgePolicy(key, version),
    onSuccess: () => { toast.success('Policy acknowledgement recorded'); queryClient.invalidateQueries({ queryKey: ['settings', 'my-policy-center'] }); },
    onError: (error: any) => toast.error(error?.message ?? 'Could not record acknowledgement'),
  });
  const systemSection: PolicySection = { key: 'system', code: 'SYS', title: 'System Policies', description: 'Published rules for the Apex OS workspace.', items: data?.systemPolicies ?? [] };
  const allPolicies = [
    ...(data?.sections.flatMap((section) => section.items.map((policy) => ({ policy, section }))) ?? []),
    ...(data?.systemPolicies ?? []).map((policy) => ({ policy, section: systemSection })),
  ];
  const selectedEntry = allPolicies.find(({ policy }) => policy.key === selectedKey);
  const filteredSections = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!data) return [];
    const sourceSections = domain === 'COMPANY' ? data.sections : [systemSection];
    if (!needle) return sourceSections.filter((section) => section.items.length > 0);
    return sourceSections.map((section) => ({
      ...section,
      items: section.items.filter((policy) => [
        policy.code, policy.title, policy.summary, policy.guidance, policy.body ?? '',
        ...policy.rules, ...policy.process, ...policy.examples,
        ...(policy.documentSections?.flatMap((documentSection) => [documentSection.title, ...documentSection.parts.map((part) => part.text)]) ?? []),
      ].join(' ').toLowerCase().includes(needle)),
    })).filter((section) => section.items.length > 0);
  }, [data, search, domain]);

  if (isLoading) return <section aria-busy="true" className="space-y-5">
    <div className="h-20 animate-pulse rounded-2xl" style={{ backgroundColor: 'var(--bg-secondary)' }} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl" style={{ backgroundColor: 'var(--bg-secondary)' }} />)}</div>
    <div className="h-72 animate-pulse rounded-2xl" style={{ backgroundColor: 'var(--bg-secondary)' }} />
  </section>;
  if (isError || !data) return <section className="apex-card p-8 text-center" role="alert">
    <ShieldAlert className="mx-auto" size={28} style={{ color: 'var(--warning, #b45309)' }} />
    <h2 className="mt-3 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Policy library is unavailable</h2>
    <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Your policies could not be loaded. No acknowledgement was changed.</p>
    <button type="button" onClick={() => refetch()} className="apex-btn apex-btn-secondary mt-5 min-h-11">Try again</button>
  </section>;
  if (selectedEntry) return <PolicyReader
    policy={selectedEntry.policy}
    section={selectedEntry.section}
    initialDocumentSection={initialDocumentSection}
    onBack={() => { setSelectedKey(null); setInitialDocumentSection(null); }}
    onAcknowledge={() => acknowledge.mutate({ key: selectedEntry.policy.key, version: selectedEntry.policy.version })}
    isAcknowledging={acknowledge.isPending}
  />;

  return <section className="space-y-5">
    <header className="rounded-2xl border p-5 sm:p-6" style={{ borderColor: 'var(--accent-border)', backgroundColor: 'var(--accent-subtle)' }}>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="flex items-center gap-2" style={{ color: 'var(--accent)' }}><BookOpenCheck size={20} /><p className="text-xs font-semibold uppercase tracking-widest">{domain === 'COMPANY' ? 'Company Policies' : 'System Policies'}</p></div>
          <h1 className="mt-2 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>My policies</h1>
          <p className="mt-1 max-w-2xl text-sm" style={{ color: 'var(--text-secondary)' }}>{domain === 'COMPANY' ? 'Open a policy to read its complete guidance. The Code of Conduct brings related conduct topics together in one document.' : 'Read published system policies separately from company policies.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManagePolicies && <button type="button" onClick={onManagePolicies} className="apex-btn apex-btn-secondary min-h-11">Manage policies</button>}
          <span className="w-fit rounded-full border px-3 py-1.5 text-xs font-medium" style={{ borderColor: 'var(--accent-border)', color: 'var(--accent-text)', backgroundColor: 'var(--surface-card)' }}>Policy library</span>
        </div>
      </div>
    </header>
    <nav aria-label="Policy domains" className="flex gap-2 border-b pb-1" style={{ borderColor: 'var(--border-subtle)' }}>
      {(['COMPANY', 'SYSTEM'] as const).map((entry) => <button key={entry} type="button" aria-current={domain === entry ? 'page' : undefined} onClick={() => { setDomain(entry); setSearch(''); setSelectedKey(null); }} className="min-h-11 border-b-2 px-4 text-sm font-semibold" style={{ borderColor: domain === entry ? 'var(--accent)' : 'transparent', color: domain === entry ? 'var(--accent)' : 'var(--text-secondary)' }}>{entry === 'COMPANY' ? 'Company Policies' : 'System Policies'}</button>)}
    </nav>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat icon={<FileText size={16} />} label="Policies to read" value={domain === 'COMPANY' ? data.summary.total : (data.systemPolicies ?? []).length} />
      <Stat icon={<CheckCircle2 size={16} />} label={domain === 'COMPANY' ? 'Acknowledged' : 'Live configuration'} value={domain === 'COMPANY' ? data.summary.acknowledged : (data.systemPolicies ?? []).length} />
      <Stat icon={<Clock3 size={16} />} label={domain === 'COMPANY' ? 'To review' : 'Acknowledgement'} value={domain === 'COMPANY' ? data.summary.pending : 0} />
      {domain === 'COMPANY' && <Stat icon={<ShieldAlert size={16} />} label="Awaiting approval" value={data.summary.awaitingPublication} />}
    </div>
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" size={17} style={{ color: 'var(--text-tertiary)' }} />
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={domain === 'COMPANY' ? 'Search company policies' : 'Search system policies'} aria-label="Search policies" className="apex-input min-h-11 w-full pl-10" />
    </div>
    {filteredSections.length === 0 ? <div className="apex-card p-8 text-center">
      <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{domain === 'SYSTEM' && !search ? 'No system policies published yet' : 'No matching policies'}</h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{domain === 'SYSTEM' && !search ? 'Published system policies will appear here when issued.' : 'Try a broader search term.'}</p>
    </div> : <div className="grid gap-4 lg:grid-cols-2">
      {filteredSections.map((section) => <section key={section.key} className="apex-card overflow-hidden">
        <header className="border-b px-5 py-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>{section.code}</p>
          <h2 className="mt-1 font-semibold" style={{ color: 'var(--text-primary)' }}>{section.title}</h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{section.description}</p>
        </header>
        <div className="p-2">
          {section.items.map((policy) => {
            const complete = policy.state === 'REFERENCE'
              ? Boolean(allPolicies.find((entry) => entry.policy.key === policy.canonicalKey)?.policy.acknowledgement?.acknowledgedAt)
              : Boolean(policy.acknowledgement?.acknowledgedAt);
            return <button key={policy.key} type="button" onClick={() => {
              setInitialDocumentSection(policy.canonicalSection ?? null);
              setSelectedKey(policy.canonicalKey ?? policy.key);
            }} className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-[var(--accent-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ outlineColor: 'var(--accent)' }}>
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-xs font-semibold" style={{ backgroundColor: complete ? 'var(--success-subtle, #ecfdf5)' : 'var(--bg-secondary)', color: complete ? 'var(--success, #047857)' : 'var(--accent)' }}>
                {complete ? <CheckCircle2 size={16} /> : policy.code.split('.')[1]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{policy.title}</span>
                <span className="block truncate text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {policy.state === 'REFERENCE' ? 'Read in Code of Conduct' : policy.state === 'HOLD' ? 'Awaiting authorized publication' : complete ? 'Read and acknowledged' : 'Open full policy'}
                </span>
              </span>
              <ChevronRight size={17} style={{ color: 'var(--text-tertiary)' }} />
            </button>;
          })}
        </div>
      </section>)}
    </div>}
  </section>;
}
