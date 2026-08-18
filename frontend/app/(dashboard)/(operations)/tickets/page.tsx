'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ticketsApi } from '@/lib/api';
import { departmentsApi } from '@apex/core-organization-departments/api';
import { useAuthStore } from '@/store/auth.store';
import toast from 'react-hot-toast';
import { TicketRow } from '@apex/operations-tickets-lifecycle/components/ticket-row';
import { SkeletonTicketRows } from '@apex/shared-ui/components/skeleton';
import { useDebounce } from '@apex/shared-utilities/use-debounce';
import { useSocket } from '@/hooks/useSocket';
import { STATUS_LABELS } from '@apex/operations-tickets-lifecycle/shared/ticket-vocabulary';
import { cn } from '@apex/shared-utilities';
import { Plus, Search, RefreshCw, Download, AlertTriangle, UserCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getCompanyTodayStart, getCompanyTodayEnd } from '@/lib/company-date';

const STATUSES = ['', 'OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CLOSED'];
const PRIORITIES = ['', 'URGENT', 'HIGH', 'MEDIUM', 'LOW'];

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
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'all' | 'approvals'>('all');

  const debouncedSearch = useDebounce(search, 300);

  // Live refresh when any ticket is created or its status changes
  useSocket({
    onTicketCreated: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
    onTicketStatusChanged: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
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
    setPage(Math.max(1, Number(params.get('page')) || 1));
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

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['tickets', { ...filters, ...extraFilters, search: debouncedSearch }, page],
    queryFn: () => ticketsApi.getAll({ ...filters, ...extraFilters, search: debouncedSearch, page, limit: 25 }) as Promise<any>,
  });

  const { data: pendingApprovals, isLoading: isLoadingPending } = useQuery({
    queryKey: ['pending-approvals'],
    queryFn: () => ticketsApi.getPendingApprovals() as Promise<any[]>,
    enabled: !!currentUser?.id,
  });

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll() as Promise<any[]>,
  });

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

  const statusCounts = (stats?.byStatus || []).reduce((acc: any, s: any) => {
    acc[s.status] = s._count;
    return acc;
  }, {});

  const hasActiveFilters = search || Object.values(filters).some(Boolean) || overdueOnly || myTickets;

  const roleName = (currentUser?.role as any)?.name ?? currentUser?.role ?? '';
  const scopeText =
    roleName === 'SUPER_ADMIN' || roleName === 'ADMIN' ? 'Showing company-wide tickets' :
    roleName === 'MANAGER' ? 'Showing managed department tickets' :
    roleName === 'TEAM_LEAD' ? 'Showing your team tickets' :
    'Showing your assigned tickets';

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Tickets</h2>
            {activeTab === 'all' && (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full dark:bg-slate-800 dark:text-slate-400">
                {scopeText}
              </span>
            )}
          </div>
          {activeTab === 'all' && <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{total} tickets total</p>}
        </div>
        <div className="flex items-center gap-2">
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
                await ticketsApi.exportCsv({ ...filters, ...extraFilters, search });
              } catch {
                toast.error('Export failed');
              }
            }}
            className="apex-btn apex-btn-secondary"
            title="Export CSV"
          >
            <Download size={15} />
            Export
          </button>
          <Link href="/tickets/new" className="apex-btn-new-ticket">
            <Plus size={16} />
            New Ticket
          </Link>
        </div>
      </div>

      {(['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName) || (pendingApprovals && pendingApprovals.length > 0)) && (
        <div className="flex border-b mb-4" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            onClick={() => setActiveTab('all')}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === 'all' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            All Tickets
          </button>
          <button
            onClick={() => setActiveTab('approvals')}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px flex items-center gap-2',
              activeTab === 'approvals' ? 'border-amber-600 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            Pending Approvals
            {pendingApprovals && pendingApprovals.length > 0 && (
              <span className="bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">
                {pendingApprovals.length}
              </span>
            )}
          </button>
        </div>
      )}

      {activeTab === 'all' ? (
        <>
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
        className="rounded-xl p-4"
        style={{
          backgroundColor: 'var(--surface-card)',
          border: '1px solid var(--border-primary)',
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
              className="apex-input pl-9"
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

          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearch('');
                setFilters({ status: '', priority: '', departmentId: '', assignedToId: '', projectId: '', dateFrom: '', dateTo: '', dueAfter: '', dueBefore: '' });
                setOverdueOnly(false);
                setMyTickets(false);
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
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: 'var(--surface-card)',
          border: '1px solid var(--border-primary)',
        }}
      >
        <div
          className="grid grid-cols-12 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-primary)',
            color: 'var(--text-tertiary)',
          }}
        >
          <div className="col-span-5">Ticket</div>
          <div className="col-span-2">Type</div>
          <div className="col-span-1">Priority</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Assignee</div>
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
            <Link href="/tickets/new" className="mt-3 text-sm font-medium" style={{ color: 'var(--accent)' }}>
              Create one →
            </Link>
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
      </>
      ) : (
        /* Pending Approvals Tab */
        <div
          className="rounded-xl overflow-hidden mt-4"
          style={{
            backgroundColor: 'var(--surface-card)',
            border: '1px solid var(--border-primary)',
          }}
        >
          <div
            className="grid grid-cols-12 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              borderBottom: '1px solid var(--border-primary)',
              color: 'var(--text-tertiary)',
            }}
          >
            <div className="col-span-5">Ticket</div>
            <div className="col-span-2">Type</div>
            <div className="col-span-1">Priority</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Creator</div>
          </div>

          {isLoadingPending ? (
            <SkeletonTicketRows count={3} />
          ) : pendingApprovals && pendingApprovals.length > 0 ? (
            <div>
              {pendingApprovals.map((ticket: any) => <TicketRow key={ticket.id} ticket={ticket} />)}
            </div>
          ) : (
            <div className="apex-empty">
              <div className="apex-empty-icon text-amber-500">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
              </div>
              <p className="apex-empty-title">No pending approvals</p>
              <p className="apex-empty-desc">You're all caught up!</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
