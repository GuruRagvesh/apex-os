'use client';

import { FormEvent, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap as r } from '@apex/shared-auth';
import { useAuthStore } from '@/store/auth.store';
import toast from 'react-hot-toast';
import { AlertCircle, Archive, CheckCircle2, ChevronDown, ChevronRight, Download, FileSpreadsheet, Package, Plus, RotateCcw, Search, Upload, X } from 'lucide-react';

type AssetData = { assets: any[]; allocations: any[]; requests: any[]; rentals: any[]; mobile: any[]; repairs: any[]; types: any[]; imports: any[]; audit: any[] };
type Tab = 'registry' | 'allocations' | 'requests' | 'rentals' | 'mobile' | 'repairs' | 'activity';
type ImportAnalysis = { canImport: boolean; sheets: Array<{ name: string; category: string; rows: number }>; ignoredSheets: string[]; errorCount: number; errors: string[] };

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'registry', label: 'Asset Registry' }, { id: 'allocations', label: 'Allocations & Returns' },
  { id: 'requests', label: 'Requests' },
  { id: 'rentals', label: 'Rentals' }, { id: 'mobile', label: 'Mobile & SIM' },
  { id: 'repairs', label: 'Repairs' }, { id: 'activity', label: 'Activity Log' },
];

const loadAssetSection = (section: Tab) => r<AssetData>(api.get('/assets', { params: { section } }));

const formatDate = (v?: string) => v ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(v)) : '—';
const formatMoney = (v?: string | number) => v === null || v === undefined ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(v));
const valueText = (v: any) => typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v ?? '—';
const importErrorMessage = (error: any) => {
  const payload = error?.response?.data ?? error;
  const detail = payload?.message ?? payload;
  if (Array.isArray(detail?.errors) && detail.errors.length) return detail.errors[0];
  if (Array.isArray(payload?.errors) && payload.errors.length) return payload.errors[0];
  if (typeof detail?.message === 'string') return detail.message;
  if (typeof detail === 'string') return detail;
  return 'The workbook could not be imported. Review the file analysis and try again.';
};

function Status({ value }: { value?: string }) {
  const label = value || 'UNKNOWN';
  const positive = ['AVAILABLE', 'ACTIVE', 'PAID', 'APPROVED', 'CLOSED', 'COMPLETED'].includes(label);
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${positive ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>{label.replaceAll('_', ' ')}</span>;
}

function Empty({ label, onImport, description }: { label: string; onImport?: () => void; description?: string }) {
  return <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--border-primary)] bg-[var(--bg-secondary)] p-8 text-center">
    <Archive className="mb-4 h-10 w-10 text-[var(--text-tertiary)]" /><h3 className="font-semibold text-[var(--text-primary)]">No {label} yet</h3>
    <p className="mt-1 max-w-md text-sm text-[var(--text-secondary)]">{description ?? 'Import the confidential master workbook when it is ready. Apex OS does not create sample or dummy records.'}</p>
    {onImport && <button onClick={onImport} className="apex-btn apex-btn-primary mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"><Upload className="h-4 w-4" /> Import workbook</button>}
  </div>;
}

function Table({ columns, rows, actions }: { columns: Array<{ key: string; label: string; render?: (row: any) => React.ReactNode }>; rows: any[]; actions?: (row: any) => React.ReactNode }) {
  return <div className="relative h-[clamp(24rem,calc(100vh-13rem),48rem)] overflow-hidden rounded-xl border-2 border-[#173f73] bg-[var(--surface-card)] shadow-sm"><div className="inventory-table-scroll h-full overflow-auto"><table className="min-w-full border-separate border-spacing-0 text-left text-sm">
    <thead className="sticky top-0 z-20 bg-[#0b2f64] text-xs uppercase tracking-wide text-white shadow-[0_2px_5px_rgba(15,23,42,0.28)]"><tr>{columns.map((c, index) => <th key={c.key} scope="col" className={`sticky top-0 z-20 whitespace-nowrap bg-[#0b2f64] px-4 py-3.5 font-semibold ${index ? 'border-l border-blue-800' : ''}`}>{c.label}</th>)}{actions && <th scope="col" className="sticky top-0 z-20 border-l border-blue-800 bg-[#0b2f64] px-4 py-3.5 font-semibold">Actions</th>}</tr></thead>
    <tbody>{rows.map((row, i) => <tr key={row.id ?? i} className="border-t border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]">{columns.map((c, index) => <td key={c.key} className={`max-w-xs px-4 py-3 text-[var(--text-primary)] ${index ? 'border-l border-[var(--border-subtle)]' : ''}`}>{c.render ? c.render(row) : valueText(row[c.key])}</td>)}{actions && <td className="whitespace-nowrap border-l border-[var(--border-subtle)] px-4 py-3">{actions(row)}</td>}</tr>)}</tbody>
  </table></div><span aria-hidden="true" className="inventory-scrollbar-header-cap pointer-events-none absolute right-[2px] top-[2px] z-40 h-11 w-3 rounded-tr-[8px] bg-[#0b2f64]" /></div>;
}

