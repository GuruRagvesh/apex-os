'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@apex/shared-auth';
import { UserAvatar } from '@apex/shared-ui/components/user-avatar';
import toast from 'react-hot-toast';
import {
  AlertTriangle, Building2, Check, ChevronDown, ChevronRight, GitBranch, LayoutList, Link2, Network,
  PencilLine, RotateCcw, Save, Search, ShieldCheck, UsersRound, X,
} from 'lucide-react';

type RelationRole = 'TEAM_LEAD' | 'MANAGER';
type HierarchyNode = {
  id: string;
  employeeId?: string | null;
  name: string;
  email: string;
  avatar?: string | null;
  photoUrl?: string | null;
  designation?: string | null;
  departmentId?: string | null;
  department?: { id: string; name: string; color: string } | null;
  organizationParticipation?: 'WORKFORCE' | 'ACCESS_ONLY' | string;
  departmentMemberships?: Array<{
    id: string; departmentId: string; isPrimary: boolean; designation?: string | null;
    isDepartmentLead: boolean; allocationPercent?: number | null;
    department: { id: string; name: string; color: string };
  }>;
  role: { id: string; name: string; level: number };
  directReportCount: number;
};
type HierarchyEdge = {
  id: string;
  subjectUserId: string;
  assigneeUserId: string;
  role: RelationRole;
  source: 'HIERARCHY' | 'LEGACY' | 'DRAFT' | 'ORGANIZATION';
  effectiveFrom?: string | null;
  departmentId?: string | null;
  scopeKey?: string;
};
type HierarchyData = {
  nodes: HierarchyNode[];
  edges: HierarchyEdge[];
  departments: Array<{ id: string; name: string; color: string; peopleCount: number }>;
  issues: Array<{ code: string; userId: string; message: string }>;
  stats: { people: number; departments: number; connections: number; setupIssues: number };
  permissions: { canEdit: boolean };
};
type DirectoryPage = { items: HierarchyNode[]; page: { limit: number; total: number; nextCursor: string | null } };
type DraftOperation =
  | { type: 'UPSERT'; subjectUserId: string; assigneeUserId: string; role: RelationRole }
  | { type: 'END'; subjectUserId: string; role: RelationRole };

const HIERARCHY_REQUEST_TIMEOUT_MS = 12_000;

const hierarchyApi = {
  getMap: () => unwrap<HierarchyData>(api.get('/organization-hierarchy/organization', { timeout: HIERARCHY_REQUEST_TIMEOUT_MS })),
  getDirectory: (params: { q?: string; limit?: number }) => unwrap<DirectoryPage>(api.get('/organization-hierarchy/organization/directory', { params, timeout: HIERARCHY_REQUEST_TIMEOUT_MS })),
  apply: (operations: DraftOperation[]) => unwrap<{ applied: number; map: HierarchyData }>(api.post('/organization-hierarchy/organization', { operations }, { timeout: HIERARCHY_REQUEST_TIMEOUT_MS })),
};

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin', MANAGER: 'Manager', TEAM_LEAD: 'Team Lead', EMPLOYEE: 'Employee', INTERN: 'Intern',
};
const ROLE_TINT: Record<string, string> = {
  SUPER_ADMIN: '#7c3aed', ADMIN: '#4f46e5', MANAGER: '#2563eb', TEAM_LEAD: '#0891b2', EMPLOYEE: '#059669', INTERN: '#d97706',
};

function organizationStage(node: HierarchyNode) {
  const title = personTitle(node).toLowerCase();
  if (/chief executive|\bceo\b|chief financial|\bcfo\b|chief of staff/.test(title)) return 'EXECUTIVE';
  if (node.role.name === 'MANAGER') return 'MANAGEMENT';
  if (node.role.name === 'TEAM_LEAD') return 'TEAM_LEADERSHIP';
  return 'TEAM';
}

function operationKey(operation: Pick<DraftOperation, 'subjectUserId' | 'role'>) {
  return operation.subjectUserId;
}

function applyDraft(edges: HierarchyEdge[], operations: DraftOperation[]): HierarchyEdge[] {
  const draftByKey = new Map(operations.map((operation) => [operationKey(operation), operation]));
  const retained = edges.filter((edge) => (edge.scopeKey ?? 'PRIMARY') !== 'PRIMARY' || !draftByKey.has(edge.subjectUserId));
  const additions = operations.flatMap((operation): HierarchyEdge[] => operation.type === 'UPSERT' ? [{
    id: `draft:${operation.role}:${operation.subjectUserId}`,
    subjectUserId: operation.subjectUserId,
    assigneeUserId: operation.assigneeUserId,
    role: operation.role,
    source: 'DRAFT',
    scopeKey: 'PRIMARY',
  }] : []);
  return [...retained, ...additions];
}

function personTitle(node: HierarchyNode) {
  return node.designation?.trim() || ROLE_LABEL[node.role.name] || node.role.name.replaceAll('_', ' ');
}

function departmentFor(node: HierarchyNode, departmentId?: string | null) {
  if (!departmentId || node.departmentId === departmentId) return node.department ?? null;
  return node.departmentMemberships?.find((membership) => membership.departmentId === departmentId)?.department ?? null;
}

function hierarchyErrorCopy(error: unknown) {
  const requestError = error as { code?: string; message?: string; response?: { status?: number } } | undefined;
  const status = requestError?.response?.status;
  if (status === 401) return { title: 'Your session has expired', description: 'Sign in again, then reopen the organization hierarchy.' };
  if (status === 404) return { title: 'Hierarchy update is not deployed', description: 'This workspace needs the current backend release. Try again after the release has completed.' };
  if (status && status >= 500) return { title: 'Organization map is temporarily unavailable', description: 'The service is available but could not load the organization data. Try again in a moment.' };
  if (requestError?.code === 'ECONNABORTED' || /timeout/i.test(requestError?.message ?? '')) return { title: 'Organization map is taking too long to load', description: 'Check the API connection, then try again. The page will not keep loading indefinitely.' };
  return { title: 'Organization map is unavailable', description: 'The hierarchy service could not be reached. Check the connection and try again.' };
}

