'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@apex/core-identity';
import { usersApi } from '@apex/core-users/api';
import { departmentsApi } from '@apex/core-organization-departments/api';
import {
  Activity, AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Download,
  Info, Package, RotateCcw, Search, Siren, X,
} from 'lucide-react';
import { eventsApi } from '../api';
import { getCompanyNow, getCompanyStartOfDay, getCompanyTodayStart } from '@/lib/company-date';
import { InventoryActivityPanel } from './InventoryActivityPanel';

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
  { value: 'attendance_leave', label: 'Attendance' },
  { value: 'projects', label: 'Projects' },
  { value: 'people', label: 'People' },
  { value: 'settings', label: 'Settings' },
  { value: 'sales', label: 'Sales' },
  { value: 'system', label: 'System' },
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

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function groupLabel(iso: string): string {
  const eventDay = getCompanyStartOfDay(new Date(iso));
  const today = getCompanyTodayStart();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (eventDay.getTime() === today.getTime()) return 'Today';
  if (eventDay.getTime() === yesterday.getTime()) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

function groupActivityEvents(items: AuditEvent[]): Array<{ label: string; events: AuditEvent[] }> {
  const groups = new Map<string, AuditEvent[]>();
  items.forEach((event) => {
    const label = groupLabel(event.timestamp);
    groups.set(label, [...(groups.get(label) ?? []), event]);
  });
  return Array.from(groups, ([label, events]) => ({ label, events }));
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
  const [logView, setLogView] = useState<'operations' | 'inventory'>('operations');
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

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
    setExpandedEventId(null);
  }, [deferredQuery, category, eventType, severity, departmentId, personId, dateRange, customFrom, customTo]);

  useEffect(() => {
    if (!eventType || !category) return;
    const actionCategory = ACTION_OPTIONS.find((item) => item.value === eventType)?.category;
    const categoryMatches = category === 'attendance_leave'
      ? actionCategory === 'attendance' || actionCategory === 'leave'
      : actionCategory === category;
    if (!categoryMatches) setEventType('');
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
  const groupedItems = useMemo(() => groupActivityEvents(items), [items]);
  const filteredActions = category
    ? ACTION_OPTIONS.filter((item) => category === 'attendance_leave'
      ? item.category === 'attendance' || item.category === 'leave'
      : item.category === category)
    : ACTION_OPTIONS;
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
        <h1 className="apex-page-title">Activity Log</h1>
        {logView === 'operations' && <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={exportPage} disabled={!items.length} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--text-secondary)] transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"><Download size={14} /> Export</button>
        </div>}
      </section>

      <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
        <nav aria-label="Activity log sections" className="flex min-w-0 flex-nowrap gap-1 overflow-x-auto rounded-card border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-1 xl:w-fit xl:shrink-0">
          {CATEGORY_OPTIONS.map((option) => {
            const isActive = logView === 'operations' && category === option.value;
            return <button
              type="button"
              key={option.value || 'all'}
              aria-pressed={isActive}
              onClick={() => { setLogView('operations'); setCategory(option.value); }}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2 text-xs font-semibold transition ${isActive ? 'bg-blue-600 text-white shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-card)] hover:text-[var(--text-primary)]'}`}
            >{option.value === '' && <Activity size={14} />}{option.label}</button>;
          })}
          {isAdmin && <button
            type="button"
            aria-pressed={logView === 'inventory'}
            onClick={() => setLogView('inventory')}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-control px-2 text-xs font-semibold transition ${logView === 'inventory' ? 'bg-blue-600 text-white shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-card)] hover:text-[var(--text-primary)]'}`}
          ><Package size={14} /> Inventory</button>}
        </nav>
        {logView === 'operations' && <label className="relative block min-w-0 flex-1 xl:w-72 xl:flex-none">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search activity…" aria-label="Search activity" className="apex-input h-10 w-full pl-9 pr-9 text-xs" />
          {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-control text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"><X size={14} /></button>}
        </label>}
      </div>

      {logView === 'inventory' && isAdmin ? <InventoryActivityPanel /> : <>
      <section className="apex-card !p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.5fr)_repeat(4,minmax(130px,0.75fr))]">
          <FilterSelect label="Period" value={dateRange} onChange={(value) => setDateRange(value as DateRange)} options={[{ value: 'today', label: 'Today' }, { value: 'last7', label: 'Last 7 days' }, { value: 'last30', label: 'Last 30 days' }, { value: 'all', label: 'All time' }, { value: 'custom', label: 'Custom period' }]} />
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
          {dateRange === 'custom' && <><input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} aria-label="From date" className="h-8 rounded-lg border border-[var(--border-primary)] bg-[var(--surface-card)] px-2 text-xs text-[var(--text-secondary)]" /><span className="text-xs text-[var(--text-tertiary)]">to</span><input type="date" min={customFrom || undefined} value={customTo} onChange={(event) => setCustomTo(event.target.value)} aria-label="To date" className="h-8 rounded-lg border border-[var(--border-primary)] bg-[var(--surface-card)] px-2 text-xs text-[var(--text-secondary)]" /></>}
          <div className="ml-auto flex items-center gap-2">
            {isFetching && !isLoading && <span className="text-caption text-[var(--text-tertiary)]">Updating…</span>}
            <button type="button" onClick={resetFilters} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"><RotateCcw size={14} /> Reset{activeFilters ? ` (${activeFilters})` : ''}</button>
          </div>
        </div>
      </section>

      <section>
        {isLoading ? <ActivitySkeleton timeline /> : isError ? (
          <EmptyPanel icon={AlertTriangle} title="Activity could not be loaded" description="The audit service did not respond. Your filters have been preserved." action={<button type="button" onClick={() => refetch()} className="text-xs font-bold text-blue-600 hover:underline">Try again</button>} />
        ) : items.length === 0 ? (
          <EmptyPanel icon={Activity} title="No matching activity" description="No events match this scope and filter combination. Broaden the period or reset the filters." action={activeFilters ? <button type="button" onClick={resetFilters} className="text-xs font-bold text-blue-600 hover:underline">Reset filters</button> : undefined} />
        ) : (
          <TimelineActivityList groups={groupedItems} expandedEventId={expandedEventId} onToggle={(eventId) => setExpandedEventId((current) => current === eventId ? null : eventId)} />
        )}
      </section>

      {!isLoading && !isError && data.total > 0 && <section className="flex flex-col items-center justify-between gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--surface-card)] px-4 py-3 sm:flex-row"><p className="text-xs text-[var(--text-secondary)]">Showing <strong>{(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)}</strong> of <strong>{data.total}</strong> events</p><div className="flex items-center gap-2"><button type="button" aria-label="Previous page" disabled={data.page <= 1 || isFetching} onClick={() => setPage((value) => Math.max(1, value - 1))} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border-primary)] px-2.5 text-xs font-semibold text-[var(--text-secondary)] disabled:opacity-40"><ChevronLeft size={14} /> Previous</button><span className="px-2 text-xs font-semibold text-[var(--text-secondary)]">Page {data.page} of {Math.max(1, data.totalPages)}</span><button type="button" aria-label="Next page" disabled={data.page >= data.totalPages || isFetching} onClick={() => setPage((value) => value + 1)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border-primary)] px-2.5 text-xs font-semibold text-[var(--text-secondary)] disabled:opacity-40">Next <ChevronRight size={14} /></button></div></section>}
      </>}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <label className="relative block"><span className="sr-only">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className={`h-10 w-full appearance-none rounded-lg border px-3 pr-8 text-xs outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-950 ${value ? 'border-blue-300 bg-blue-50/70 font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300' : 'border-[var(--border-primary)] bg-[var(--surface-card)] text-[var(--text-secondary)]'}`}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronRight size={14} className="pointer-events-none absolute right-2.5 top-1/2 rotate-90 -translate-y-1/2 text-[var(--text-tertiary)]" /></label>;
}

