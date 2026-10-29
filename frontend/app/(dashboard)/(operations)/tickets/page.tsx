'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ticketsApi } from '@apex/operations-tickets-lifecycle/api';
import { departmentsApi } from '@apex/core-organization-departments/api';
import { usersApi } from '@apex/core-users/api';
import { useAuthStore } from '@apex/core-identity';
import toast from 'react-hot-toast';
import { TicketRow } from '@apex/operations-tickets-lifecycle/components/ticket-row';
import { SkeletonTicketRows } from '@apex/shared-ui/components/skeleton';
import { useDebounce } from '@apex/shared-utilities/use-debounce';
import { useSocket } from '@/hooks/useSocket';
import { STATUS_LABELS } from '@apex/operations-tickets-lifecycle/shared/ticket-vocabulary';
import { Plus, Search, RefreshCw, Download, AlertTriangle, UserCheck, CalendarDays } from 'lucide-react';
import Link from 'next/link';
import { CreateTicketLink } from '@apex/operations-tickets-lifecycle/components/ticket-creation-gate';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getCompanyTodayStart, getCompanyTodayEnd } from '@/lib/company-date';
import {
  mainScrollElement,
  scrollElementTo,
  scrollOf,
  useRecordTicketOpen,
  useRestoreOnce,
  useThrottledScroll,
  useTicketNavState,
} from '@apex/operations-tickets-lifecycle/components/use-ticket-nav-state';
import { pollWhileHealthy } from '@apex/shared-auth';

const STATUSES = ['', 'OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CLOSED'];
const PRIORITIES = ['', 'URGENT', 'HIGH', 'MEDIUM', 'LOW'];

type DateFilterMode = 'day' | 'month' | 'year';