export function OrganizationHierarchySection() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [roleName, setRoleName] = useState('');
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState('');
  const [personSearch, setPersonSearch] = useState('');
  const [supervisorSearch, setSupervisorSearch] = useState('');
  const relation: RelationRole = 'MANAGER';
  const [assigneeId, setAssigneeId] = useState('');
  const [draft, setDraft] = useState<DraftOperation[]>([]);

  const hierarchy = useQuery({
    queryKey: ['organization-hierarchy'],
    queryFn: hierarchyApi.getMap,
    staleTime: 30_000,
    retry: 1,
    retryDelay: 750,
  });
  const subjectDirectory = useQuery({
    queryKey: ['organization-hierarchy-directory', 'subject', personSearch],
    queryFn: () => hierarchyApi.getDirectory({ q: personSearch || undefined, limit: 50 }),
    enabled: editing,
    staleTime: 30_000,
  });
  const supervisorDirectory = useQuery({
    queryKey: ['organization-hierarchy-directory', 'supervisor', supervisorSearch],
    queryFn: () => hierarchyApi.getDirectory({ q: supervisorSearch || undefined, limit: 50 }),
    enabled: editing && Boolean(subjectId),
    staleTime: 30_000,
  });
  const publish = useMutation({
    mutationFn: () => hierarchyApi.apply(draft),
    onSuccess: (result) => {
      queryClient.setQueryData(['organization-hierarchy'], result.map);
      setDraft([]);
      setEditing(false);
      toast.success(`${result.applied} hierarchy ${result.applied === 1 ? 'change' : 'changes'} published`);
    },
    onError: (error: any) => toast.error(error?.message ?? 'Could not publish hierarchy changes'),
  });

  const data = hierarchy.data;
  const previewEdges = useMemo(() => applyDraft(data?.edges ?? [], draft), [data?.edges, draft]);
  const visibleNodes = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.nodes ?? []).filter((node) => {
      if (departmentId && node.departmentId !== departmentId && !node.departmentMemberships?.some((membership) => membership.departmentId === departmentId)) return false;
      if (roleName && node.role.name !== roleName) return false;
      if (!term) return true;
      return [node.name, node.email, node.employeeId, node.designation, node.department?.name, ROLE_LABEL[node.role.name], ...(node.departmentMemberships?.flatMap((membership) => [membership.department.name, membership.designation]) ?? [])]
        .some((value) => value?.toLowerCase().includes(term));
    });
  }, [data?.nodes, departmentId, roleName, search]);

  const subject = data?.nodes.find((node) => node.id === subjectId) ?? null;
  const subjectPrimaryEdge = subject
    ? previewEdges.find((edge) => edge.subjectUserId === subject.id && (edge.scopeKey ?? 'PRIMARY') === 'PRIMARY')
    : null;
  const candidates = useMemo(() => (supervisorDirectory.data?.items ?? []).filter((node) => node.id !== subject?.id), [subject?.id, supervisorDirectory.data?.items]);
  const selectablePeople = subjectDirectory.data?.items ?? [];

  const stage = (operation: DraftOperation) => {
    setDraft((current) => [...current.filter((item) => operationKey(item) !== operationKey(operation)), operation]);
  };
  const startFor = (node: HierarchyNode) => {
    setSelectedId((current) => current === node.id && !editing ? null : node.id);
    if (editing) {
      setSubjectId(node.id);
      setAssigneeId('');
    }
  };
  const cancelEditing = () => {
    setDraft([]);
    setEditing(false);
    setSubjectId('');
    setAssigneeId('');
  };
  if (hierarchy.isLoading) return <HierarchySkeleton />;
  if (hierarchy.isError || !data) { const errorCopy = hierarchyErrorCopy(hierarchy.error); return <div className="apex-card p-8 text-center"><AlertTriangle className="mx-auto mb-3 text-amber-500" /><h2 className="font-semibold text-[var(--text-primary)]">{errorCopy.title}</h2><p className="mx-auto mt-1 max-w-md text-sm text-[var(--text-secondary)]">{errorCopy.description}</p><button type="button" onClick={() => hierarchy.refetch()} disabled={hierarchy.isFetching} className="apex-btn apex-btn-secondary mt-4 disabled:opacity-60">{hierarchy.isFetching ? 'Retrying…' : 'Try again'}</button></div>; }

  return <section className="space-y-5">
    <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div>
        <div className="flex items-center gap-2"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Network size={21} /></span><div><h2 className="text-xl font-semibold text-[var(--text-primary)]">Organization hierarchy</h2><p className="text-sm text-[var(--text-secondary)]">See how departments, roles and reporting authority connect across the company.</p></div></div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {editing ? <>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">{draft.length} unpublished</span>
          <button type="button" onClick={cancelEditing} disabled={publish.isPending} className="apex-btn apex-btn-secondary inline-flex items-center gap-2 text-sm"><X size={15} /> Cancel</button>
          <button type="button" onClick={() => publish.mutate()} disabled={!draft.length || publish.isPending} className="apex-btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50"><Save size={15} />{publish.isPending ? 'Publishing…' : 'Review & publish'}</button>
        </> : <button type="button" onClick={() => setEditing(true)} className="apex-btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm"><PencilLine size={15} /> Edit structure</button>}
      </div>
    </header>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Stat icon={<UsersRound size={17} />} label="Active people" value={data.stats.people} tint="#2563eb" />
      <Stat icon={<Building2 size={17} />} label="Departments" value={data.stats.departments} tint="#7c3aed" />
      <Stat icon={<GitBranch size={17} />} label="Reporting lines" value={previewEdges.length} tint="#059669" />
      <Stat icon={data.stats.setupIssues ? <AlertTriangle size={17} /> : <ShieldCheck size={17} />} label="Setup issues" value={data.stats.setupIssues} tint={data.stats.setupIssues ? '#d97706' : '#0891b2'} />
    </div>

    {editing && <div className="apex-card border-amber-200 p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
        <div className="min-w-0 flex-1"><label className="apex-label">Person</label><input value={personSearch} onChange={(event) => setPersonSearch(event.target.value)} placeholder="Search name, designation or ID" className="apex-input mt-1 w-full" /><select className="apex-input mt-2 w-full" value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setSelectedId(event.target.value || null); setAssigneeId(''); }}><option value="">{subjectDirectory.isFetching ? 'Searching people…' : `Select a person (${subjectDirectory.data?.page.total ?? 0} matches)`}</option>{subject && !selectablePeople.some((node) => node.id === subject.id) && <option value={subject.id}>{subject.name} · {personTitle(subject)}</option>}{selectablePeople.map((node) => <option key={node.id} value={node.id}>{node.name} · {personTitle(node)}</option>)}</select></div>
        <div className="xl:w-44"><label className="apex-label">Connection</label><div className="apex-input mt-1 flex h-10 items-center text-sm text-[var(--text-secondary)]">Business reporting</div></div>
        <div className="min-w-0 flex-1"><label className="apex-label">Reports to</label><input value={supervisorSearch} disabled={!subject} onChange={(event) => setSupervisorSearch(event.target.value)} placeholder="Search an eligible supervisor" className="apex-input mt-1 w-full disabled:opacity-50" /><select className="apex-input mt-2 w-full" value={assigneeId} disabled={!subject} onChange={(event) => setAssigneeId(event.target.value)}><option value="">{supervisorDirectory.isFetching ? 'Searching supervisors…' : `Select supervisor (${supervisorDirectory.data?.page.total ?? 0} matches)`}</option>{candidates.map((node) => <option key={node.id} value={node.id}>{node.name} · {personTitle(node)} · {node.department?.name ?? 'No department'}</option>)}</select></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!subjectId || !assigneeId} onClick={() => { stage({ type: 'UPSERT', subjectUserId: subjectId, assigneeUserId: assigneeId, role: relation }); setAssigneeId(''); }} className="apex-btn-primary inline-flex h-10 items-center justify-center gap-2 px-4 text-sm disabled:opacity-50"><Link2 size={15} /> Stage connection</button>
          {subjectPrimaryEdge && <button type="button" onClick={() => stage({ type: 'END', subjectUserId: subjectId, role: relation })} className="apex-btn apex-btn-secondary inline-flex h-10 items-center justify-center px-4 text-sm text-rose-600">Remove line</button>}
        </div>
      </div>
      <p className="mt-3 flex items-start gap-2 text-xs text-[var(--text-secondary)]"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-600" />Business reporting lines are separate from approval routes and access roles. A person’s RBAC role, designation and department are never changed here. All published changes are validated and audited.</p>
    </div>}

    <div className="apex-card overflow-visible">
      <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] p-3 lg:flex-row lg:items-center">
        <div className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-xs font-semibold text-[var(--accent)]"><Network size={14} /> Full people network</div>
        <label className="relative min-w-0 flex-1"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" /><input aria-label="Search organization" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a person, designation or employee ID…" className="apex-input w-full pl-9" /></label>
        <select aria-label="Filter department" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className="apex-input lg:w-52"><option value="">All departments</option>{data.departments.map((department) => <option key={department.id} value={department.id}>{department.name} ({department.peopleCount})</option>)}</select>
        <select aria-label="Filter role" value={roleName} onChange={(event) => setRoleName(event.target.value)} className="apex-input lg:w-44"><option value="">All roles</option>{Array.from(new Set(data.nodes.map((node) => node.role.name))).map((role) => <option key={role} value={role}>{ROLE_LABEL[role] ?? role}</option>)}</select>
      </div>

      <OfficeMindMap nodes={visibleNodes} directory={data.nodes} edges={previewEdges} selectedId={selectedId} onSelect={startFor} onClearFilters={() => { setSearch(''); setDepartmentId(''); setRoleName(''); }} />
      <footer className="flex flex-col gap-2 border-t border-[var(--border-subtle)] px-4 py-3 text-xs text-[var(--text-tertiary)] sm:flex-row sm:items-center sm:justify-between"><span>All people stay in one managed organization tree, arranged by business reporting rather than system access.</span><span className="inline-flex items-center gap-1.5"><ShieldCheck size={13} className="text-emerald-600" /> RBAC roles are read-only here</span></footer>
    </div>

    {data.issues.length > 0 && <div className="apex-card border-amber-200 p-5"><div className="flex items-center gap-2"><AlertTriangle size={17} className="text-amber-600" /><h3 className="font-semibold text-[var(--text-primary)]">Hierarchy setup issues</h3></div><div className="mt-3 space-y-2">{data.issues.slice(0, 8).map((issue, index) => <button key={`${issue.userId}:${index}`} type="button" onClick={() => setSelectedId(issue.userId)} className="flex w-full items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-left text-xs text-amber-800"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{issue.message}</button>)}</div></div>}
  </section>;
}

