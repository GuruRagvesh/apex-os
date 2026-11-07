'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, FileSpreadsheet, History, Search, X } from 'lucide-react';
import { eventsApi } from '../api';

type WorkbookImport = {
  id?: string;
  fileName?: string;
  importedByName?: string;
  sheets?: Array<{ name?: string }>;
  summary?: Record<string, number | string>;
  createdAt?: string;
};

type InventoryEvent = {
  id?: string;
  createdAt?: string;
  actorName?: string;
  entityType?: string;
  action?: string;
  entityId?: string;
};

type InventoryActivityResponse = {
  imports?: WorkbookImport[];
  audit?: InventoryEvent[];
};

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function matchesQuery(row: unknown, query: string) {
  return !query || JSON.stringify(row).toLowerCase().includes(query);
}

export function InventoryActivityPanel() {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['inventory-activity-log'],
    queryFn: () => eventsApi.getInventoryActivity() as Promise<InventoryActivityResponse>,
    staleTime: 30_000,
  });

  const imports = useMemo(
    () => (Array.isArray(data?.imports) ? data.imports : []).filter((row) => matchesQuery(row, deferredQuery)),
    [data?.imports, deferredQuery],
  );
  const events = useMemo(
    () => (Array.isArray(data?.audit) ? data.audit : []).filter((row) => matchesQuery(row, deferredQuery)),
    [data?.audit, deferredQuery],
  );

  if (isLoading) return <div className="h-72 animate-pulse rounded-2xl bg-[var(--bg-secondary)]" />;
  if (isError) return <div className="apex-card flex flex-col items-center px-6 py-12 text-center"><AlertTriangle className="mb-3 text-amber-700" size={24} /><p className="text-sm font-bold text-[var(--text-primary)]">Inventory activity could not be loaded</p><button type="button" onClick={() => refetch()} className="mt-3 text-xs font-bold text-blue-600 hover:underline">Try again</button></div>;

  return <div className="space-y-4">
    <section className="apex-card flex flex-col gap-3 !p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="text-sm font-bold text-[var(--text-primary)]">Inventory activity</h2><p className="mt-0.5 text-xs text-[var(--text-tertiary)]">Workbook imports and inventory record changes are kept together here.</p></div>
      <label className="relative block w-full sm:w-80"><span className="sr-only">Search inventory activity</span><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search inventory activity…" className="h-10 w-full rounded-lg border border-[var(--border-primary)] bg-[var(--surface-card)] pl-9 pr-9 text-xs text-[var(--text-primary)] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-950" />{query && <button type="button" aria-label="Clear inventory activity search" onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"><X size={14} /></button>}</label>
    </section>

    <ActivityTable
      icon={FileSpreadsheet}
      title="Workbook imports"
      count={imports.length}
      emptyLabel={deferredQuery ? 'No workbook imports match your search.' : 'No workbook imports have been recorded.'}
      headers={['Workbook', 'Imported by', 'Sheets', 'Records', 'Imported']}
      rows={imports.map((row) => [
        row.fileName ?? 'Unnamed workbook',
        row.importedByName ?? 'Unknown',
        Array.isArray(row.sheets) ? row.sheets.map((sheet) => sheet.name).filter(Boolean).join(', ') || '—' : '—',
        Object.values(row.summary ?? {}).reduce<number>((total, value) => total + Number(value || 0), 0).toLocaleString('en-IN'),
        formatDate(row.createdAt),
      ])}
    />

    <ActivityTable
      icon={History}
      title="Inventory record activity"
      count={events.length}
      emptyLabel={deferredQuery ? 'No inventory events match your search.' : 'No inventory changes have been recorded.'}
      headers={['When', 'Actor', 'Area', 'Action', 'Record ID']}
      rows={events.map((row) => [formatDate(row.createdAt), row.actorName ?? 'System', row.entityType ?? '—', String(row.action ?? '—').replaceAll('_', ' '), row.entityId ?? '—'])}
    />
  </div>;
}

function ActivityTable({ icon: Icon, title, count, headers, rows, emptyLabel }: { icon: any; title: string; count: number; headers: string[]; rows: string[][]; emptyLabel: string }) {
  return <section className="apex-card !overflow-hidden !p-0">
    <header className="flex items-center justify-between border-b border-[var(--border-primary)] px-4 py-3"><div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300"><Icon size={16} /></span><h2 className="text-sm font-bold text-[var(--text-primary)]">{title}</h2></div><span className="rounded-full bg-[var(--bg-secondary)] px-2.5 py-1 text-caption font-bold text-[var(--text-secondary)]">{count.toLocaleString('en-IN')}</span></header>
    {rows.length === 0 ? <p className="px-5 py-10 text-center text-xs text-[var(--text-tertiary)]">{emptyLabel}</p> : <div className="max-h-[420px] overflow-auto"><table className="w-full min-w-[820px] border-collapse text-left"><thead className="sticky top-0 z-10 bg-[#123b74] text-white"><tr>{headers.map((header) => <th key={header} className="px-4 py-3 text-caption font-bold uppercase tracking-wider">{header}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`} className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-secondary)]">{row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`} className="max-w-sm px-4 py-3 text-xs text-[var(--text-secondary)] first:font-semibold first:text-[var(--text-primary)]">{cell}</td>)}</tr>)}</tbody></table></div>}
  </section>;
}