function DateFilterPopover({
  dateFrom,
  dateTo,
  onApply,
}: {
  dateFrom: string;
  dateTo: string;
  onApply: (dateFrom: string, dateTo: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DateFilterMode>('day');
  const [day, setDay] = useState(dateFrom === dateTo ? dateFrom : '');
  const [month, setMonth] = useState(dateFrom ? dateFrom.slice(0, 7) : '');
  const [year, setYear] = useState(dateFrom ? dateFrom.slice(0, 4) : String(new Date().getFullYear()));

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const apply = () => {
    if (mode === 'day' && day) onApply(day, day);
    if (mode === 'month' && /^\d{4}-\d{2}$/.test(month)) {
      const [selectedYear, selectedMonth] = month.split('-').map(Number);
      const lastDay = new Date(Date.UTC(selectedYear, selectedMonth, 0)).getUTCDate();
      onApply(`${month}-01`, `${month}-${String(lastDay).padStart(2, '0')}`);
    }
    if (mode === 'year' && /^\d{4}$/.test(year)) onApply(`${year}-01-01`, `${year}-12-31`);
    setOpen(false);
  };

  const selectionMissing = (mode === 'day' && !day) || (mode === 'month' && !month) || (mode === 'year' && !/^\d{4}$/.test(year));
  const active = Boolean(dateFrom || dateTo);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="h-9 w-9 rounded-lg border inline-flex items-center justify-center transition-colors"
        style={{
          backgroundColor: active ? 'var(--accent)' : 'var(--surface-card)',
          borderColor: active ? 'var(--accent)' : 'var(--border-primary)',
          color: active ? 'white' : 'var(--text-secondary)',
        }}
        aria-label="Filter tickets by created date"
        aria-expanded={open}
        title={active ? `Created ${dateFrom} to ${dateTo}` : 'Filter by created date'}
      >
        <CalendarDays size={17} aria-hidden="true" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-30 mt-2 w-72 rounded-xl border p-4 shadow-xl"
          style={{ backgroundColor: 'var(--surface-card)', borderColor: 'var(--border-primary)' }}
          role="dialog"
          aria-label="Created date filter"
        >
          <p className="mb-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Filter by created date</p>
          <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg p-1" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
            {(['day', 'month', 'year'] as DateFilterMode[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMode(option)}
                className="rounded-md px-2 py-1.5 text-xs font-semibold capitalize"
                style={mode === option ? { backgroundColor: 'var(--accent)', color: 'white' } : { color: 'var(--text-secondary)' }}
              >
                {option}
              </button>
            ))}
          </div>

          {mode === 'day' && <input aria-label="Created day" type="date" value={day} onChange={(event) => setDay(event.target.value)} className="apex-input" />}
          {mode === 'month' && <input aria-label="Created month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="apex-input" />}
          {mode === 'year' && <input aria-label="Created year" type="number" min="2000" max="2100" step="1" value={year} onChange={(event) => setYear(event.target.value.slice(0, 4))} className="apex-input" />}

          <div className="mt-4 flex justify-end gap-2">
            {active && (
              <button type="button" onClick={() => { onApply('', ''); setOpen(false); }} className="apex-btn apex-btn-secondary text-xs">
                Clear
              </button>
            )}
            <button type="button" onClick={apply} disabled={selectionMissing} className="apex-btn apex-btn-primary text-xs disabled:cursor-not-allowed disabled:opacity-50">
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TicketsPage() {
  const qc = useQueryClient();
  const currentUser = useAuthStore(s => s.user);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    status: '',
    priority: '',
    departmentId: '',
    assignedToId: '',
    projectId: '',
    dateFrom: '',
    dateTo: '',
    dueAfter: '',
    dueBefore: '',
  });
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [myTickets, setMyTickets] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<'actionable-review' | 'personal-review' | ''>('');
  const [page, setPage] = useState(1);
  /** The query string the filters were last read from (null until the first read). */
  const [filtersFromUrl, setFiltersFromUrl] = useState<string | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  // Live refresh when any ticket is created or its status changes.
  const refreshTicketLists = () => {
    qc.invalidateQueries({ queryKey: ['tickets'] });
    qc.invalidateQueries({ queryKey: ['ticket-stats'] });
  };
  useSocket({
    onTicketCreated: refreshTicketLists,
    onTicketStatusChanged: refreshTicketLists,
  });

  useEffect(() => {
    const params = new URLSearchParams(queryString);
    const quickFilter = params.get('filter') || params.get('risk') || '';
    const dueToday = quickFilter === 'due-today';
    const start = getCompanyTodayStart();
    const end = getCompanyTodayEnd();

    setSearch(params.get('search') || '');
    setFilters({
      status: params.get('status') || '',
      priority: params.get('priority') || '',
      departmentId: params.get('departmentId') || params.get('department') || '',
      assignedToId: params.get('assignedToId') || params.get('assignee') || '',
      projectId: params.get('projectId') || '',
      dateFrom: params.get('dateFrom') || '',
      dateTo: params.get('dateTo') || '',
      dueAfter: dueToday ? start.toISOString() : (params.get('dueAfter') || ''),
      dueBefore: dueToday ? end.toISOString() : (params.get('dueBefore') || ''),
    });
    setOverdueOnly(params.get('overdue') === 'true' || quickFilter === 'overdue');
    setMyTickets(params.get('mine') === 'true' || quickFilter === 'mine');
    setReviewFilter(quickFilter === 'actionable-review' || quickFilter === 'personal-review' ? quickFilter : '');
    setPage(Math.max(1, Number(params.get('page')) || 1));
    setFiltersFromUrl(queryString);
  }, [queryString]);

  const updateQuery = (updates: Record<string, string | number | null | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === undefined || value === '') params.delete(key);
      else params.set(key, String(value));
    });
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const extraFilters: Record<string, any> = {};
  ['assignedToId', 'projectId', 'dateFrom', 'dateTo', 'dueAfter', 'dueBefore'].forEach((key) => {
    const value = (filters as any)[key];
    if (value) extraFilters[key] = value;
  });
  if (overdueOnly) extraFilters.overdue = 'true';
  if (myTickets && currentUser?.id) extraFilters.assignedToId = currentUser.id;
  if (reviewFilter) extraFilters.filter = reviewFilter;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['tickets', { ...filters, ...extraFilters, search: debouncedSearch }, page],
    queryFn: () => ticketsApi.getAll({ ...filters, ...extraFilters, search: debouncedSearch, page, limit: 25 }) as Promise<any>,
    // Time Left follows each assignee's work timer, which their own break / end
    // day / punch pauses and resumes without touching this page. Poll like Kanban.
    refetchInterval: pollWhileHealthy(30_000),
    refetchOnWindowFocus: true,
  });

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll() as Promise<any[]>,
  });

  // Assignee filter options: GET /users is already scoped by role (leads and
  // managers see their managed departments), the same scope as assignment.
  const roleNameForFilters = (currentUser?.role as any)?.name ?? currentUser?.role ?? '';
  const canFilterByAssignee = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleNameForFilters);
  const { data: assigneeOptions } = useQuery({
    queryKey: ['ticket-filter-assignees'],
    queryFn: () => usersApi.getAll({ limit: 100 }) as Promise<any>,
    enabled: canFilterByAssignee,
    staleTime: 5 * 60_000,
  });
  const assigneeList: any[] = Array.isArray(assigneeOptions) ? assigneeOptions : assigneeOptions?.users ?? [];

  const { data: stats } = useQuery({
    queryKey: ['ticket-stats'],
    queryFn: () => ticketsApi.getStats() as Promise<any>,
  });

  const setFilter = (key: string, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
    updateQuery({ [key]: value || null, page: null, filter: null });
  };

  const tickets = data?.tickets || [];
  const total = data?.total || 0;

  // Back / Forward / refresh: filters, search and page come back from the URL;
  // the scroll position comes back from navigation state.
  const listPath = queryString ? `${pathname}?${queryString}` : pathname;
  const nav = useTicketNavState('tickets', listPath, currentUser?.id);
  const pageRef = useRef<HTMLDivElement>(null);
  // Nothing is saved until the restored position has been applied, so an
  // early save can never overwrite it with the top of an empty list.
  const restoreApplied = useRef(false);
  const saveNav = () => {
    if (restoreApplied.current) nav.save({ tab: 'all', scroll: scrollOf(mainScrollElement()) });
  };
  // Ready once the list on screen is the one the URL asks for (the search box
  // is debounced) and its rows have loaded.
  const listReady = nav.checked && filtersFromUrl === queryString && debouncedSearch === search && !isLoading;
  useRestoreOnce(listReady, (force) => {
    const s = nav.restored?.scroll;
    if (s && !scrollElementTo(mainScrollElement(), s, force)) return false;
    restoreApplied.current = true;
    return true;
  });
  useThrottledScroll(() => [mainScrollElement()], saveNav, nav.checked);
  useRecordTicketOpen(pageRef, currentUser?.id, listPath);

  const statusCounts = (stats?.byStatus || []).reduce((acc: any, s: any) => {
    acc[s.status] = s._count;
    return acc;
  }, {});

  const hasActiveFilters = search || Object.values(filters).some(Boolean) || overdueOnly || myTickets || reviewFilter;

  const roleName = (currentUser?.role as any)?.name ?? currentUser?.role ?? '';
  const scopeText =
    roleName === 'SUPER_ADMIN' || roleName === 'ADMIN' ? 'Showing company-wide tickets' :
    roleName === 'MANAGER' ? 'Showing managed department tickets' :
    roleName === 'TEAM_LEAD' ? 'Showing your team tickets' :
    'Showing your assigned tickets';

  return (
    <div ref={pageRef} className="space-y-4 max-w-7xl mx-auto">
      {/* Header — wraps on narrow screens so the actions never fall off the edge */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="apex-page-title text-xl" style={{ color: 'var(--text-primary)' }}>Tickets</h2>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full dark:bg-slate-800 dark:text-slate-400">
              {scopeText}
            </span>
          </div>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{total} tickets total</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg transition-colors hover:opacity-80"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
          <button
            onClick={async () => {
              try {
                await ticketsApi.exportCsv({ ...filters, ...extraFilters, search: debouncedSearch });
              } catch (e: any) {
                toast.error(e?.message || 'Export failed. Please try again.');
              }
            }}
            className="apex-btn apex-btn-secondary"
            title="Export CSV"
          >
            <Download size={15} />
            Export
          </button>
          <CreateTicketLink className="apex-btn-new-ticket">
            <Plus size={16} />
            New Ticket
          </CreateTicketLink>
        </div>
      </div>

      {/* Quick Status Filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {['', 'OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE'].map((status) => (
          <button
            key={status}
            onClick={() => setFilter('status', status)}
            className="text-xs font-semibold px-3.5 py-1.5 rounded-full transition-all border"
            style={filters.status === status ? {
              backgroundColor: 'var(--accent)',
              color: 'white',
              borderColor: 'var(--accent)',
              boxShadow: '0 2px 8px var(--accent-ring)',
            } : {
              backgroundColor: 'var(--surface-card)',
              color: 'var(--text-secondary)',
              borderColor: 'var(--border-primary)',
            }}
          >
            {status ? (STATUS_LABELS[status] ?? status) : 'All'}{status && statusCounts[status] ? ` (${statusCounts[status]})` : ''}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div
        className="apex-section-border rounded-xl border p-4"
        style={{
          backgroundColor: 'var(--surface-card)',
        }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
            <input
              type="text"
              placeholder="Search tickets..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); updateQuery({ search: e.target.value || null, page: null }); }}
              className="apex-input apex-search-input"
            />
          </div>

          <select
            value={filters.priority}
            onChange={(e) => setFilter('priority', e.target.value)}
            className="apex-select"
          >
            {PRIORITIES.map((p) => <option key={p} value={p}>{p || 'All Priorities'}</option>)}
          </select>

          <select
            value={filters.departmentId}
            onChange={(e) => setFilter('departmentId', e.target.value)}
            className="apex-select"
          >
            <option value="">All Departments</option>
            {Array.isArray(departments) && departments.map((d: any) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>

          <DateFilterPopover
            dateFrom={filters.dateFrom}
            dateTo={filters.dateTo}
            onApply={(dateFrom, dateTo) => {
              setFilters((current) => ({ ...current, dateFrom, dateTo }));
              setPage(1);
              updateQuery({ dateFrom: dateFrom || null, dateTo: dateTo || null, page: null, filter: null });
            }}
          />

          {canFilterByAssignee && (
            <select
              aria-label="Assignee"
              value={myTickets ? '' : filters.assignedToId}
              disabled={myTickets}
              onChange={(e) => setFilter('assignedToId', e.target.value)}
              className="apex-select"
            >
              <option value="">All Assignees</option>
              {assigneeList.map((u: any) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          )}

          {/* Overdue toggle */}
          <button
            onClick={() => {
              const next = !overdueOnly;
              setOverdueOnly(next);
              setPage(1);
              updateQuery({ overdue: next ? 'true' : null, filter: null, page: null });
            }}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all"
            style={overdueOnly ? {
              backgroundColor: 'var(--color-danger)',
              color: 'white',
              borderColor: 'var(--color-danger)',
            } : {
              backgroundColor: 'var(--surface-card)',
              color: 'var(--text-secondary)',
              borderColor: 'var(--border-primary)',
            }}
            title="Show overdue tickets only"
          >
            <AlertTriangle size={12} />Overdue
          </button>

          {/* My Tickets toggle */}
          <button
            onClick={() => {
              const next = !myTickets;
              setMyTickets(next);
              setPage(1);
              updateQuery({ mine: next ? 'true' : null, assignedToId: null, filter: null, page: null });
            }}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all"
            style={myTickets ? {
              backgroundColor: 'var(--accent)',
              color: 'white',
              borderColor: 'var(--accent)',
            } : {
              backgroundColor: 'var(--surface-card)',
              color: 'var(--text-secondary)',
              borderColor: 'var(--border-primary)',
            }}
            title="Show tickets assigned to me"
          >
            <UserCheck size={12} />My Tickets
          </button>

          {reviewFilter && <button
            type="button"
            onClick={() => { setReviewFilter(''); setPage(1); updateQuery({ filter: null, page: null }); }}
            className="rounded-full border px-3 py-1.5 text-xs font-semibold"
            style={{ backgroundColor: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }}
          >{reviewFilter === 'personal-review' ? 'My in-review work' : 'My review queue'} ×</button>}

          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearch('');
                setFilters({ status: '', priority: '', departmentId: '', assignedToId: '', projectId: '', dateFrom: '', dateTo: '', dueAfter: '', dueBefore: '' });
                setOverdueOnly(false);
                setMyTickets(false);
                setReviewFilter('');
                setPage(1);
                router.replace(pathname, { scroll: false });
              }}
              className="text-xs font-medium"
              style={{ color: 'var(--color-danger)' }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Tickets Table */}
      <div
        className="apex-section-border rounded-xl overflow-hidden border"
        style={{
          backgroundColor: 'var(--surface-card)',
        }}
      >
        {/* Hidden on phones, where each row stacks. These md: classes are also
            the ones TicketRow uses (Tailwind does not scan platforms/). */}
        <div
          className="hidden md:grid md:grid-cols-12 gap-4 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-primary)',
            color: 'var(--text-tertiary)',
          }}
        >
          <div className="md:col-span-5">Ticket</div>
          <div className="md:col-span-2">Type</div>
          <div className="md:col-span-1">Priority</div>
          <div className="md:col-span-2">Status</div>
          <div className="md:col-span-2">Assignee</div>
        </div>

        {isLoading ? (
          <SkeletonTicketRows count={8} />
        ) : tickets.length > 0 ? (
          <div>
            {tickets.map((ticket: any) => <TicketRow key={ticket.id} ticket={ticket} />)}
          </div>
        ) : (
          <div className="apex-empty">
            <div className="apex-empty-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
            </div>
            <p className="apex-empty-title">No tickets found</p>
            <p className="apex-empty-desc">Try adjusting your filters or create a new ticket.</p>
            <CreateTicketLink className="mt-3 text-sm font-medium" style={{ color: 'var(--accent)' }}>
              Create one →
            </CreateTicketLink>
          </div>
        )}

        {total > 25 && (
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Showing {Math.min((page - 1) * 25 + 1, total)}–{Math.min(page * 25, total)} of {total}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const next = Math.max(1, page - 1);
                  setPage(next);
                  updateQuery({ page: next > 1 ? next : null });
                }}
                disabled={page === 1}
                className="apex-btn apex-btn-secondary text-xs disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => {
                  const next = page + 1;
                  setPage(next);
                  updateQuery({ page: next });
                }}
                disabled={page * 25 >= total}
                className="apex-btn apex-btn-secondary text-xs disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