/** The overview stays at leadership/department depth; people render on expansion. */
function OfficeMindMap({ nodes, directory, edges, selectedId, onSelect, onClearFilters }: {
  nodes: HierarchyNode[]; directory: HierarchyNode[]; edges: HierarchyEdge[];
  selectedId: string | null; onSelect: (node: HierarchyNode) => void; onClearFilters: () => void;
}) {
  type Entry = { node: HierarchyNode; edge: HierarchyEdge };
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
  }, []);
  const visibleIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const byId = useMemo(() => new Map(directory.map((node) => [node.id, node])), [directory]);
  const children = useMemo(() => {
    const result = new Map<string, Entry[]>();
    for (const edge of edges) {
      const node = byId.get(edge.subjectUserId);
      if (!node || !byId.has(edge.assigneeUserId)) continue;
      result.set(edge.assigneeUserId, [...(result.get(edge.assigneeUserId) ?? []), { node, edge }]);
    }
    Array.from(result.values()).forEach((group) => group.sort((a, b) => a.node.name.localeCompare(b.node.name)));
    return result;
  }, [byId, edges]);
  const primary = useMemo(() => new Set(edges.filter((edge) => (edge.scopeKey ?? 'PRIMARY') === 'PRIMARY').map((edge) => edge.subjectUserId)), [edges]);
  const root = directory.find((node) => /chief executive|\bceo\b/i.test(personTitle(node)))
    ?? directory.find((node) => node.organizationParticipation !== 'ACCESS_ONLY' && !primary.has(node.id));
  const hasMatch = (id: string, seen = new Set<string>()): boolean => {
    if (visibleIds.has(id)) return true;
    if (seen.has(id)) return false;
    const next = new Set(seen).add(id);
    return (children.get(id) ?? []).some((entry) => hasMatch(entry.node.id, next));
  };
  const leaders = root ? (children.get(root.id) ?? [])
    .filter((entry) => (entry.edge.scopeKey ?? 'PRIMARY') === 'PRIMARY' && departmentFor(entry.node, entry.edge.departmentId)?.name !== "Founder's Office" && hasMatch(entry.node.id))
    .sort((a, b) => {
      const order = ['payal', 'tejas kadam', 'anshika', 'krunal'];
      const rank = (name: string) => { const index = order.findIndex((value) => name.toLowerCase().includes(value)); return index < 0 ? 99 : index; };
      return rank(a.node.name) - rank(b.node.name) || a.node.name.localeCompare(b.node.name);
    }) : [];
  const founderTeam = root ? (children.get(root.id) ?? []).filter((entry) => departmentFor(entry.node, entry.edge.departmentId)?.name === "Founder's Office" && hasMatch(entry.node.id)) : [];
  const accessOnly = nodes.filter((node) => node.organizationParticipation === 'ACCESS_ONLY');
  const connected = new Set<string>();
  const visit = (id: string) => {
    if (connected.has(id)) return;
    connected.add(id);
    for (const entry of children.get(id) ?? []) visit(entry.node.id);
  };
  if (root) visit(root.id);
  const unassigned = nodes.filter((node) => node.organizationParticipation !== 'ACCESS_ONLY' && !connected.has(node.id));
  const toggle = (id: string) => setOpen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  if (!nodes.length) return <div className="flex min-h-[420px] flex-col items-center justify-center bg-[var(--bg-secondary)] p-8 text-center"><Search className="mb-3 text-[var(--text-tertiary)]" /><p className="font-semibold">No people match these filters</p><button type="button" onClick={onClearFilters} className="mt-2 text-sm font-medium text-blue-600">Clear filters</button></div>;

  return <div className="bg-[var(--bg-secondary)] p-4 sm:p-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-600">Office mind map</p><h3 className="text-lg font-semibold text-[var(--text-primary)]">One view of the whole company</h3><p className="text-xs text-[var(--text-secondary)]">Pavan leads four business branches. Open a department to follow its reporting path.</p></div><span className="rounded-full bg-[var(--surface-card)] px-3 py-1 text-xs text-[var(--text-secondary)]">{nodes.length} of {directory.length} people</span></div>
    <div aria-label="Access role colors" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]"><span className="font-semibold text-[var(--text-primary)]">Card accent = access role</span>{(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'TEAM_LEAD', 'EMPLOYEE', 'INTERN'] as const).map((role) => <span key={role} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ROLE_TINT[role] }} />{ROLE_LABEL[role]}</span>)}</div>
    <div ref={viewportRef} className="overflow-x-auto rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-card)]" aria-label="Company reporting tree" tabIndex={0}>
      <div className="min-w-[1120px] bg-[radial-gradient(circle_at_50%_0%,rgba(59,130,246,0.09),transparent_45%)] px-5 pb-40 pt-7">
        {root && <div className="mx-auto w-[320px] rounded-2xl border border-blue-200 bg-blue-50/70 p-3 shadow-sm">
          <p className="mb-2 text-center text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">Company leadership</p>
          <NetworkPersonCard node={root} selected={selectedId === root.id} onSelect={() => onSelect(root)} featured contextOnly={!visibleIds.has(root.id)} />
          {founderTeam.length > 0 && <div className="mt-2 border-t border-blue-200 pt-2"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-blue-600">Founder’s Office</p>{founderTeam.map((entry) => <NetworkPersonCard key={entry.edge.id} node={entry.node} selected={selectedId === entry.node.id} onSelect={() => onSelect(entry.node)} compact />)}</div>}
        </div>}
        {leaders.length > 0 && <>
          <div className="mx-auto h-7 w-px bg-blue-300" aria-hidden="true" />
          <div className="relative mx-[12.5%] h-px bg-blue-300" aria-hidden="true" />
          <div className="grid grid-cols-4 gap-4">
            {leaders.map((leader) => {
              const branches = (children.get(leader.node.id) ?? []).filter((entry) => hasMatch(entry.node.id));
              return <section key={leader.edge.id} className="relative min-w-0 pt-6">
                <div className="absolute left-1/2 top-0 h-6 w-px bg-blue-300" aria-hidden="true" />
                <div className="h-full rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-card)] p-3 shadow-sm">
                  <NetworkPersonCard node={leader.node} selected={selectedId === leader.node.id} onSelect={() => onSelect(leader.node)} contextOnly={!visibleIds.has(leader.node.id)} />
                  <p className="mt-2 text-center text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">{branches.length} {branches.length === 1 ? 'reporting branch' : 'reporting branches'}</p>
                  <div className="mx-auto my-2 h-4 w-px bg-[var(--border-primary)]" aria-hidden="true" />
                  <div className="space-y-2">
                    {branches.length ? branches.map((branch) => {
                      const department = departmentFor(branch.node, branch.edge.departmentId);
                      const expanded = open.has(branch.edge.id);
                      return <div key={branch.edge.id} className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2">
                        <button type="button" onClick={() => toggle(branch.edge.id)} aria-expanded={expanded} className="mb-2 flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-[var(--accent-subtle)]">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: department?.color ?? '#3b82f6' }} />
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--text-primary)]">{department?.name ?? 'Direct report'}</span>
                          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                        <NetworkPersonCard node={branch.node} departmentId={branch.edge.departmentId} selected={selectedId === branch.node.id} onSelect={() => onSelect(branch.node)} compact contextOnly={!visibleIds.has(branch.node.id)} />
                        {expanded && <div className="mt-2 border-t border-[var(--border-subtle)] pt-2"><FullNetworkBranch entry={branch} childrenByParent={children} visibleIds={visibleIds} selectedId={selectedId} onSelect={onSelect} hasVisibleSubtree={hasMatch} depth={1} compact hideSelf /></div>}
                      </div>;
                    }) : <p className="rounded-xl border border-dashed border-[var(--border-primary)] p-3 text-center text-xs text-[var(--text-tertiary)]">No direct reports assigned</p>}
                  </div>
                </div>
              </section>;
            })}
          </div>
        </>}
      </div>
    </div>
    <p className="mt-2 text-xs text-[var(--text-tertiary)]">The CEO’s four reporting branches stay together. Expand a department to explore its team; scroll sideways on narrower screens.</p>
    {accessOnly.length > 0 && <section className="mt-4 rounded-xl border border-violet-200 bg-violet-50/60 p-3"><h4 className="text-sm font-semibold">Platform administrators</h4><p className="mb-2 text-xs text-[var(--text-secondary)]">Technical access accounts</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{accessOnly.map((node) => <NetworkPersonCard key={node.id} node={node} selected={selectedId === node.id} onSelect={() => onSelect(node)} compact />)}</div></section>}
    {unassigned.length > 0 && <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3"><h4 className="text-sm font-semibold">Reporting setup required · {unassigned.length}</h4><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{unassigned.map((node) => <NetworkPersonCard key={node.id} node={node} selected={selectedId === node.id} onSelect={() => onSelect(node)} compact />)}</div></section>}
  </div>;
}

