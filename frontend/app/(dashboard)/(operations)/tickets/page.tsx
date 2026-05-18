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
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Tickets</h2>
          <p className="text-sm text-slate-500 dark:text-gray-400 mt-0.5">{total} tickets total</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="p-2 text-slate-500 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800 rounded-lg transition-colors" title="Refresh">
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
            className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-gray-400 border border-slate-200 dark:border-gray-700 hover:bg-slate-50 dark:hover:bg-gray-800 px-3 py-2 rounded-lg transition-colors"
            title="Export CSV"
          >
            <Download size={15} />
            Export
          </button>
          <Link
            href="/tickets/new"
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
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
            className={cn(
              'text-xs font-medium px-3 py-1.5 rounded-full transition-colors border',
              filters.status === status
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white dark:bg-gray-900 text-slate-600 dark:text-gray-400 border-slate-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-500',
            )}
          >
            {status ? (STATUS_LABELS[status] ?? status) : 'All'}{status && statusCounts[status] ? ` (${statusCounts[status]})` : ''}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
            <input
              type="text"
              placeholder="Search tickets..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500"
            />
          </div>

          <select
            value={filters.category}
            onChange={(e) => setFilter('category', e.target.value)}
            className="text-sm border border-slate-200 dark:border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100"
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{c || 'All Categories'}</option>)}
          </select>

          <select
            value={filters.priority}
            onChange={(e) => setFilter('priority', e.target.value)}
            className="text-sm border border-slate-200 dark:border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100"
          >
            {PRIORITIES.map((p) => <option key={p} value={p}>{p || 'All Priorities'}</option>)}
          </select>

          <select
            value={filters.departmentId}
            onChange={(e) => setFilter('departmentId', e.target.value)}
            className="text-sm border border-slate-200 dark:border-gray-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100"
          >
            <option value="">All Departments</option>
            {Array.isArray(departments) && departments.map((d: any) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>

          {hasActiveFilters && (
            <button
              onClick={() => { setSearch(''); setFilters({ status: '', category: '', priority: '', departmentId: '' }); setPage(1); }}
              className="text-xs text-red-500 hover:text-red-700 font-medium"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Tickets Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 overflow-hidden">
        <div className="grid grid-cols-12 px-4 py-2.5 bg-slate-50 dark:bg-gray-800 border-b border-slate-200 dark:border-gray-700 text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wider">
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
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <p className="text-slate-400 text-sm">No tickets found</p>
            <Link href="/tickets/new" className="text-blue-600 text-sm hover:underline">Create one?</Link>
          </div>
        )}

        {total > 25 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-gray-800">
            <p className="text-xs text-slate-500 dark:text-gray-400">
              Showing {Math.min((page - 1) * 25 + 1, total)}–{Math.min(page * 25, total)} of {total}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="text-xs px-3 py-1.5 border border-slate-200 dark:border-gray-700 rounded-lg disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-gray-800 text-slate-600 dark:text-gray-400"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page * 25 >= total}
                className="text-xs px-3 py-1.5 border border-slate-200 dark:border-gray-700 rounded-lg disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-gray-800 text-slate-600 dark:text-gray-400"
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
