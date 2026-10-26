'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@apex/core-identity';
import { usersApi } from '@apex/core-users/api';
import { departmentsApi } from '@apex/core-organization-departments/api';
import { useRouter } from 'next/navigation';
import {
  Activity, AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Download,
  ExternalLink, Info, Layers3, RotateCcw, Search, ShieldAlert, Siren, Users, X,
} from 'lucide-react';
import { eventsApi } from '../api';
import { getCompanyNow, getCompanyStartOfDay, getCompanyTodayStart } from '@/lib/company-date';

type DateRange = 'today' | 'last7' | 'last30' | 'all' | 'custom';
type Severity = '' | 'info' | 'warning' | 'critical';

type AuditEvent = {
  id: string;
  action: string;
  actorId?: string;
  actor?: { id: string; name: string; avatar?: string | null } | null;
  category?: string;
  severity?: 'info' | 'warning' | 'critical';
  description?: string;
  entityType?: string;
  entityId?: string;
  entityUrl?: string | null;
  timestamp: string;
  timeAgo?: string;
  fromState?: string | null;
  toState?: string | null;
  metadata?: Record<string, unknown> | null;
  beforeValue?: Record<string, unknown> | null;
  afterValue?: Record<string, unknown> | null;
  ip?: string | null;
  device?: string | null;
};

type AuditResponse = {
  items: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: {
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
    uniqueActors: number;
  };
};

const EMPTY_RESPONSE: AuditResponse = {
  items: [], total: 0, page: 1, pageSize: 30, totalPages: 0,
  summary: { byCategory: {}, bySeverity: {}, uniqueActors: 0 },
};

const CATEGORY_OPTIONS = [
  { value: '', label: 'All activity' },
  { value: 'tickets', label: 'Tickets' },
  { value: 'attendance', label: 'Attendance' },
  { value: 'leave', label: 'Leave' },
  { value: 'projects', label: 'Projects' },
  { value: 'people', label: 'People & access' },
  { value: 'settings', label: 'Settings' },
  { value: 'sales', label: 'Sales CRM' },
  { value: 'system', label: 'System & exports' },
];

const ACTION_OPTIONS: Array<{ value: string; label: string; category: string }> = [
  { value: 'TICKET_CREATED', label: 'Ticket created', category: 'tickets' },
  { value: 'TICKET_ASSIGNED', label: 'Ticket assigned', category: 'tickets' },
  { value: 'TICKET_STARTED', label: 'Ticket started', category: 'tickets' },
  { value: 'TICKET_SUBMITTED_FOR_REVIEW', label: 'Submitted for review', category: 'tickets' },
  { value: 'TICKET_DONE', label: 'Ticket completed', category: 'tickets' },
  { value: 'TICKET_BLOCKED', label: 'Ticket blocked', category: 'tickets' },
  { value: 'TICKET_DELETED', label: 'Ticket deleted', category: 'tickets' },
  { value: 'COMMENT_ADDED', label: 'Comment added', category: 'tickets' },
  { value: 'WORKDAY_STARTED', label: 'Workday started', category: 'attendance' },
  { value: 'WORKDAY_ENDED', label: 'Workday ended', category: 'attendance' },
  { value: 'BREAK_STARTED', label: 'Break started', category: 'attendance' },
  { value: 'BREAK_ENDED', label: 'Break ended', category: 'attendance' },
  { value: 'REGULARIZATION_REQUESTED', label: 'Regularization requested', category: 'attendance' },
  { value: 'ATTENDANCE_OFFICIAL_REVISED', label: 'Attendance revised', category: 'attendance' },
  { value: 'LEAVE_REQUESTED', label: 'Leave requested', category: 'leave' },
  { value: 'LEAVE_APPROVED', label: 'Leave approved', category: 'leave' },
  { value: 'LEAVE_REJECTED', label: 'Leave rejected', category: 'leave' },
  { value: 'LEAVE_CANCELLED', label: 'Leave cancelled', category: 'leave' },
  { value: 'PROJECT_CREATED', label: 'Project created', category: 'projects' },
  { value: 'PROJECT_UPDATED', label: 'Project updated', category: 'projects' },
  { value: 'PROJECT_MEMBER_ADDED', label: 'Project member added', category: 'projects' },
  { value: 'USER_LOGIN', label: 'User signed in', category: 'people' },
  { value: 'USER_CREATED', label: 'User created', category: 'people' },
  { value: 'USER_ROLE_CHANGED', label: 'User role changed', category: 'people' },
  { value: 'USER_DEACTIVATED', label: 'User deactivated', category: 'people' },
  { value: 'HIERARCHY_ASSIGNMENT_UPDATED', label: 'Reporting line updated', category: 'people' },
  { value: 'HIERARCHY_ASSIGNMENT_ENDED', label: 'Reporting line ended', category: 'people' },
  { value: 'PROFILE_UPDATED', label: 'Profile updated', category: 'people' },
  { value: 'SETTINGS_UPDATED', label: 'Settings updated', category: 'settings' },
  { value: 'EXPORT_PERFORMED', label: 'Data exported', category: 'system' },
];