function FullPeopleNetwork({ nodes, directory, edges, selectedId, onSelect, onClearFilters }: {
  nodes: HierarchyNode[];
  directory: HierarchyNode[];
  edges: HierarchyEdge[];
  selectedId: string | null;
  onSelect: (node: HierarchyNode) => void;
  onClearFilters: () => void;
}) {
  type NetworkChild = { node: HierarchyNode; edge: HierarchyEdge };
  const [expandedDepartments, setExpandedDepartments] = useState<Set<string>>(() => new Set());
  const visibleIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const byId = useMemo(() => new Map(directory.map((node) => [node.id, node])), [directory]);
  const primaryEdges = useMemo(() => edges.filter((edge) => (edge.scopeKey ?? 'PRIMARY') === 'PRIMARY'), [edges]);
  const parentByChild = useMemo(() => new Map(primaryEdges.map((edge) => [edge.subjectUserId, edge.assigneeUserId])), [primaryEdges]);
  const childrenByParent = useMemo(() => {
    const result = new Map<string, NetworkChild[]>();
    for (const edge of edges) {
      const child = byId.get(edge.subjectUserId);
      if (!child || !byId.has(edge.assigneeUserId)) continue;
      result.set(edge.assigneeUserId, [...(result.get(edge.assigneeUserId) ?? []), { node: child, edge }]);
    }
    for (const children of Array.from(result.values())) {
      children.sort((a, b) => (departmentFor(a.node, a.edge.departmentId)?.name ?? '').localeCompare(departmentFor(b.node, b.edge.departmentId)?.name ?? '') || a.node.name.localeCompare(b.node.name));
    }
    return result;
  }, [byId, edges]);

  const root = directory.find((node) => /chief executive|\bceo\b/i.test(personTitle(node)))
    ?? directory.find((node) => !parentByChild.has(node.id))
    ?? null;
  const reachable = useMemo(() => {
    const result = new Set<string>();
    const visit = (id: string) => {
      if (result.has(id)) return;
      result.add(id);
      for (const child of childrenByParent.get(id) ?? []) visit(child.node.id);
    };
    if (root) visit(root.id);
    return result;
  }, [childrenByParent, root]);
  const hasVisibleSubtree = (id: string, trail = new Set<string>()): boolean => {
    if (visibleIds.has(id)) return true;
    if (trail.has(id)) return false;
    const nextTrail = new Set(trail).add(id);
    return (childrenByParent.get(id) ?? []).some((child) => hasVisibleSubtree(child.node.id, nextTrail));
  };
  const executiveLanes = root ? (childrenByParent.get(root.id) ?? []).filter((entry) => (entry.edge.scopeKey ?? 'PRIMARY') === 'PRIMARY' && hasVisibleSubtree(entry.node.id)) : [];
  const foundersOffice = root ? (childrenByParent.get(root.id) ?? []).filter((entry) => departmentFor(entry.node, entry.edge.departmentId)?.name === "Founder's Office" && hasVisibleSubtree(entry.node.id)) : [];
  const operationsLeader = executiveLanes.find((entry) => entry.node.name.toLowerCase() === 'tejas kadam') ?? null;
  const otherLeaders = executiveLanes.filter((entry) => entry.edge.id !== operationsLeader?.edge.id);
  const operationsBranches = operationsLeader ? (childrenByParent.get(operationsLeader.node.id) ?? []).filter((child) => child.edge.id !== operationsLeader.edge.id && hasVisibleSubtree(child.node.id)) : [];
  const atlasDepartments = [
    ...operationsBranches.map((branch) => ({ branch, owner: operationsLeader?.node ?? null })),
    ...otherLeaders.flatMap((owner) => (childrenByParent.get(owner.node.id) ?? [])
      .filter((branch) => branch.edge.id !== owner.edge.id && hasVisibleSubtree(branch.node.id))
      .map((branch) => ({ branch, owner: owner.node }))),
  ];
  const toggleDepartment = (id: string) => setExpandedDepartments((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const accessOnly = nodes.filter((node) => node.organizationParticipation === 'ACCESS_ONLY');
  const unassigned = nodes.filter((node) => node.organizationParticipation !== 'ACCESS_ONLY' && !reachable.has(node.id));
  const unassignedIds = new Set(unassigned.map((node) => node.id));
  const unassignedRoots = unassigned.filter((node) => {
    const parentId = parentByChild.get(node.id);
    return !parentId || !unassignedIds.has(parentId);
  });

  if (!nodes.length) return <div className="flex min-h-[420px] flex-col items-center justify-center bg-[var(--bg-secondary)] p-8 text-center"><Search className="mb-3 text-[var(--text-tertiary)]" /><p className="font-semibold text-[var(--text-primary)]">No people match these filters</p><button type="button" onClick={onClearFilters} className="mt-2 text-sm font-medium text-blue-600">Clear filters</button></div>;

  return <div className="bg-[var(--bg-secondary)] px-4 py-6 sm:px-6">
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-6 flex flex-col gap-2 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">Organization atlas</p><h3 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">How the company operates</h3><p className="mt-1 text-sm text-[var(--text-secondary)]">Explore people through their operating areas, not a crowded reporting diagram.</p></div>
        <span className="self-center rounded-full border border-[var(--border-primary)] bg-[var(--surface-card)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)]">{nodes.length} of {directory.length} people shown</span>
      </div>

      {root && hasVisibleSubtree(root.id) && <>
        <div className="mx-auto w-full max-w-sm"><NetworkPersonCard node={root} selected={selectedId === root.id} onSelect={() => onSelect(root)} featured contextOnly={!visibleIds.has(root.id)} /></div>
        <div className="mx-auto h-8 w-px bg-[var(--border-primary)]" />
        {foundersOffice.length > 0 && <section className="mx-auto mb-5 w-full max-w-sm rounded-2xl border border-sky-200 bg-sky-50/50 p-3"><p className="mb-2 text-center text-[10px] font-bold uppercase tracking-wider text-sky-700">Founder’s Office</p>{foundersOffice.map((entry) => <NetworkPersonCard key={entry.edge.id} node={entry.node} departmentId={entry.edge.departmentId} selected={selectedId === entry.node.id} onSelect={() => onSelect(entry.node)} compact contextOnly={!visibleIds.has(entry.node.id)} />)}</section>}
        <div className="relative grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:before:absolute xl:before:left-[12.5%] xl:before:right-[12.5%] xl:before:top-0 xl:before:h-px xl:before:bg-[var(--border-primary)]">
          {[...otherLeaders, ...(operationsLeader ? [operationsLeader] : [])].map((leader) => {
            const reports = (childrenByParent.get(leader.node.id) ?? []).filter((child) => child.edge.id !== leader.edge.id && hasVisibleSubtree(child.node.id));
            const isOperations = leader.edge.id === operationsLeader?.edge.id;
            return <section key={leader.edge.id} className="relative min-w-0 pt-4 xl:before:absolute xl:before:-top-4 xl:before:left-1/2 xl:before:h-4 xl:before:w-px xl:before:bg-[var(--border-primary)]">
              <NetworkPersonCard node={leader.node} departmentId={leader.edge.departmentId} selected={selectedId === leader.node.id} onSelect={() => onSelect(leader.node)} executive contextOnly={!visibleIds.has(leader.node.id)} />
              <p className="mt-2 text-center text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">{isOperations ? `${operationsBranches.length} operating areas` : `${reports.length} direct ${reports.length === 1 ? 'report' : 'reports'}`}</p>
            </section>;
          })}
        </div>

        {atlasDepartments.length > 0 && <section className="mt-8 border-t border-[var(--border-primary)] pt-6">
          <div className="mb-5 flex flex-col gap-1 text-center"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">Operating areas</p><h4 className="text-base font-semibold text-[var(--text-primary)]">Departments at a glance</h4><p className="text-sm text-[var(--text-secondary)]">Open an area to see the people and responsibilities inside it.</p></div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {atlasDepartments.map(({ branch, owner }) => {
              const department = departmentFor(branch.node, branch.edge.departmentId);
              const branchChildren = (childrenByParent.get(branch.node.id) ?? []).filter((child) => (child.edge.departmentId ?? child.node.departmentId) === (branch.edge.departmentId ?? branch.node.departmentId) && hasVisibleSubtree(child.node.id));
              const expanded = expandedDepartments.has(branch.edge.id);
              return <section key={branch.edge.id} className="overflow-hidden rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-card)] shadow-sm transition-shadow hover:shadow-md">
                <button type="button" onClick={() => toggleDepartment(branch.edge.id)} className="w-full p-4 text-left transition hover:bg-[var(--bg-secondary)]">
                  <span className="flex items-start gap-3"><span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: department?.color ?? 'var(--accent)' }} /><span className="min-w-0 flex-1"><strong className="block truncate text-base text-[var(--text-primary)]">{department?.name ?? 'Operations'}</strong><span className="mt-1 block truncate text-xs text-[var(--text-secondary)]">Owned by {owner?.name ?? 'Company leadership'}</span><span className="mt-2 block text-[10px] font-bold uppercase tracking-wide text-[var(--text-tertiary)]">{branchChildren.length} direct reports</span></span>{expanded ? <ChevronDown size={17} className="mt-1 text-[var(--text-tertiary)]" /> : <ChevronRight size={17} className="mt-1 text-[var(--text-tertiary)]" />}</span>
                </button>
                <div className="px-4 pb-4"><NetworkPersonCard node={branch.node} departmentId={branch.edge.departmentId} selected={selectedId === branch.node.id} onSelect={() => onSelect(branch.node)} compact /></div>
                {expanded && <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2"><FullNetworkBranch entry={branch} childrenByParent={childrenByParent} visibleIds={visibleIds} selectedId={selectedId} onSelect={onSelect} hasVisibleSubtree={hasVisibleSubtree} depth={1} hideSelf /></div>}
              </section>;
            })}
          </div>
        </section>}
      </>}

      {accessOnly.length > 0 && <section className="mt-6 rounded-2xl border border-violet-200 bg-violet-50/50 p-4"><div className="mb-3"><h4 className="text-sm font-semibold text-[var(--text-primary)]">Platform administrators</h4><p className="text-xs text-[var(--text-secondary)]">Technical access is separate from company leadership. These accounts do not affect the reporting structure.</p></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{accessOnly.map((node) => <NetworkPersonCard key={node.id} node={node} selected={selectedId === node.id} onSelect={() => onSelect(node)} compact />)}</div></section>}
      {unassignedRoots.length > 0 && <section className="mt-6 rounded-2xl border border-dashed border-amber-300 bg-amber-50/40 p-4"><div className="mb-3 flex items-center justify-between"><div><h4 className="text-sm font-semibold text-[var(--text-primary)]">Workforce setup required</h4><p className="text-xs text-[var(--text-secondary)]">These people need a business reporting line.</p></div><span className="text-xs font-semibold text-[var(--text-tertiary)]">{unassigned.length} people</span></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{unassignedRoots.map((node) => <NetworkPersonCard key={node.id} node={node} selected={selectedId === node.id} onSelect={() => onSelect(node)} compact />)}</div>
      </section>}
    </div>
  </div>;
}

