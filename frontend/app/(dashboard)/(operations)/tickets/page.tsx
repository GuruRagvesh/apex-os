'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ticketsApi, departmentsApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { TicketRow } from '@/components/tickets/ticket-row';
import { SkeletonTicketRows } from '@/components/ui/skeleton';
import { useDebounce } from '@/hooks/useDebounce';
import { useSocket } from '@/hooks/useSocket';
import { cn, CATEGORY_COLORS, STATUS_LABELS } from '@/lib/utils';
import { Plus, Search, RefreshCw, Download } from 'lucide-react';
import Link from 'next/link';

const STATUSES = ['', 'OPEN', 'IN_PROGRESS', 'REVIEW', 'DONE', 'CLOSED'];
const CATEGORIES = ['', 'IT', 'FACILITIES', 'HR', 'OPERATIONS', 'PROJECT', 'ADMIN'];
const PRIORITIES = ['', 'URGENT', 'HIGH', 'MEDIUM', 'LOW'];

export default function TicketsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ status: '', category: '', priority: '', departmentId: '' });
  const [page, setPage] = useState(1);

  const debouncedSearch = useDebounce(search, 300);

  // Live refresh when any ticket is created or its status changes
  useSocket({
    onTicketCreated: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
    onTicketStatusChanged: () => qc.invalidateQueries({ queryKey: ['tickets'] }),
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['tickets', { ...filters, search: debouncedSearch }, page],
    queryFn: () => ticketsApi.getAll({ ...filters, search: debouncedSearch, page, limit: 25 }) as Promise<any>,
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
  };

  const tickets = data?.tickets || [];
  const total = data?.total || 0;

  const statusCounts = (stats?.byStatus || []).reduce((acc: any, s: any) => {
    acc[s.status] = s._count;
    return acc;
  }, {});

  const hasActiveFilters = search || Object.values(filters).some(Boolean);

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Tickets</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{total} tickets total</p>
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
                await ticketsApi.exportCsv({ ...filters, search });
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
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="apex-input pl-9"
            />
          </div>

          <select
            value={filters.category}
            onChange={(e) => setFilter('category', e.target.value)}
            className="apex-select"
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{c || 'All Categories'}</option>)}
          </select>

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

          {hasActiveFilters && (
            <button
              onClick={() => { setSearch(''); setFilters({ status: '', category: '', priority: '', departmentId: '' }); setPage(1); }}
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
          <div className="col-span-6">Ticket</div>
          <div className="col-span-2">Category</div>
          <div className="col-span-1">Priority</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-1">Assignee</div>
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
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="apex-btn apex-btn-secondary text-xs disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
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