function TimelineActivityList({ groups, expandedEventId, onToggle }: { groups: Array<{ label: string; events: AuditEvent[] }>; expandedEventId: string | null; onToggle: (eventId: string) => void }) {
  return <div className="space-y-6">{groups.map((group) => <section key={group.label}>
    <h2 className="mb-3 text-caption font-extrabold uppercase tracking-[0.16em] text-[var(--text-primary)]">{group.label}</h2>
    <div className="relative space-y-2 pl-9 before:absolute before:bottom-5 before:left-[8px] before:top-5 before:w-px before:bg-blue-200 dark:before:bg-blue-900">
      {group.events.map((event) => {
        const category = CATEGORY_STYLE[event.category ?? 'system'] ?? CATEGORY_STYLE.system;
        const severity = severityMeta(event.severity);
        const SeverityIcon = severity.icon;
        const isExpanded = expandedEventId === event.id;
        const details = timelineDetails(event);
        return <article key={event.id} className="relative overflow-visible rounded-xl border border-[var(--border-primary)] bg-[var(--surface-card)] shadow-sm transition hover:border-blue-200 hover:shadow-md dark:hover:border-blue-900">
          <span className="absolute -left-[34px] top-[22px] z-10 h-[15px] w-[15px] rounded-full border-[4px] border-[var(--bg-primary)]" style={{ backgroundColor: category.dot }} />
          <button type="button" aria-expanded={isExpanded} onClick={() => onToggle(event.id)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left lg:grid-cols-[minmax(170px,0.42fr)_minmax(0,1fr)_auto_auto]">
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-caption font-extrabold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">{initials(event.actor?.name)}</span>
              <strong className="truncate text-xs text-[var(--text-primary)]">{event.actor?.name ?? 'System'}</strong>
            </span>
            <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-2 lg:col-span-1">
              <span className={`shrink-0 rounded-md px-2 py-1 text-caption font-extrabold uppercase tracking-wide ${category.color}`}>{category.label}</span>
              <span className="min-w-0 truncate text-xs font-semibold text-[var(--text-secondary)]">{event.description ?? humanize(event.action)}</span>
              {(event.fromState || event.toState) && <span className="basis-full truncate text-caption text-[var(--text-tertiary)]">{humanize(event.fromState ?? 'None')} <ChevronRight size={12} className="inline" /> {humanize(event.toState ?? 'None')}</span>}
            </span>
            <span className={`hidden items-center gap-1 rounded-full border px-2 py-1 text-caption font-bold sm:inline-flex ${severity.className}`}><SeverityIcon size={10} />{severity.label}</span>
            <span className="flex items-center justify-end gap-3">
              <span className="whitespace-nowrap text-right"><span className="block text-caption font-bold text-[var(--text-secondary)]">{timeOnly(event.timestamp)}</span><span className="block text-caption text-[var(--text-tertiary)]">{event.timeAgo}</span></span>
              <ChevronDown size={16} className={`text-[var(--text-tertiary)] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </span>
          </button>
          {isExpanded && <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/60 px-4 py-3 sm:pl-[52px]">
            <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">{details.map(([label, value]) => <div key={`${label}-${value}`} className="grid grid-cols-[90px_minmax(0,1fr)] gap-2 text-caption"><dt className="font-bold text-[var(--text-tertiary)]">{label}</dt><dd className="break-words font-semibold text-[var(--text-secondary)]">{value}</dd></div>)}</dl>
          </div>}
        </article>;
      })}
    </div>
  </section>)}</div>;
}

function timelineDetails(event: AuditEvent): Array<[string, string]> {
  const details: Array<[string, string]> = [
    ['Event', humanize(event.action)],
    ['Recorded', exactTimestamp(event.timestamp)],
  ];
  if (event.entityType || event.entityId) details.push(['Record', [event.entityType ? humanize(event.entityType) : '', event.entityId].filter(Boolean).join(' · ')]);
  if (event.fromState || event.toState) details.push(['Change', `${humanize(event.fromState ?? 'None')} → ${humanize(event.toState ?? 'None')}`]);
  const metadataEntries = Object.entries(event.metadata ?? {})
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 3);
  metadataEntries.forEach(([key, value]) => details.push([humanize(key), String(value)]));
  return details;
}

function ActivitySkeleton({ timeline = false }: { timeline?: boolean }) {
  return <div className={timeline ? 'space-y-2 pl-9' : ''}>{[1, 2, 3, 4, 5].map((item) => <div key={item} className={`flex animate-pulse items-center gap-3 px-4 py-3 ${timeline ? 'rounded-xl border border-[var(--border-primary)] bg-[var(--surface-card)]' : 'border-b border-[var(--border-subtle)] last:border-b-0'}`}><span className="h-9 w-9 rounded-full bg-[var(--bg-tertiary)]" /><span className="flex-1 space-y-2"><span className="block h-2.5 w-2/5 rounded bg-[var(--bg-tertiary)]" /><span className="block h-2.5 w-3/5 rounded bg-[var(--bg-secondary)]" /></span><span className="h-7 w-24 rounded bg-[var(--bg-secondary)]" /></div>)}</div>;
}

function EmptyPanel({ icon: Icon, title, description, action }: { icon: any; title: string; description: string; action?: React.ReactNode }) {
  return <div className="flex flex-col items-center px-6 py-12 text-center"><span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-[var(--text-tertiary)]"><Icon size={20} /></span><p className="text-sm font-bold text-[var(--text-primary)]">{title}</p><p className="mt-1 max-w-md text-xs leading-5 text-[var(--text-tertiary)]">{description}</p>{action && <div className="mt-3">{action}</div>}</div>;
}