function FullNetworkBranch({ entry, childrenByParent, visibleIds, selectedId, onSelect, hasVisibleSubtree, depth, compact = false, hideSelf = false }: {
  entry: { node: HierarchyNode; edge: HierarchyEdge };
  childrenByParent: Map<string, Array<{ node: HierarchyNode; edge: HierarchyEdge }>>;
  visibleIds: Set<string>;
  selectedId: string | null;
  onSelect: (node: HierarchyNode) => void;
  hasVisibleSubtree: (id: string) => boolean;
  depth: number;
  compact?: boolean;
  hideSelf?: boolean;
}) {
  const node = entry.node;
  const contextDepartmentId = entry.edge.departmentId ?? node.departmentId;
  const children = (childrenByParent.get(node.id) ?? []).filter((child) => (child.edge.departmentId ?? child.node.departmentId) === contextDepartmentId && hasVisibleSubtree(child.node.id));
  const additionalDepartments = (node.departmentMemberships ?? []).filter((membership) => membership.departmentId !== contextDepartmentId && (childrenByParent.get(node.id) ?? []).some((child) => (child.edge.departmentId ?? child.node.departmentId) === membership.departmentId && hasVisibleSubtree(child.node.id)));
  const department = departmentFor(node, contextDepartmentId);
  const colour = department?.color ?? '#64748b';
  return <div className={depth === 0 && !compact ? 'overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]' : ''}>
    {depth === 0 && !compact && <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colour }} /><span className="min-w-0"><strong className="block truncate text-xs text-[var(--text-primary)]">{department?.name ?? 'Business operations'}</strong><span className="block text-[10px] text-[var(--text-tertiary)]">{children.length} direct {children.length === 1 ? 'report' : 'reports'}</span></span></div>}
    <div className={depth === 0 && !compact ? 'p-2' : ''}>
      {!hideSelf && <NetworkPersonCard node={node} departmentId={contextDepartmentId} secondaryAssignment={(entry.edge.scopeKey ?? 'PRIMARY') !== 'PRIMARY'} selected={selectedId === node.id} onSelect={() => onSelect(node)} compact contextOnly={!visibleIds.has(node.id)} />}
      {children.length > 0 && <div className={`relative ${hideSelf ? '' : 'ml-4 mt-2 border-l-2 pl-3'} space-y-2 ${hideSelf ? '' : 'border-[var(--border-primary)]'}`}>{children.map((child) => <FullNetworkBranch key={child.edge.id} entry={child} childrenByParent={childrenByParent} visibleIds={visibleIds} selectedId={selectedId} onSelect={onSelect} hasVisibleSubtree={hasVisibleSubtree} depth={depth + 1} compact />)}</div>}
      {additionalDepartments.map((membership) => {
        const crossTeam = (childrenByParent.get(node.id) ?? []).filter((child) => (child.edge.departmentId ?? child.node.departmentId) === membership.departmentId && hasVisibleSubtree(child.node.id));
        return <div key={membership.departmentId} className="mt-2 border-l-2 border-violet-300 pl-3"><p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-violet-700">Also leads · {membership.department.name}</p><div className="space-y-2">{crossTeam.map((child) => <FullNetworkBranch key={child.edge.id} entry={child} childrenByParent={childrenByParent} visibleIds={visibleIds} selectedId={selectedId} onSelect={onSelect} hasVisibleSubtree={hasVisibleSubtree} depth={depth + 1} compact />)}</div></div>;
      })}
    </div>
  </div>;
}