const requestTypeLabel = (value?: string) => ({
  ASSET_REQUEST: 'Asset request', ASSET_RETURN: 'Asset return', ASSET_REPLACEMENT: 'Replacement',
  MULTIPLE_ASSETS: 'Multiple assets', ASSET_REPAIR: 'Repair', ASSET_DAMAGE: 'Damage report', OTHER: 'Other',
}[value ?? ''] ?? (value || 'Other').replaceAll('_', ' '));

const requestedItemsLabel = (row: any) => {
  if (Array.isArray(row.requestedItems) && row.requestedItems.length) {
    return row.requestedItems.map((item: any) => `${item.quantity ?? 1}× ${item.assetType ?? item.assetCode ?? 'Asset'}`).join(', ');
  }
  return row.requestedAssetType ?? row.linkedAssetId ?? '—';
};

function Field({ name, label, type = 'text', required, children }: { name: string; label: string; type?: string; required?: boolean; children?: React.ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-medium text-[var(--text-primary)]"><span>{label}{required && <b className="text-red-500"> *</b>}</span>{children ?? <input name={name} type={type} required={required} className="apex-input rounded-xl px-3 py-2.5" />}</label>;
}

export default function AssetManagementPage() {
  const { user, hasHydrated } = useAuthStore();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const quickActionsRef = useRef<HTMLDetailsElement>(null);
  const [tab, setTab] = useState<Tab>('registry'); const [query, setQuery] = useState('');
  const [registryFilters, setRegistryFilters] = useState({ name: '', ownership: '', type: '', status: '' });
  const [importOpen, setImportOpen] = useState(false); const [form, setForm] = useState<{ mode: string; row?: any } | null>(null);
  const [customAssetType, setCustomAssetType] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importAnalysis, setImportAnalysis] = useState<ImportAnalysis | null>(null);
  const [importError, setImportError] = useState('');
  const allowed = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role?.name ?? '');
  const dataQuery = useQuery({
    queryKey: ['asset-management', tab],
    queryFn: () => loadAssetSection(tab),
    enabled: hasHydrated && allowed,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const employeeOptionsQuery = useQuery({
    queryKey: ['asset-allocation-employees'],
    queryFn: () => r<any[]>(api.get('/users/directory')),
    enabled: hasHydrated && allowed && form?.mode === 'allocation',
    staleTime: 5 * 60_000,
    retry: false,
  });
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ['asset-management'] }); };
  const save = useMutation({ mutationFn: ({ url, body, patch }: any) => r(patch ? api.patch(url, body) : api.post(url, body)), onSuccess: async () => { toast.success('Saved'); setForm(null); await refresh(); }, onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save the record.') });
  const analyzeImport = useMutation({ mutationFn: (file: File) => { const body = new FormData(); body.append('file', file); return r<ImportAnalysis>(api.post('/assets/import/analyze', body, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })); }, onSuccess: analysis => { setImportAnalysis(analysis); setImportError(analysis.canImport ? '' : analysis.errors[0] ?? 'The workbook needs attention before it can be imported.'); }, onError: (error: any) => { setImportAnalysis(null); setImportError(importErrorMessage(error)); } });
  const upload = useMutation({ mutationFn: (file: File) => { const body = new FormData(); body.append('file', file); return r<any>(api.post('/assets/import', body, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })); }, onSuccess: async x => { toast.success(x.alreadyImported ? 'This workbook was already imported. No duplicate records were created.' : `Imported ${Object.values(x.summary as Record<string, number>).reduce((a, b) => a + b, 0)} records`); setImportOpen(false); setSelectedFile(null); setImportAnalysis(null); setImportError(''); if (fileRef.current) fileRef.current.value = ''; await refresh(); }, onError: (error: any) => { const message = importErrorMessage(error); setImportError(message); toast.error(message); } });
  const data = useMemo<AssetData>(() => {
    const incoming = dataQuery.data as Partial<AssetData> | undefined;
    return {
      assets: Array.isArray(incoming?.assets) ? incoming.assets : [],
      allocations: Array.isArray(incoming?.allocations) ? incoming.allocations : [],
      requests: Array.isArray(incoming?.requests) ? incoming.requests : [],
      rentals: Array.isArray(incoming?.rentals) ? incoming.rentals : [],
      mobile: Array.isArray(incoming?.mobile) ? incoming.mobile : [],
      repairs: Array.isArray(incoming?.repairs) ? incoming.repairs : [],
      types: Array.isArray(incoming?.types) ? incoming.types : [],
      imports: Array.isArray(incoming?.imports) ? incoming.imports : [],
      audit: Array.isArray(incoming?.audit) ? incoming.audit : [],
    };
  }, [dataQuery.data]);
  const filtered = (rows: any[]) => !query ? rows : rows.filter(row => JSON.stringify(row).toLowerCase().includes(query.toLowerCase()));
  const registryFilterOptions = useMemo(() => {
    const unique = (values: unknown[]) => Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))).sort((a, b) => a.localeCompare(b));
    return {
      names: unique(data.assets.map(asset => asset.allocations?.[0]?.employeeName)),
      ownerships: unique(data.assets.map(asset => asset.ownership)),
      types: unique(data.assets.map(asset => asset.assetType?.name ?? asset.assetTypeName)),
      statuses: unique(data.assets.map(asset => asset.status)),
    };
  }, [data.assets]);
  const filteredAssets = useMemo(() => {
    const search = query.trim().toLowerCase();
    return data.assets.filter(asset => {
      const name = String(asset.allocations?.[0]?.employeeName ?? '');
      const type = String(asset.assetType?.name ?? asset.assetTypeName ?? '');
      return (!search || JSON.stringify(asset).toLowerCase().includes(search))
        && (!registryFilters.name || name === registryFilters.name)
        && (!registryFilters.ownership || asset.ownership === registryFilters.ownership)
        && (!registryFilters.type || type === registryFilters.type)
        && (!registryFilters.status || asset.status === registryFilters.status);
    });
  }, [data.assets, query, registryFilters]);
  const registryFiltersActive = Object.values(registryFilters).some(Boolean);
  const clearRegistryFilters = () => setRegistryFilters({ name: '', ownership: '', type: '', status: '' });
  const employeeOptions = Array.isArray(employeeOptionsQuery.data) ? employeeOptionsQuery.data : [];

  const downloadTemplate = async () => { const response: any = await api.get('/assets/import/template.xlsx', { responseType: 'blob' }); const blob = response instanceof Blob ? response : response.data; const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'apex-asset-import-template.xlsx'; a.click(); URL.revokeObjectURL(url); };
  const chooseImportFile = (file?: File) => {
    setSelectedFile(file ?? null);
    setImportAnalysis(null);
    setImportError('');
    if (file) analyzeImport.mutate(file);
  };
  const closeImport = () => {
    setImportOpen(false);
    setSelectedFile(null);
    setImportAnalysis(null);
    setImportError('');
    if (fileRef.current) fileRef.current.value = '';
  };
  const exportCsv = () => {
    const source: Record<Tab, any[]> = { registry: data.assets, allocations: data.allocations, requests: data.requests, rentals: data.rentals, mobile: data.mobile, repairs: data.repairs, activity: [...data.imports.map(x => ({ ...x, recordKind: 'IMPORT' })), ...data.audit.map(x => ({ ...x, recordKind: 'AUDIT' }))] };
    const rows = source[tab]; if (!rows.length) return toast.error('There is no data to export.'); const keys = Array.from(new Set(rows.flatMap(row => Object.keys(row)))).filter(k => rows.some(row => typeof row[k] !== 'object'));
    const csv = [keys.join(','), ...rows.map(row => keys.map(k => `"${String(row[k] ?? '').replaceAll('"', '""')}"`).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = `apex-${tab}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const rowsForTab = useMemo(() => ({ registry: data.assets, allocations: data.allocations, requests: data.requests, rentals: data.rentals, mobile: data.mobile, repairs: data.repairs, activity: [...data.imports, ...data.audit] })[tab], [data, tab]);

  if (!hasHydrated) return <div className="p-8 text-[var(--text-secondary)]">Loading…</div>;
  if (!allowed) return <div className="mx-auto mt-20 max-w-lg rounded-2xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-900 dark:bg-red-950/40"><Package className="mx-auto mb-3 h-9 w-9 text-red-600 dark:text-red-400" /><h1 className="text-xl font-bold text-red-900 dark:text-red-200">Admin access required</h1><p className="mt-2 text-sm text-red-700 dark:text-red-300">Inventory Management is available only to ADMIN and SUPER_ADMIN accounts.</p></div>;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const raw = Object.fromEntries(new FormData(event.currentTarget)); const mode = form!.mode;
    if (mode === 'asset') {
      if (raw.assetTypeId === '__OTHER__') {
        raw.assetTypeName = raw.customAssetType;
        delete raw.assetTypeId;
      }
      delete raw.customAssetType;
      save.mutate({ url: '/assets/registry', body: raw });
    }
    if (mode === 'allocation') {
      const employee = employeeOptions.find(option => option.id === raw.employeeId);
      save.mutate({ url: '/assets/allocations', body: { ...raw, employeeName: employee?.name, assetId: form?.row?.id } });
    }
    if (mode === 'return') save.mutate({ url: `/assets/allocations/${form?.row?.id}/return`, body: { ...raw, needsRepair: raw.needsRepair === 'on' } });
    if (mode === 'repair') save.mutate({ url: '/assets/repairs', body: { ...raw, assetId: form?.row?.id } });
    if (mode === 'recharge') save.mutate({ url: `/assets/mobile/${form?.row?.id}/recharges`, body: raw });
  };

  return <div className="inventory-management mx-auto max-w-[1600px] space-y-3 px-4 pb-4 pt-0 text-[var(--text-primary)] sm:px-6 sm:pb-6 lg:px-8 lg:pb-8">
    <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><h1 className="text-2xl font-bold text-[var(--text-primary)] sm:text-3xl">Inventory Management</h1><details ref={quickActionsRef} className="group relative self-start sm:self-auto"><summary className="apex-btn apex-btn-primary flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold marker:content-none"><Plus className="h-4 w-4" /> Quick actions <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary><div className="absolute right-0 z-40 mt-2 w-52 overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--surface-card)] p-1.5 shadow-xl"><button type="button" onClick={() => { quickActionsRef.current?.removeAttribute('open'); setTab('registry'); setCustomAssetType(false); setForm({ mode: 'asset' }); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"><Package className="h-4 w-4 text-blue-600" /> Register asset</button><button type="button" onClick={() => { quickActionsRef.current?.removeAttribute('open'); setImportOpen(true); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"><Upload className="h-4 w-4 text-blue-600" /> Import workbook</button><button type="button" onClick={() => { quickActionsRef.current?.removeAttribute('open'); exportCsv(); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"><Download className="h-4 w-4 text-blue-600" /> Export</button></div></details></header>
    <div className="!mt-6 overflow-x-auto border-b border-[var(--border-primary)]"><nav className="flex min-w-max gap-1">{tabs.map(t => <button key={t.id} onMouseEnter={() => { void qc.prefetchQuery({ queryKey: ['asset-management', t.id], queryFn: () => loadAssetSection(t.id), staleTime: 30_000 }); }} onClick={() => setTab(t.id)} className={`border-b-2 px-3 py-2 text-sm font-semibold ${tab === t.id ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>{t.label}</button>)}</nav></div>
    <section className="!mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <label className="relative block min-w-[240px] flex-1 xl:max-w-sm"><span className="sr-only">Search inventory records</span><Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${tabs.find(t => t.id === tab)?.label.toLowerCase()}…`} className="apex-input w-full rounded-xl py-2 pr-3 text-sm" style={{ paddingLeft: '2.5rem' }} /></label>
        {tab === 'registry' && <>
          <label><span className="sr-only">Filter by employee name</span><select aria-label="Filter by employee name" value={registryFilters.name} onChange={e => setRegistryFilters(current => ({ ...current, name: e.target.value }))} className="apex-input min-w-[165px] rounded-xl px-3 py-2 text-sm"><option value="">All employees</option>{registryFilterOptions.names.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
          <label><span className="sr-only">Filter by ownership</span><select aria-label="Filter by ownership" value={registryFilters.ownership} onChange={e => setRegistryFilters(current => ({ ...current, ownership: e.target.value }))} className="apex-input min-w-[145px] rounded-xl px-3 py-2 text-sm"><option value="">Owned or rented</option>{registryFilterOptions.ownerships.map(ownership => <option key={ownership} value={ownership}>{ownership}</option>)}</select></label>
          <label><span className="sr-only">Filter by asset type</span><select aria-label="Filter by asset type" value={registryFilters.type} onChange={e => setRegistryFilters(current => ({ ...current, type: e.target.value }))} className="apex-input min-w-[145px] rounded-xl px-3 py-2 text-sm"><option value="">All asset types</option>{registryFilterOptions.types.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
          <label><span className="sr-only">Filter by asset status</span><select aria-label="Filter by asset status" value={registryFilters.status} onChange={e => setRegistryFilters(current => ({ ...current, status: e.target.value }))} className="apex-input min-w-[135px] rounded-xl px-3 py-2 text-sm"><option value="">All statuses</option>{registryFilterOptions.statuses.map(status => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label>
          {registryFiltersActive && <button type="button" onClick={clearRegistryFilters} className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-semibold text-[var(--accent)] hover:bg-[var(--bg-tertiary)]"><X className="h-4 w-4" /> Clear</button>}
        </>}
      </div>
    </section>
    <div className="!mt-5">{dataQuery.isLoading ? <div className="h-80 animate-pulse rounded-2xl bg-[var(--bg-secondary)]" /> : rowsForTab.length === 0 ? <Empty label={tabs.find(t => t.id === tab)!.label.toLowerCase()} onImport={tab === 'requests' ? undefined : () => setImportOpen(true)} description={tab === 'requests' ? 'Employee asset request, return, replacement, repair and damage tickets will appear here as soon as they are raised.' : undefined} /> : <>
      {tab === 'registry' && <Table rows={filteredAssets} columns={[{ key: 'assetCode', label: 'Asset ID' }, { key: 'assetType', label: 'Type', render: x => x.assetType?.name ?? '—' }, { key: 'brandModel', label: 'Brand / Model' }, { key: 'specification', label: 'Specification' }, { key: 'modelNumber', label: 'Model No.' }, { key: 'ownership', label: 'Owned / Rent' }, { key: 'vendorName', label: 'Vendor' }, { key: 'acquisitionDate', label: 'Purchase / Intake', render: x => formatDate(x.acquisitionDate) }, { key: 'issuedOn', label: 'Issued On', render: x => formatDate(x.allocations?.[0]?.fromDate) }, { key: 'vendorReturnDate', label: 'Vendor Return', render: x => formatDate(x.vendorReturnDate) }, { key: 'purchaseCost', label: 'Purchase Cost', render: x => formatMoney(x.purchaseCost) }, { key: 'monthlyRent', label: 'Monthly Rent', render: x => formatMoney(x.monthlyRent) }, { key: 'status', label: 'Status', render: x => <Status value={x.status} /> }, { key: 'employee', label: 'Current Employee', render: x => x.allocations?.[0]?.employeeName ?? '—' }]} actions={x => <div className="flex gap-2">{x.status !== 'ALLOCATED' && <button onClick={() => setForm({ mode: 'allocation', row: x })} className="font-semibold text-blue-700">Assign</button>}<button onClick={() => setForm({ mode: 'repair', row: x })} className="font-semibold text-amber-700">Repair</button></div>} />}
      {tab === 'allocations' && <Table rows={filtered(data.allocations)} columns={[{ key: 'asset', label: 'Asset ID', render: x => x.asset?.assetCode }, { key: 'employeeName', label: 'Employee' }, { key: 'branch', label: 'Branch' }, { key: 'fromDate', label: 'From', render: x => formatDate(x.fromDate) }, { key: 'toDate', label: 'To', render: x => formatDate(x.toDate) }, { key: 'returned', label: 'Returned', render: x => x.returned ? 'Yes' : 'No' }, { key: 'conditionAtIssue', label: 'Condition' }, { key: 'hodManagerName', label: 'HOD / Manager' }, { key: 'workflowStatus', label: 'Workflow', render: x => <Status value={x.workflowStatus} /> }]} actions={x => !x.returned && <button onClick={() => setForm({ mode: 'return', row: x })} className="inline-flex items-center gap-1 font-semibold text-blue-700"><RotateCcw className="h-4 w-4" /> Return</button>} />}
      {tab === 'requests' && <Table rows={filtered(data.requests)} columns={[{ key: 'requestCode', label: 'Ticket ID' }, { key: 'requestType', label: 'Request Type', render: x => requestTypeLabel(x.requestType) }, { key: 'employeeName', label: 'Raised By' }, { key: 'department', label: 'Department' }, { key: 'requestedItems', label: 'Asset(s)', render: requestedItemsLabel }, { key: 'reason', label: 'Request / Issue' }, { key: 'priority', label: 'Priority' }, { key: 'status', label: 'Status', render: x => <Status value={x.status} /> }, { key: 'createdAt', label: 'Raised On', render: x => formatDate(x.createdAt) }]} actions={x => x.status === 'SUBMITTED' && <div className="flex gap-2"><button onClick={() => save.mutate({ url: `/assets/requests/${x.id}`, patch: true, body: { status: 'APPROVED', adminOwner: user?.name } })} className="font-semibold text-emerald-700">Approve</button><button onClick={() => save.mutate({ url: `/assets/requests/${x.id}`, patch: true, body: { status: 'REJECTED', adminOwner: user?.name } })} className="font-semibold text-red-700">Reject</button></div>} />}
      {tab === 'rentals' && <Table rows={filtered(data.rentals)} columns={[{ key: 'periodMonth', label: 'Month', render: x => formatDate(x.periodMonth) }, { key: 'asset', label: 'Asset ID', render: x => x.asset?.assetCode }, { key: 'assetDetails', label: 'Specific Asset', render: x => x.asset ? `${x.asset.brandModel}${x.asset.modelNumber ? ` · ${x.asset.modelNumber}` : ''}` : '—' }, { key: 'ownership', label: 'Ownership', render: x => x.asset?.ownership ?? '—' }, { key: 'vendorName', label: 'Vendor' }, { key: 'employeeName', label: 'Employee' }, { key: 'branch', label: 'Branch' }, { key: 'monthlyRent', label: 'Monthly Rent', render: x => formatMoney(x.monthlyRent) }, { key: 'approvedBy', label: 'Approved By' }, { key: 'paid', label: 'Paid', render: x => x.paid ? <Status value="PAID" /> : <Status value="UNPAID" /> }]} actions={x => !x.paid && <button onClick={() => save.mutate({ url: `/assets/rentals/${x.id}`, patch: true, body: { paid: true, approvedBy: x.approvedBy || user?.name } })} className="font-semibold text-emerald-700">Mark paid</button>} />}
      {tab === 'mobile' && <Table rows={filtered(data.mobile)} columns={[{ key: 'employeeName', label: 'Employee' }, { key: 'branch', label: 'Branch' }, { key: 'model', label: 'Model' }, { key: 'simProvider', label: 'SIM Provider' }, { key: 'phoneNumber', label: 'Assigned Number' }, { key: 'plan', label: 'Plan' }, { key: 'amount', label: 'Amount', render: x => formatMoney(x.amount) }, { key: 'lastRechargeDate', label: 'Last Recharge', render: x => formatDate(x.lastRechargeDate) }, { key: 'dueDate', label: 'Due Date', render: x => formatDate(x.dueDate) }, { key: 'status', label: 'Status', render: x => <Status value={x.status} /> }]} actions={x => <div className="flex gap-2"><button onClick={() => setForm({ mode: 'recharge', row: x })} className="font-semibold text-blue-700">Recharge</button><button onClick={() => save.mutate({ url: `/assets/mobile/${x.id}`, patch: true, body: { status: x.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' } })} className="font-semibold text-slate-700">{x.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}</button></div>} />}
      {tab === 'repairs' && <Table rows={filtered(data.repairs)} columns={[{ key: 'asset', label: 'Asset ID', render: x => x.asset?.assetCode ?? 'Unmatched' }, { key: 'brand', label: 'Company / Brand' }, { key: 'specification', label: 'Specification' }, { key: 'issues', label: 'Issues' }, { key: 'repairingDate', label: 'Repair Date', render: x => formatDate(x.repairingDate) }, { key: 'repairVendor', label: 'Vendor' }, { key: 'finalCost', label: 'Cost', render: x => formatMoney(x.finalCost ?? x.estimatedCost) }, { key: 'status', label: 'Status', render: x => <Status value={x.status} /> }]} actions={x => x.status !== 'COMPLETED' && <button onClick={() => save.mutate({ url: `/assets/repairs/${x.id}`, patch: true, body: { status: 'COMPLETED', completedDate: new Date().toISOString() } })} className="font-semibold text-emerald-700">Complete</button>} />}
      {tab === 'activity' && <div className="space-y-6">
        {data.imports.length > 0 && <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-base font-bold">Workbook Imports</h2><span className="text-xs text-[var(--text-secondary)]">{data.imports.length} imports</span></div><Table rows={filtered(data.imports)} columns={[{ key: 'fileName', label: 'Workbook' }, { key: 'importedByName', label: 'Imported By' }, { key: 'sheets', label: 'Sheets', render: x => Array.isArray(x.sheets) ? x.sheets.map((s: any) => s.name).join(', ') : '—' }, { key: 'summary', label: 'Records', render: x => Object.values(x.summary ?? {}).reduce((a: number, b: any) => a + Number(b), 0) }, { key: 'createdAt', label: 'Imported', render: x => formatDate(x.createdAt) }]} /></section>}
        {data.audit.length > 0 && <section className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-base font-bold">Inventory Activity</h2><span className="text-xs text-[var(--text-secondary)]">{data.audit.length} events</span></div><Table rows={filtered(data.audit)} columns={[{ key: 'createdAt', label: 'When', render: x => formatDate(x.createdAt) }, { key: 'actorName', label: 'Actor' }, { key: 'entityType', label: 'Area' }, { key: 'action', label: 'Action' }, { key: 'entityId', label: 'Record ID' }]} /></section>}
      </div>}
    </>}</div>

    {importOpen && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-[3px] sm:p-6">
      <div role="dialog" aria-modal="true" aria-labelledby="inventory-import-title" className="inventory-modal my-auto max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-3xl border border-[var(--border-primary)] bg-[var(--surface-card)] text-[var(--text-primary)] shadow-[0_28px_90px_rgba(2,6,23,0.45)]">
        <div className="flex items-start justify-between border-b border-[var(--border-subtle)] px-6 py-5 sm:px-7">
          <div className="flex gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"><Upload className="h-5 w-5" /></span><div><h2 id="inventory-import-title" className="text-xl font-bold">Import inventory workbook</h2><p className="mt-1 max-w-lg text-sm leading-5 text-[var(--text-secondary)]">Apex OS analyzes the workbook first, maps recognized inventory sheets, and imports everything together.</p></div></div>
          <button aria-label="Close import dialog" className="rounded-xl p-2 text-[var(--text-secondary)] transition hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]" onClick={closeImport}><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 px-6 py-5 sm:px-7">
          <div className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-secondary)]"><span className="font-semibold text-[var(--text-primary)]">Automatic mapping:</span> Asset registry, allocations, laptops, rentals, mobile recharges, asset lists and repairs. Extra title rows, totals and merged headings are ignored.</div>

          <label className={`group flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed p-5 transition ${selectedFile ? 'border-blue-300 bg-blue-50/70 dark:border-blue-800 dark:bg-blue-950/25' : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:border-[var(--accent)]'}`}>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-emerald-600 shadow-sm dark:bg-slate-900"><FileSpreadsheet className="h-7 w-7" /></span>
            <span className="min-w-0 flex-1 text-left">{selectedFile ? <><span className="block truncate font-semibold text-[var(--text-primary)]">{selectedFile.name}</span><span className="mt-0.5 block text-xs text-[var(--text-secondary)]">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB · Click to choose a different workbook</span></> : <><span className="block font-semibold">Choose an Excel workbook</span><span className="mt-0.5 block text-xs text-[var(--text-secondary)]">.xlsx · Maximum 20 MB · Stored only in the configured local database</span></>}</span>
            <span className="apex-btn apex-btn-secondary shrink-0 rounded-xl px-3 py-2 text-xs font-semibold">Browse</span>
            <input ref={fileRef} type="file" accept=".xlsx" className="sr-only" onChange={event => chooseImportFile(event.target.files?.[0])} />
          </label>

          {analyzeImport.isPending && <div className="flex items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"><span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />Analyzing sheets, headers and records…</div>}
          {importAnalysis?.canImport && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-950/35"><div className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200"><CheckCircle2 className="h-4 w-4" />Ready to import</div><div className="mt-2 grid gap-1 sm:grid-cols-2">{importAnalysis.sheets.map(sheet => <div key={`${sheet.name}-${sheet.category}`} className="flex items-center justify-between gap-3 rounded-lg bg-white/70 px-2.5 py-1.5 text-xs text-emerald-950 dark:bg-slate-950/25 dark:text-emerald-100"><span className="truncate">{sheet.name}</span><b>{sheet.rows} rows</b></div>)}</div></div>}
          {importError && <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/35 dark:text-red-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div><b>Import needs attention</b><p className="mt-0.5 leading-5">{importError}</p></div></div>}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-[var(--border-subtle)] px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <button onClick={downloadTemplate} className="apex-btn apex-btn-secondary inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"><Download className="h-4 w-4" /> Download template</button>
          <div className="flex justify-end gap-2"><button onClick={closeImport} className="apex-btn apex-btn-secondary rounded-xl px-4 py-2.5 text-sm font-semibold">Cancel</button><button disabled={!selectedFile || !importAnalysis?.canImport || analyzeImport.isPending || upload.isPending} onClick={() => selectedFile && upload.mutate(selectedFile)} className="apex-btn apex-btn-primary min-w-32 rounded-xl px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">{upload.isPending ? 'Importing…' : 'Import data'}</button></div>
        </div>
      </div>
    </div>}

    {form && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4"><form onSubmit={submit} className="inventory-modal my-6 w-full max-w-2xl rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-card)] p-6 text-[var(--text-primary)] shadow-2xl"><div className="mb-5 flex justify-between"><div><h2 className="text-xl font-bold">{{ asset: 'Register asset', allocation: `Assign ${form.row?.assetCode}`, return: `Return ${form.row?.asset?.assetCode}`, repair: `Record repair for ${form.row?.assetCode}`, recharge: `Record recharge for ${form.row?.phoneNumber}` }[form.mode]}</h2></div><button className="rounded-lg p-1 hover:bg-[var(--bg-tertiary)]" type="button" onClick={() => setForm(null)}><X /></button></div><div className="grid gap-4 sm:grid-cols-2">
      {form.mode === 'asset' && <><Field name="assetCode" label="Asset ID" required /><Field name="brandModel" label="Brand / Model" required /><Field name="assetTypeId" label="Asset Type" required><select name="assetTypeId" required onChange={event => setCustomAssetType(event.target.value === '__OTHER__')} className="apex-input rounded-xl px-3 py-2.5"><option value="">Select asset type</option>{data.types.filter(x => x.isActive).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}<option value="__OTHER__">OTHER — ADD NEW TYPE</option></select></Field>{customAssetType && <Field name="customAssetType" label="New Asset Type" required><input name="customAssetType" required autoFocus placeholder="Enter the new asset type" className="apex-input rounded-xl px-3 py-2.5 uppercase" /></Field>}<Field name="ownership" label="Owned / Rent" required><select name="ownership" required className="apex-input rounded-xl px-3 py-2.5"><option value="OWNED">Owned</option><option value="RENTED">Rented</option></select></Field><Field name="specification" label="Specification" /><Field name="modelNumber" label="Model Number" /><Field name="vendorName" label="Vendor Name" /><Field name="acquisitionDate" label="Purchase / Issue Date" type="date" /><Field name="vendorReturnDate" label="Vendor Return Date" type="date" /><Field name="purchaseCost" label="Purchase Cost" type="number" /><Field name="monthlyRent" label="Monthly Rent" type="number" /><Field name="chargerIncluded" label="Charger (Yes / No)"><select name="chargerIncluded" className="apex-input rounded-xl px-3 py-2.5"><option value="false">No</option><option value="true">Yes</option></select></Field></>}
      {form.mode === 'allocation' && <><Field name="employeeId" label="Employee" required><select name="employeeId" required className="apex-input rounded-xl px-3 py-2.5"><option value="">Select employee</option>{employeeOptions.map(employee => <option key={employee.id} value={employee.id}>{employee.name}{employee.employeeId ? ` · ${employee.employeeId}` : ''}</option>)}</select></Field><Field name="branch" label="Branch" /><Field name="fromDate" label="From Date" type="date" required /><Field name="conditionAtIssue" label="Condition at Issue" /><Field name="hodManagerName" label="HOD / Manager" /><Field name="remarks" label="Remarks" /></>}
      {form.mode === 'return' && <><Field name="toDate" label="Return Date" type="date" required /><Field name="conditionAtReturn" label="Condition at Return" /><Field name="repairingCost" label="Repairing Cost" type="number" /><Field name="repairingDate" label="Repairing Date" type="date" /><label className="flex items-center gap-2 text-sm"><input name="needsRepair" type="checkbox" /> Send asset for repair</label><Field name="remarks" label="Remarks" /></>}
      {form.mode === 'repair' && <><input type="hidden" name="brand" value={form.row?.brandModel ?? ''} /><Field name="issues" label="Issues" required /><Field name="specification" label="Specification"><input name="specification" defaultValue={form.row?.specification ?? ''} className="rounded-xl border px-3 py-2.5" /></Field><Field name="reportedDate" label="Reported Date" type="date" /><Field name="repairingDate" label="Repairing Date" type="date" /><Field name="repairVendor" label="Repair Vendor" /><Field name="estimatedCost" label="Estimated Cost" type="number" /></>}
      {form.mode === 'recharge' && <><Field name="billingMonth" label="Billing Month" type="month" required /><Field name="rechargeDate" label="Recharge Date" type="date" required /><Field name="dueDate" label="Next Due Date" type="date" /><Field name="plan" label="Plan"><input name="plan" defaultValue={form.row?.plan ?? ''} className="rounded-xl border px-3 py-2.5" /></Field><Field name="amount" label="Amount" type="number" required /></>}
    </div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setForm(null)} className="apex-btn apex-btn-secondary rounded-xl px-4 py-2 text-sm font-semibold">Cancel</button><button disabled={save.isPending} className="apex-btn apex-btn-primary inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-semibold disabled:opacity-50">Save <ChevronRight className="h-4 w-4" /></button></div></form></div>}
  </div>;
}