const CATEGORY_STYLE: Record<string, { label: string; color: string; dot: string }> = {
  tickets: { label: 'Ticket', color: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300', dot: '#3b82f6' },
  attendance: { label: 'Attendance', color: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', dot: '#10b981' },
  leave: { label: 'Leave', color: 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300', dot: '#8b5cf6' },
  projects: { label: 'Project', color: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300', dot: '#6366f1' },
  people: { label: 'People', color: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300', dot: '#0891b2' },
  settings: { label: 'Settings', color: 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300', dot: '#f97316' },
  sales: { label: 'Sales', color: 'bg-pink-50 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300', dot: '#ec4899' },
  system: { label: 'System', color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', dot: '#64748b' },
};

function humanize(value?: string | null): string {
  if (!value) return 'Not recorded';
  return value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function exactTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
}

function shortTimestamp(iso: string): string {
  const date = new Date(iso);
  const today = getCompanyTodayStart();
  const eventDay = getCompanyStartOfDay(date);
  const time = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  if (eventDay.getTime() === today.getTime()) return `Today, ${time}`;
  return `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`;
}

function safeJson(value: unknown): string {
  if (value === null || value === undefined) return 'Not recorded';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function escapeCsv(value: unknown): string {
  const content = value === null || value === undefined ? '' : String(value);
  return `"${content.replace(/"/g, '""')}"`;
}

function initials(name?: string): string {
  return (name ?? 'System').split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join('').toUpperCase();
}

function severityMeta(severity?: string) {
  if (severity === 'critical') return { label: 'Critical', icon: Siren, className: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900' };
  if (severity === 'warning') return { label: 'Needs attention', icon: AlertTriangle, className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900' };
  return { label: 'Information', icon: Info, className: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700' };
}

export default function ActivityLogScreen() {
  const user = useAuthStore((state) => state.user);
  const router = useRouter();
  const role = (user?.role as any)?.name ?? user?.role ?? '';
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(role);
  const isDeptLead = ['MANAGER', 'TEAM_LEAD'].includes(role);
  const canFilterPeople = isAdmin || isDeptLead;

  const [dateRange, setDateRange] = useState<DateRange>('last7');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  const [category, setCategory] = useState('');
  const [eventType, setEventType] = useState('');
  const [severity, setSeverity] = useState<Severity>('');
  const [departmentId, setDepartmentId] = useState('');
  const [personId, setPersonId] = useState('');
  const [page, setPage] = useState(1);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);

  const { data: peopleData } = useQuery({
    queryKey: ['activity-log-people'],
    queryFn: () => usersApi.getDirectory() as Promise<any>,
    enabled: canFilterPeople,
    staleTime: 60_000,
  });
  const { data: departmentsData } = useQuery({
    queryKey: ['activity-log-departments'],
    queryFn: () => departmentsApi.getAll() as Promise<any>,
    enabled: canFilterPeople,
    staleTime: 60_000,
  });
  const people = useMemo(() => {
    const raw = peopleData as any;
    const rows = Array.isArray(raw) ? raw : raw?.items ?? raw?.data ?? [];
    return [...rows].sort((a: any, b: any) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
  }, [peopleData]);
  const departments = useMemo(() => {
    const raw = departmentsData as any;
    const rows = Array.isArray(raw) ? raw : raw?.items ?? raw?.data ?? [];
    return [...rows].sort((a: any, b: any) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
  }, [departmentsData]);
  const visiblePeople = useMemo(() => {
    if (!departmentId) return people;
    return people.filter((person: any) => (person.departmentId ?? person.department?.id) === departmentId);
  }, [people, departmentId]);

  const params = useMemo(() => {
    const result: Record<string, unknown> = { paginated: true, page, limit: 30 };
    if (deferredQuery) result.q = deferredQuery;
    if (category) result.category = category;
    if (eventType) result.action = eventType;
    if (severity) result.severity = severity;
    if (departmentId) result.departmentId = departmentId;
    if (personId) result.userId = personId;
    const now = getCompanyNow();
    if (dateRange === 'today') {
      result.from = getCompanyTodayStart().toISOString();
    } else if (dateRange === 'last7' || dateRange === 'last30') {
      const start = getCompanyStartOfDay(new Date(now));
      start.setDate(start.getDate() - (dateRange === 'last7' ? 6 : 29));
      result.from = start.toISOString();
    } else if (dateRange === 'custom') {
      if (customFrom) result.from = new Date(`${customFrom}T00:00:00`).toISOString();
      if (customTo) result.to = new Date(`${customTo}T23:59:59.999`).toISOString();
    }
    return result;
  }, [page, deferredQuery, category, eventType, severity, departmentId, personId, dateRange, customFrom, customTo]);

  useEffect(() => {
    setPage(1);
    setSelectedEvent(null);
  }, [deferredQuery, category, eventType, severity, departmentId, personId, dateRange, customFrom, customTo]);

  useEffect(() => {
    if (eventType && category && ACTION_OPTIONS.find((item) => item.value === eventType)?.category !== category) setEventType('');
  }, [category, eventType]);

  useEffect(() => {
    if (!personId || !departmentId) return;
    const selectedPerson = people.find((person: any) => person.id === personId);
    if (selectedPerson && (selectedPerson.departmentId ?? selectedPerson.department?.id) !== departmentId) setPersonId('');
  }, [departmentId, people, personId]);

  const { data = EMPTY_RESPONSE, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['activity-log-v2', params],
    queryFn: () => eventsApi.getAll(params) as Promise<AuditResponse>,
    placeholderData: (previous) => previous,
    staleTime: 20_000,
  });

  const items = data.items ?? [];
  const scopeText = isAdmin ? 'Company scope' : isDeptLead ? 'Department scope' : 'Personal scope';
  const filteredActions = category ? ACTION_OPTIONS.filter((item) => item.category === category) : ACTION_OPTIONS;
  const attentionCount = (data.summary?.bySeverity?.warning ?? 0) + (data.summary?.bySeverity?.critical ?? 0);
  const activeFilters = [deferredQuery, category, eventType, severity, departmentId, personId, dateRange === 'custom' ? customFrom || customTo : ''].filter(Boolean).length;

  const resetFilters = () => {
    setQuery(''); setCategory(''); setEventType(''); setSeverity(''); setDepartmentId(''); setPersonId('');
    setDateRange('last7'); setCustomFrom(''); setCustomTo(''); setPage(1);
  };

  const exportPage = () => {
    if (!items.length) return;
    const rows = [
      ['Timestamp', 'Actor', 'Category', 'Severity', 'Action', 'Description', 'Entity type', 'Entity ID'],
      ...items.map((event) => [
        exactTimestamp(event.timestamp), event.actor?.name ?? 'System', event.category ?? 'system',
        event.severity ?? 'info', event.action, event.description ?? humanize(event.action),
        event.entityType ?? '', event.entityId ?? '',
      ]),
    ];
    const csv = rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `apex-activity-log-${new Date().toISOString().slice(0, 10)}-page-${data.page}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div id="apex-main-content" className="space-y-4 pb-8">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="apex-page-title !m-0 !text-[22px]">Activity Log</h1>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">{scopeText}</span>
          </div>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Review operational changes, approvals, access activity and exceptions in one place.</p>
        </div>
        <button type="button" onClick={exportPage} disabled={!items.length} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--text-secondary)] transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"><Download size={14} /> Export this page</button>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard icon={Activity} label="Matching events" value={data.total ?? 0} tone="blue" />
        <SummaryCard icon={Users} label="People involved" value={data.summary?.uniqueActors ?? 0} tone="cyan" />
        <SummaryCard icon={ShieldAlert} label="Needs attention" value={attentionCount} tone="amber" />
        <SummaryCard icon={Layers3} label="Categories active" value={Object.keys(data.summary?.byCategory ?? {}).length} tone="violet" />
      </section>

      <section className="apex-card !p-4">
        <div className="grid gap-3 xl:grid-cols-3 2xl:grid-cols-[minmax(240px,1.5fr)_repeat(5,minmax(140px,0.75fr))]">
          <label className="relative block">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actor, action or record type…" aria-label="Search activity" className="h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--surface-card)] pl-9 pr-9 text-xs text-[var(--text-primary)] outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-950" />
            {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"><X size={14} /></button>}
          </label>
          <FilterSelect label="Category" value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
          {canFilterPeople ? (
            <FilterSelect label="Department" value={departmentId} onChange={setDepartmentId} options={[{ value: '', label: isAdmin ? 'All departments' : 'All managed departments' }, ...departments.map((department: any) => ({ value: department.id, label: department.name ?? 'Unnamed department' }))]} />
          ) : <div className="flex h-10 items-center rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-xs text-[var(--text-tertiary)]">Your department</div>}
          {canFilterPeople ? (
            <FilterSelect label="Person" value={personId} onChange={setPersonId} options={[{ value: '', label: departmentId ? 'Everyone in department' : (isAdmin ? 'All people' : 'All managed people') }, ...visiblePeople.map((person: any) => ({ value: person.id, label: person.name ?? person.email ?? 'Unnamed user' }))]} />
          ) : <div className="flex h-10 items-center rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 text-xs text-[var(--text-tertiary)]">Your activity only</div>}
          <FilterSelect label="Event" value={eventType} onChange={setEventType} options={[{ value: '', label: 'All event types' }, ...filteredActions]} />
          <FilterSelect label="Severity" value={severity} onChange={(value) => setSeverity(value as Severity)} options={[{ value: '', label: 'All severity levels' }, { value: 'info', label: 'Information' }, { value: 'warning', label: 'Needs attention' }, { value: 'critical', label: 'Critical' }]} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
          <span className="mr-1 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]"><CalendarDays size={13} /> Period</span>
          {([['today', 'Today'], ['last7', '7 days'], ['last30', '30 days'], ['all', 'All time'], ['custom', 'Custom']] as Array<[DateRange, string]>).map(([value, label]) => (
            <button type="button" key={value} onClick={() => setDateRange(value)} className={`h-8 rounded-lg border px-3 text-xs font-semibold transition ${dateRange === value ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300' : 'border-[var(--border-primary)] bg-[var(--surface-card)] text-[var(--text-secondary)] hover:border-blue-200'}`}>{label}</button>
          ))}
          {dateRange === 'custom' && <><input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} aria-label="From date" className="h-8 rounded-lg border border-[var(--border-primary)] bg-[var(--surface-card)] px-2 text-xs text-[var(--text-secondary)]" /><span className="text-xs text-[var(--text-tertiary)]">to</span><input type="date" min={customFrom || undefined} value={customTo} onChange={(event) => setCustomTo(event.target.value)} aria-label="To date" className="h-8 rounded-lg border border-[var(--border-primary)] bg-[var(--surface-card)] px-2 text-xs text-[var(--text-secondary)]" /></>}
          <div className="ml-auto flex items-center gap-2">
            {isFetching && !isLoading && <span className="text-[11px] text-[var(--text-tertiary)]">Updating…</span>}
            <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"><RotateCcw size={13} /> Reset{activeFilters ? ` (${activeFilters})` : ''}</button>
          </div>
        </div>
      </section>

      <section className="apex-card !overflow-hidden !p-0">
        <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_130px_150px]"><span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Event</span><span className="hidden text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)] sm:block">Severity</span><span className="text-right text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">When</span></div>
        {isLoading ? <ActivitySkeleton /> : isError ? (
          <EmptyPanel icon={AlertTriangle} title="Activity could not be loaded" description="The audit service did not respond. Your filters have been preserved." action={<button type="button" onClick={() => refetch()} className="text-xs font-bold text-blue-600 hover:underline">Try again</button>} />
        ) : items.length === 0 ? (
          <EmptyPanel icon={Activity} title="No matching activity" description="No events match this scope and filter combination. Broaden the period or reset the filters." action={activeFilters ? <button type="button" onClick={resetFilters} className="text-xs font-bold text-blue-600 hover:underline">Reset filters</button> : undefined} />
        ) : items.map((event) => {
          const categoryInfo = CATEGORY_STYLE[event.category ?? 'system'] ?? CATEGORY_STYLE.system;
          const severityInfo = severityMeta(event.severity);
          const SeverityIcon = severityInfo.icon;
          return (
            <button type="button" key={event.id} onClick={() => setSelectedEvent(event)} className="grid w-full grid-cols-[minmax(0,1fr)_120px] items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3 text-left transition last:border-b-0 hover:bg-slate-50/80 dark:hover:bg-slate-900/40 sm:grid-cols-[minmax(0,1fr)_130px_150px]">
              <span className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white" style={{ background: categoryInfo.dot }}>{initials(event.actor?.name)}</span><span className="min-w-0"><span className="flex flex-wrap items-center gap-1.5"><strong className="truncate text-xs text-[var(--text-primary)]">{event.actor?.name ?? 'System'}</strong><span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${categoryInfo.color}`}>{categoryInfo.label}</span></span><span className="mt-0.5 block truncate text-xs text-[var(--text-secondary)]">{event.description ?? humanize(event.action)}</span><span className="mt-1 block truncate font-mono text-[9px] uppercase tracking-wide text-[var(--text-tertiary)]">{humanize(event.action)}{event.metadata?.ticketId ? ` · ${String(event.metadata.ticketId)}` : ''}</span></span></span>
              <span className={`hidden w-fit items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-bold sm:inline-flex ${severityInfo.className}`}><SeverityIcon size={11} />{severityInfo.label}</span>
              <span className="text-right"><span className="block text-[11px] font-semibold text-[var(--text-secondary)]">{shortTimestamp(event.timestamp)}</span><span className="mt-0.5 block text-[10px] text-[var(--text-tertiary)]">{event.timeAgo}</span></span>
            </button>
          );
        })}
      </section>

      {!isLoading && !isError && data.total > 0 && <section className="flex flex-col items-center justify-between gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--surface-card)] px-4 py-3 sm:flex-row"><p className="text-xs text-[var(--text-secondary)]">Showing <strong>{(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)}</strong> of <strong>{data.total}</strong> events</p><div className="flex items-center gap-2"><button type="button" aria-label="Previous page" disabled={data.page <= 1 || isFetching} onClick={() => setPage((value) => Math.max(1, value - 1))} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border-primary)] px-2.5 text-xs font-semibold text-[var(--text-secondary)] disabled:opacity-40"><ChevronLeft size={14} /> Previous</button><span className="px-2 text-xs font-semibold text-[var(--text-secondary)]">Page {data.page} of {Math.max(1, data.totalPages)}</span><button type="button" aria-label="Next page" disabled={data.page >= data.totalPages || isFetching} onClick={() => setPage((value) => value + 1)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border-primary)] px-2.5 text-xs font-semibold text-[var(--text-secondary)] disabled:opacity-40">Next <ChevronRight size={14} /></button></div></section>}
      {selectedEvent && <EventDrawer event={selectedEvent} onClose={() => setSelectedEvent(null)} onOpen={() => selectedEvent.entityUrl && router.push(selectedEvent.entityUrl)} />}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <label className="relative block"><span className="sr-only">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className={`h-10 w-full appearance-none rounded-lg border px-3 pr-8 text-xs outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-950 ${value ? 'border-blue-300 bg-blue-50/70 font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300' : 'border-[var(--border-primary)] bg-[var(--surface-card)] text-[var(--text-secondary)]'}`}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronRight size={13} className="pointer-events-none absolute right-2.5 top-1/2 rotate-90 -translate-y-1/2 text-[var(--text-tertiary)]" /></label>;
}

function SummaryCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: 'blue' | 'cyan' | 'amber' | 'violet' }) {
  const tones = { blue: 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300', cyan: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950/30 dark:text-cyan-300', amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-300', violet: 'bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-300' };
  return <div className="apex-card flex items-center gap-3 !p-3.5"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}><Icon size={17} /></span><span className="min-w-0"><strong className="block text-lg leading-none text-[var(--text-primary)]">{value.toLocaleString('en-IN')}</strong><span className="mt-1 block truncate text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{label}</span></span></div>;
}

function ActivitySkeleton() {
  return <div>{[1, 2, 3, 4, 5].map((item) => <div key={item} className="flex animate-pulse items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0"><span className="h-9 w-9 rounded-full bg-[var(--bg-tertiary)]" /><span className="flex-1 space-y-2"><span className="block h-2.5 w-2/5 rounded bg-[var(--bg-tertiary)]" /><span className="block h-2.5 w-3/5 rounded bg-[var(--bg-secondary)]" /></span><span className="h-7 w-24 rounded bg-[var(--bg-secondary)]" /></div>)}</div>;
}

function EmptyPanel({ icon: Icon, title, description, action }: { icon: any; title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex flex-col items-center px-6 py-12 text-center"><span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-[var(--text-tertiary)]"><Icon size={20} /></span><p className="text-sm font-bold text-[var(--text-primary)]">{title}</p><p className="mt-1 max-w-md text-xs leading-5 text-[var(--text-tertiary)]">{description}</p>{action && <div className="mt-3">{action}</div>}</div>;
}

function EventDrawer({ event, onClose, onOpen }: { event: AuditEvent; onClose: () => void; onOpen: () => void }) {
  const severity = severityMeta(event.severity);
  const SeverityIcon = severity.icon;
  const category = CATEGORY_STYLE[event.category ?? 'system'] ?? CATEGORY_STYLE.system;
  return <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/30 backdrop-blur-[1px]" role="presentation" onMouseDown={(mouseEvent) => { if (mouseEvent.currentTarget === mouseEvent.target) onClose(); }}><aside role="dialog" aria-modal="true" aria-label="Activity event details" className="flex h-full w-full max-w-lg flex-col border-l border-[var(--border-primary)] bg-[var(--surface-card)] shadow-2xl"><header className="flex items-start justify-between border-b border-[var(--border-primary)] px-5 py-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-600">Audit event</p><h2 className="mt-1 text-base font-bold text-[var(--text-primary)]">{humanize(event.action)}</h2></div><button type="button" onClick={onClose} aria-label="Close event details" className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"><X size={17} /></button></header><div className="flex-1 space-y-5 overflow-y-auto px-5 py-5"><div className="flex flex-wrap gap-2"><span className={`rounded px-2 py-1 text-[10px] font-bold uppercase ${category.color}`}>{category.label}</span><span className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-bold ${severity.className}`}><SeverityIcon size={11} />{severity.label}</span></div><div className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4"><p className="text-sm font-semibold leading-6 text-[var(--text-primary)]"><strong>{event.actor?.name ?? 'System'}</strong> {event.description ?? humanize(event.action)}</p><p className="mt-2 text-xs text-[var(--text-tertiary)]">{exactTimestamp(event.timestamp)}</p></div><DetailGrid event={event} />{(event.fromState || event.toState) && <section><DetailHeading>State transition</DetailHeading><div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2"><ValueBox label="Before" value={event.fromState ?? 'None'} /><ChevronRight size={16} className="text-[var(--text-tertiary)]" /><ValueBox label="After" value={event.toState ?? 'None'} /></div></section>}{event.metadata && Object.keys(event.metadata).length > 0 && <JsonSection title="Event context" value={event.metadata} />}{event.beforeValue && <JsonSection title="Previous values" value={event.beforeValue} />}{event.afterValue && <JsonSection title="Updated values" value={event.afterValue} />}</div><footer className="flex items-center justify-between gap-3 border-t border-[var(--border-primary)] px-5 py-4"><button type="button" onClick={onClose} className="h-9 rounded-lg border border-[var(--border-primary)] px-4 text-xs font-semibold text-[var(--text-secondary)]">Close</button>{event.entityUrl && <button type="button" onClick={onOpen} className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white hover:bg-blue-700">Open related record <ExternalLink size={13} /></button>}</footer></aside></div>;
}

function DetailGrid({ event }: { event: AuditEvent }) {
  const details = [['Actor', event.actor?.name ?? 'System'], ['Record type', event.entityType ?? 'System'], ['Record ID', event.entityId ?? 'Not available'], ['Event ID', event.id], ...(event.device ? [['Device', event.device]] : []), ...(event.ip ? [['IP address', event.ip]] : [])];
  return <section><DetailHeading>Event identity</DetailHeading><dl className="grid gap-3 sm:grid-cols-2">{details.map(([label, value]) => <div key={label} className="min-w-0 rounded-lg border border-[var(--border-subtle)] p-3"><dt className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{label}</dt><dd className="mt-1 break-all text-xs font-semibold text-[var(--text-secondary)]">{value}</dd></div>)}</dl></section>;
}

function DetailHeading({ children }: { children: React.ReactNode }) { return <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">{children}</h3>; }
function ValueBox({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-[var(--border-primary)] p-3"><p className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{label}</p><p className="mt-1 text-xs font-semibold text-[var(--text-secondary)]">{humanize(value)}</p></div>; }
function JsonSection({ title, value }: { title: string; value: unknown }) { return <section><DetailHeading>{title}</DetailHeading><pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[var(--border-primary)] bg-slate-950 p-3 font-mono text-[10px] leading-5 text-slate-200">{safeJson(value)}</pre></section>; }