function NetworkPersonCard({ node, departmentId, selected, onSelect, featured = false, compact = false, contextOnly = false }: {
  node: HierarchyNode;
  departmentId?: string | null;
  selected: boolean;
  onSelect: () => void;
  featured?: boolean;
  executive?: boolean;
  compact?: boolean;
  contextOnly?: boolean;
  secondaryAssignment?: boolean;
}) {
  const membership = node.departmentMemberships?.find((item) => item.departmentId === departmentId);
  const title = membership?.designation?.trim() || node.designation?.trim() || 'Designation not set';
  const roleColor = ROLE_TINT[node.role.name] ?? '#64748b';
  const tooltipId = `person-tooltip-${node.id}`;
  return <span className="group relative block">
    <button type="button" onClick={onSelect} aria-label={`${node.name}, ${title}, ${ROLE_LABEL[node.role.name] ?? node.role.name} access role`} aria-describedby={tooltipId} aria-expanded={selected} className={`w-full rounded-xl border border-l-4 bg-[var(--surface-card)] text-left transition active:scale-[0.99] hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 motion-reduce:transform-none ${featured ? 'p-4' : compact ? 'p-2.5' : 'p-3'}`} style={{ borderLeftColor: roleColor, borderTopColor: selected ? 'var(--accent)' : 'var(--border-primary)', borderRightColor: selected ? 'var(--accent)' : 'var(--border-primary)', borderBottomColor: selected ? 'var(--accent)' : 'var(--border-primary)', boxShadow: selected ? '0 0 0 3px var(--accent-subtle)' : undefined, opacity: contextOnly ? 0.78 : 1 }}>
      <span className="flex min-w-0 items-center gap-2.5"><span className="shrink-0 rounded-full border-2 p-0.5" style={{ borderColor: roleColor }}><UserAvatar name={node.name} avatar={node.avatar} photoUrl={node.photoUrl} size={featured ? 'lg' : 'sm'} className={featured ? '!h-12 !w-12' : '!h-9 !w-9'} /></span><span className="min-w-0 flex-1"><strong className={`${featured ? 'text-base' : 'text-sm'} block truncate text-[var(--text-primary)]`}>{node.name}</strong><span className="block truncate text-xs text-[var(--text-secondary)]">{title}</span></span></span>
    </button>
    <span id={tooltipId} role="tooltip" className={`absolute left-1/2 top-[calc(100%+0.55rem)] z-[80] w-64 -translate-x-1/2 rounded-xl border border-[var(--border-primary)] bg-[var(--surface-card)] p-3 text-left shadow-xl transition-[opacity,transform] duration-150 motion-reduce:transition-none ${selected ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100'}`}>
      <span className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-l border-t border-[var(--border-primary)] bg-[var(--surface-card)]" />
      <span className="relative flex items-center gap-2.5"><UserAvatar name={node.name} avatar={node.avatar} photoUrl={node.photoUrl} size="sm" className="!h-9 !w-9" /><span className="min-w-0"><strong className="block truncate text-sm text-[var(--text-primary)]">{node.name}</strong><span className="block truncate text-xs text-[var(--text-secondary)]">{title}</span></span></span>
      <span className="relative mt-2 grid grid-cols-2 gap-2 border-t border-[var(--border-subtle)] pt-2 text-[10px]">
        <span><span className="block uppercase tracking-wide text-[var(--text-tertiary)]">Department</span><strong className="mt-0.5 block truncate text-[var(--text-primary)]">{membership?.department.name ?? node.department?.name ?? 'Not assigned'}</strong></span>
        <span><span className="block uppercase tracking-wide text-[var(--text-tertiary)]">Direct reports</span><strong className="mt-0.5 block text-[var(--text-primary)]">{node.directReportCount}</strong></span>
      </span>
      <span className="relative mt-2 block text-[10px] text-[var(--text-tertiary)]">Click the card again to close</span>
    </span>
  </span>;
}

function CompanyLeadershipMap({ nodes, directory, edges, selectedId, onSelect }: { nodes: HierarchyNode[]; directory: HierarchyNode[]; edges: HierarchyEdge[]; selectedId: string | null; onSelect: (node: HierarchyNode) => void }) {
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(() => new Set());
  const visibleIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
  const byId = useMemo(() => new Map(directory.map((node) => [node.id, node])), [directory]);
  const parentByChild = useMemo(() => new Map(edges.map((edge) => [edge.subjectUserId, edge.assigneeUserId])), [edges]);
  const childrenByParent = useMemo(() => {
    const result = new Map<string, HierarchyNode[]>();
    for (const edge of edges) {
      const child = byId.get(edge.subjectUserId);
      if (!child) continue;
      result.set(edge.assigneeUserId, [...(result.get(edge.assigneeUserId) ?? []), child]);
    }
    Array.from(result.values()).forEach((children) => children.sort((a, b) => a.name.localeCompare(b.name)));
    return result;
  }, [byId, edges]);
  const root = nodes.find((node) => /chief executive|\bceo\b/i.test(personTitle(node)))
    ?? nodes.find((node) => !parentByChild.has(node.id))
    ?? null;
  const leaders = root ? (childrenByParent.get(root.id) ?? []).filter((node) => visibleIds.has(node.id)) : [];
  const allDepartmentHeads = leaders.flatMap((leader) => childrenByParent.get(leader.id) ?? []).filter((node) => visibleIds.has(node.id));
  const toggleBranch = (id: string) => setExpandedBranches((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  if (!root) return <div className="flex min-h-[340px] flex-col items-center justify-center bg-[var(--bg-secondary)] p-8 text-center"><Search className="mb-3 text-[var(--text-tertiary)]" /><p className="font-semibold text-[var(--text-primary)]">No people match these filters</p><p className="mt-1 text-sm text-[var(--text-secondary)]">Clear a filter to restore the leadership map.</p></div>;

  return <div className="bg-[var(--bg-secondary)] p-4 sm:p-6">
    <div className="mx-auto max-w-7xl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent)]">Company tree</p><h3 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">One clear reporting structure</h3><p className="mt-1 text-sm text-[var(--text-secondary)]">Primary reporting stays simple. Cross-team responsibility appears on the person who owns it.</p></div><div className="flex gap-2"><button type="button" onClick={() => setExpandedBranches(new Set(allDepartmentHeads.map((node) => node.id)))} className="apex-btn apex-btn-secondary text-xs">Expand departments</button><button type="button" onClick={() => setExpandedBranches(new Set())} className="apex-btn apex-btn-secondary text-xs">Collapse all</button></div></div>
      <div className="mx-auto w-full max-w-xs"><LeadershipPersonCard node={root} selected={selectedId === root.id} onSelect={() => onSelect(root)} featured /></div>
      <div className="mx-auto h-8 w-px bg-[var(--border-primary)]" />
      <div className="relative grid gap-4 lg:grid-cols-2 xl:grid-cols-4 before:absolute before:left-[12.5%] before:right-[12.5%] before:top-0 before:hidden before:h-px before:bg-[var(--border-primary)] xl:before:block">
        {leaders.map((leader) => {
          const branches = (childrenByParent.get(leader.id) ?? []).filter((node) => visibleIds.has(node.id));
          const isOperationsPortfolio = leader.name.toLowerCase() === 'tejas kadam';
          return <section key={leader.id} className={`${isOperationsPortfolio ? 'order-last lg:col-span-2 xl:col-span-4' : ''} relative rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-card)] p-3 shadow-sm before:absolute before:-top-4 before:left-1/2 before:hidden before:h-4 before:w-px before:bg-[var(--border-primary)] xl:before:block`}>
            <LeadershipPersonCard node={leader} selected={selectedId === leader.id} onSelect={() => onSelect(leader)} />
            <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
              {isOperationsPortfolio && branches.length > 0 && <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">Department lanes</p>}
              <div className={isOperationsPortfolio ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5' : 'space-y-2'}>{branches.length ? branches.map((head) => {
                const members = (childrenByParent.get(head.id) ?? []).filter((node) => visibleIds.has(node.id));
                const expanded = expandedBranches.has(head.id);
                const colour = head.department?.color ?? '#64748b';
                return <div key={head.id} className="overflow-hidden rounded-xl border border-[var(--border-primary)]">
                  <div className="flex items-center gap-2 p-2.5"><button type="button" onClick={() => toggleBranch(head.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colour }} /><span className="min-w-0 flex-1"><strong className="block truncate text-xs text-[var(--text-primary)]">{head.department?.name ?? personTitle(head)}</strong><span className="block truncate text-[10px] text-[var(--text-tertiary)]">{head.name} · {members.length} {members.length === 1 ? 'member' : 'members'}</span></span>{members.length > 0 && (expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}</button><button type="button" aria-label={`Open ${head.name}`} onClick={() => onSelect(head)} className="rounded-md px-2 py-1 text-[10px] font-semibold text-[var(--accent)] hover:bg-[var(--accent-subtle)]">View</button></div>
                  {expanded && members.length > 0 && <div className="space-y-1.5 border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2">{members.map((member) => { const secondary = (member.departmentMemberships ?? []).filter((membership) => !membership.isPrimary); return <button key={member.id} type="button" onClick={() => onSelect(member)} className="flex w-full items-center gap-2 rounded-lg bg-[var(--surface-card)] p-2 text-left hover:shadow-sm"><UserAvatar name={member.name} avatar={member.avatar} photoUrl={member.photoUrl} size="sm" className="!h-7 !w-7" /><span className="min-w-0"><strong className="block truncate text-xs text-[var(--text-primary)]">{member.name}</strong><span className="block truncate text-[10px] text-[var(--text-tertiary)]">{personTitle(member)}{secondary.length ? ` · Also leads ${secondary.map((membership) => membership.department.name).join(', ')}` : ''}</span></span></button>; })}</div>}
                </div>;
              }) : <p className="rounded-xl border border-dashed border-[var(--border-primary)] px-3 py-4 text-center text-xs text-[var(--text-tertiary)]">No direct reports assigned</p>}</div>
            </div>
          </section>;
        })}
      </div>
    </div>
  </div>;
}

function LeadershipPersonCard({ node, selected, onSelect, featured = false }: { node: HierarchyNode; selected: boolean; onSelect: () => void; featured?: boolean }) {
  return <button type="button" onClick={onSelect} className="w-full rounded-xl border bg-[var(--surface-card)] p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md" style={{ borderColor: selected ? 'var(--accent)' : 'var(--border-primary)', boxShadow: selected ? '0 0 0 3px var(--accent-subtle)' : undefined }}><span className="flex items-center gap-3"><UserAvatar name={node.name} avatar={node.avatar} photoUrl={node.photoUrl} size={featured ? 'lg' : 'md'} className={featured ? '!h-12 !w-12' : '!h-10 !w-10'} /><span className="min-w-0 flex-1"><strong className={`${featured ? 'text-base' : 'text-sm'} block truncate text-[var(--text-primary)]`}>{node.name}</strong><span className="block truncate text-xs font-medium text-[var(--accent)]">{personTitle(node)}</span><span className="mt-0.5 block truncate text-[10px] text-[var(--text-tertiary)]">{node.department?.name ?? 'Company leadership'} · {node.directReportCount} direct reports</span></span></span></button>;
}

function LadderPersonCard({ node, selected, reportsTo, onSelect }: { node: HierarchyNode; selected: boolean; reportsTo: Array<{ role: RelationRole; name: string }>; onSelect: () => void }) {
  const tint = ROLE_TINT[node.role.name] ?? '#64748b';
  const manager = reportsTo.find((item) => item.role === 'MANAGER');
  const lead = reportsTo.find((item) => item.role === 'TEAM_LEAD');
  return <button type="button" onClick={onSelect} className="w-full rounded-xl border bg-[var(--surface-card)] p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" style={{ borderColor: selected ? 'var(--accent)' : 'var(--border-primary)', boxShadow: selected ? '0 0 0 3px var(--accent-subtle)' : undefined }}>
    <span className="flex min-w-0 items-center gap-2.5"><UserAvatar name={node.name} avatar={node.avatar} photoUrl={node.photoUrl} size="sm" className="!h-9 !w-9" /><span className="min-w-0 flex-1"><strong className="block truncate text-sm text-[var(--text-primary)]">{node.name}</strong><span className="block truncate text-xs text-[var(--text-secondary)]">{personTitle(node)}</span></span></span>
    <span className="mt-2 flex items-center justify-between gap-2"><span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase" style={{ background: `${tint}18`, color: tint }}>Access: {ROLE_LABEL[node.role.name] ?? node.role.name}</span><span className="text-[10px] text-[var(--text-tertiary)]">{node.directReportCount} reports</span></span>
    {(manager || lead) && <span className="mt-2 block truncate border-t border-[var(--border-subtle)] pt-2 text-[10px] text-[var(--text-secondary)]">Reports to: {lead?.name ?? manager?.name}</span>}
  </button>;
}

function Stat({ icon, label, value, tint }: { icon: React.ReactNode; label: string; value: number; tint: string }) {
  return <div className="apex-card flex items-center gap-3 p-4"><span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ color: tint, background: `${tint}14` }}>{icon}</span><div><p className="text-xl font-bold text-[var(--text-primary)]">{value}</p><p className="text-xs text-[var(--text-secondary)]">{label}</p></div></div>;
}

function HierarchySkeleton() {
  return <div className="space-y-5"><div className="h-16 animate-pulse rounded-2xl bg-[var(--bg-secondary)]" /><div className="grid gap-3 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-2xl bg-[var(--bg-secondary)]" />)}</div><div className="h-[560px] animate-pulse rounded-2xl bg-[var(--bg-secondary)]" /></div>;
}
