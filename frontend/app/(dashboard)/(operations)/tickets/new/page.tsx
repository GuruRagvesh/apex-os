'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ticketsApi, usersApi, aiApi, taskTypesApi, workdayApi } from '@/lib/api';
import { departmentsApi } from '@apex/core-organization-departments/api';
import { projectsApi } from '@apex/operations-projects/api';
import { useAuthStore } from '@/store/auth.store';
import toast from 'react-hot-toast';
import { ArrowLeft, Sparkles, Loader2, Clock, Plus, Copy, Trash2, Download, Upload, X } from 'lucide-react';
import { formatRole } from '@apex/operations-tickets-lifecycle/shared/ticket-vocabulary';
import { cn } from '@apex/shared-utilities';
import { MultiSelect } from '@apex/shared-ui/components/multi-select';

// ─── Request Types ──────────────────────────────────────────────────────────
// Task / Query / Help are real Ticket.type enum values (stored honestly). The
// labels below adapt a few fields per type to match the user's intent; anything
// not overridden falls back to the TASK label.
const REQUEST_TYPES = ['TASK', 'QUERY', 'HELP'] as const;
type RequestType = typeof REQUEST_TYPES[number];

const TYPE_META: Record<RequestType, { label: string; hint: string }> = {
  TASK:  { label: 'Task',  hint: 'Work to be done' },
  QUERY: { label: 'Query', hint: 'A question / clarification needed' },
  HELP:  { label: 'Help',  hint: 'Support / unblocking needed' },
};

const COMMON_LABELS = {
  title: 'Title', assignee: 'Assigned To', due: 'Due Date',
  estimate: 'Estimated Time', taskType: 'Task Type',
};
const TYPE_LABELS: Record<RequestType, Partial<typeof COMMON_LABELS>> = {
  TASK:  {},
  QUERY: { title: 'Query', assignee: 'Ask / Route To', due: 'Needed By', estimate: 'Expected Effort', taskType: 'Query Type' },
  HELP:  { title: 'What do you need help with?', assignee: 'Help From', due: 'Needed By', estimate: 'Expected Effort', taskType: 'Help Type' },
};
const labelFor = (type: RequestType, key: keyof typeof COMMON_LABELS) =>
  TYPE_LABELS[type][key] ?? COMMON_LABELS[key];

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'text-slate-500', MEDIUM: 'text-blue-600', HIGH: 'text-orange-600', URGENT: 'text-red-600',
};
const EST_MINUTE_STEPS = [0, 5, 10, 15, 20, 30, 45];

// Fields a row inherits from the Global Defaults section until the user overrides them.
const GLOBAL_FIELDS = ['departmentId', 'projectId', 'priority', 'taskTypeId', 'taskSubtypeId'] as const;
type GlobalField = typeof GLOBAL_FIELDS[number];

// A <input type="datetime-local"> / date+time value is local wall-clock with no
// timezone. Building the Date from components reads them in the browser's local
// zone, so this always converts using the user's real timezone — unlike sending
// the raw string, which the backend would (wrongly) parse as its own zone.
function localDateTimeInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const [datePart, timePart] = value.split('T');
  if (!datePart || !timePart) return undefined;
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) return undefined;
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

// Combine the required Due Date with the optional Due Time. With a time, treat as
// local wall-clock → UTC. Date-only keeps the system convention (18:30 IST = 13:00 UTC).
function combineDueDateTime(date: string, time: string): string | undefined {
  if (!date) return undefined;
  if (time) return localDateTimeInputToIso(`${date}T${time}`);
  return `${date}T13:00:00.000Z`;
}

interface TicketRow {
  key: string;
  type: RequestType;
  title: string;
  description: string;
  departmentId: string;
  taskTypeId: string;
  taskSubtypeId: string; // '' | id | '__custom__'
  customSubtype: string;
  assigneeIds: string[];
  targetDepartmentId: string; // QUERY/HELP only — cross-department routing target
  priority: string;
  startDate: string;
  startTime: string;
  dueDate: string;
  dueTime: string;
  estHours: string;
  estMinutes: string;
  projectId: string;
  scheduledEndAt: string;
  notes: string;
  showAdvanced: boolean;
  custom: Partial<Record<GlobalField, boolean>>;
  errors: string[];
  aiReason?: string;
  aiBusy?: boolean;
}

let rowSeq = 0;
const newKey = () => `row-${Date.now()}-${rowSeq++}`;

export default function CreateTicketsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get('from');
  const preselectedProjectId = searchParams.get('projectId') || '';
  const preselectedProjectName = searchParams.get('projectName')
    ? decodeURIComponent(searchParams.get('projectName')!) : null;
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const roleName = (user?.role as any)?.name ?? user?.role ?? '';
  const isTL = roleName === 'TEAM_LEAD';
  const isEmployee = roleName === 'EMPLOYEE' || roleName === 'INTERN';
  const myDeptId = user?.department?.id ?? '';
  const lockDept = isTL || isEmployee;     // department fixed to own dept
  const lockAssignee = isEmployee;          // always self-assigned — TASK only, see isSelfLockedRow
  // Employee/Intern self-assign applies to TASK rows only — QUERY/HELP are requests
  // directed at someone else (often in another department), so a row's type decides
  // whether the self-lock actually applies, not just the creator's role.
  const isSelfLockedRow = (row: TicketRow) => lockAssignee && row.type === 'TASK';

  const [globalDefaults, setGlobalDefaults] = useState({
    departmentId: lockDept ? myDeptId : '',
    projectId: preselectedProjectId,
    priority: 'MEDIUM',
    taskTypeId: '',
    taskSubtypeId: '',
  });

  const makeRow = (): TicketRow => ({
    key: newKey(),
    type: 'TASK',
    title: '', description: '',
    departmentId: globalDefaults.departmentId,
    taskTypeId: globalDefaults.taskTypeId,
    taskSubtypeId: globalDefaults.taskSubtypeId,
    customSubtype: '',
    assigneeIds: lockAssignee && user?.id ? [user.id] : [],
    targetDepartmentId: '',
    priority: globalDefaults.priority,
    startDate: '', startTime: '',
    dueDate: '', dueTime: '',
    estHours: '', estMinutes: '',
    projectId: globalDefaults.projectId,
    scheduledEndAt: '',
    notes: '',
    showAdvanced: false,
    custom: {},
    errors: [],
  });

  const [rows, setRows] = useState<TicketRow[]>([makeRow()]);
  const [submitting, setSubmitting] = useState(false);

  // ── Reference data ─────────────────────────────────────────────────────────
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: () => departmentsApi.getAll() as Promise<any[]> });
  const { data: projectsRaw } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.getAll() as Promise<any> });
  const { data: usersData } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.getAll() as Promise<any> });

  const projectList = useMemo(() => {
    if (!projectsRaw) return [];
    if (Array.isArray(projectsRaw)) return projectsRaw;
    if (Array.isArray(projectsRaw?.projects)) return projectsRaw.projects;
    return [];
  }, [projectsRaw]);
  const userList: any[] = usersData?.users ?? (Array.isArray(usersData) ? usersData : []);

  // Task types are dept-scoped and rows can span departments, so fetch per dept on demand.
  const [taskTypesByDept, setTaskTypesByDept] = useState<Record<string, any[]>>({});
  const loadingDepts = useRef<Set<string>>(new Set());
  useEffect(() => {
    const deptIds = new Set<string>();
    if (globalDefaults.departmentId) deptIds.add(globalDefaults.departmentId);
    rows.forEach((row) => { if (row.departmentId) deptIds.add(row.departmentId); });
    deptIds.forEach((id) => {
      if (taskTypesByDept[id] || loadingDepts.current.has(id)) return;
      loadingDepts.current.add(id);
      taskTypesApi.getByDepartment(id)
        .then((tt: any) => setTaskTypesByDept((prev) => ({ ...prev, [id]: Array.isArray(tt) ? tt : [] })))
        .catch(() => setTaskTypesByDept((prev) => ({ ...prev, [id]: [] })));
    });
  }, [globalDefaults.departmentId, rows, taskTypesByDept]);

  const taskTypesFor = (deptId: string): any[] => taskTypesByDept[deptId] ?? [];
  const subtypesFor = (deptId: string, taskTypeId: string): any[] =>
    taskTypesFor(deptId).find((t: any) => t.id === taskTypeId)?.subtypes ?? [];
  const usersFor = (deptId: string): any[] => {
    const scoped = deptId ? userList.filter((u: any) => u.departmentId === deptId) : userList;
    if (isEmployee) return scoped.filter((u: any) => u.id === user?.id || u.role?.name === 'TEAM_LEAD');
    return scoped;
  };
  const deptName = (id: string) => (Array.isArray(departments) ? departments.find((d: any) => d.id === id)?.name : '') ?? '';

  // Selectable TARGET departments for QUERY/HELP — fetched per type, never from
  // departmentsApi.getAll() (which is scoped to the caller's own/managed
  // department(s) for every non-admin role — exactly the list a QUERY/HELP
  // requester must NOT be limited to, since the whole point is asking a
  // department they don't belong to).
  const [targetDepartmentsByType, setTargetDepartmentsByType] = useState<Record<string, any[]>>({});
  const loadingTargetDeptTypes = useRef<Set<string>>(new Set());
  useEffect(() => {
    const types = new Set<string>();
    rows.forEach((row) => { if (row.type !== 'TASK') types.add(row.type); });
    types.forEach((type) => {
      if (targetDepartmentsByType[type] || loadingTargetDeptTypes.current.has(type)) return;
      loadingTargetDeptTypes.current.add(type);
      ticketsApi.getRoutingDepartments(type as 'QUERY' | 'HELP')
        .then((depts: any) => {
          setTargetDepartmentsByType((prev) => ({ ...prev, [type]: Array.isArray(depts) ? depts : [] }));
          // Safe to clear here too: targetDepartmentsByType[type] is now populated,
          // so the guard above already blocks a re-fetch via its other branch.
          loadingTargetDeptTypes.current.delete(type);
        })
        .catch((error: any) => {
          // Never cache a failure as "[]" — that would look identical to a
          // legitimately empty department list and permanently block retries.
          console.error('[tickets/new] Failed to load routing departments', { type, error });
          loadingTargetDeptTypes.current.delete(type);
        });
    });
  }, [rows, targetDepartmentsByType]);
  const targetDepartmentsFor = (type: RequestType): any[] => targetDepartmentsByType[type] ?? [];

  // QUERY/HELP routing recipients — fetched per (type, targetDepartmentId) combination,
  // never from usersApi.getAll(). The backend applies its own role-based visibility
  // (e.g. Employee/Intern QUERY is funneled to TL/Manager of the target department),
  // so the options this returns are already exactly what the current user may pick.
  const [routingOptionsByKey, setRoutingOptionsByKey] = useState<Record<string, any[]>>({});
  const loadingRoutingKeys = useRef<Set<string>>(new Set());
  useEffect(() => {
    const keys = new Set<string>();
    rows.forEach((row) => {
      if (row.type !== 'TASK' && row.targetDepartmentId) {
        keys.add(`${row.type}:${row.targetDepartmentId}`);
      }
    });
    keys.forEach((key) => {
      if (routingOptionsByKey[key] || loadingRoutingKeys.current.has(key)) return;
      loadingRoutingKeys.current.add(key);
      const [type, targetDepartmentId] = key.split(':');
      ticketsApi.getRoutingOptions(type as 'QUERY' | 'HELP', targetDepartmentId)
        .then((options: any) => setRoutingOptionsByKey((prev) => ({ ...prev, [key]: Array.isArray(options) ? options : [] })))
        .catch(() => setRoutingOptionsByKey((prev) => ({ ...prev, [key]: [] })));
    });
  }, [rows, routingOptionsByKey]);
  const routingOptionsFor = (type: RequestType, targetDepartmentId: string): any[] =>
    routingOptionsByKey[`${type}:${targetDepartmentId}`] ?? [];

  // ── Global defaults handlers ─────────────────────────────────────────────────
  const setGlobal = (field: GlobalField, value: string) => {
    setGlobalDefaults((g) => {
      const next = { ...g, [field]: value };
      if (field === 'departmentId') { next.taskTypeId = ''; next.taskSubtypeId = ''; }
      if (field === 'taskTypeId') { next.taskSubtypeId = ''; }
      return next;
    });
    // Propagate to rows that still inherit this field (not user-customized).
    setRows((rs) => rs.map((row) => {
      if (row.custom[field]) return row;
      const patch: Partial<TicketRow> = { [field]: value } as any;
      if (field === 'departmentId') {
        patch.taskTypeId = ''; patch.taskSubtypeId = '';
        patch.assigneeIds = row.type === 'TASK' ? (lockAssignee ? row.assigneeIds : []) : row.assigneeIds;
        patch.custom = { ...row.custom, taskTypeId: false, taskSubtypeId: false };
      }
      if (field === 'taskTypeId') {
        patch.taskSubtypeId = '';
        patch.custom = { ...row.custom, taskSubtypeId: false };
      }
      return { ...row, ...patch, errors: [] };
    }));
  };

  // ── Row handlers ─────────────────────────────────────────────────────────────
  const patchRow = (key: string, patch: Partial<TicketRow>) =>
    setRows((rs) => rs.map((row) => (row.key === key ? { ...row, ...patch, errors: [] } : row)));

  const setRowField = (key: string, field: keyof TicketRow, value: any) => {
    setRows((rs) => rs.map((row) => {
      if (row.key !== key) return row;
      const patch: any = { [field]: value, errors: [] };
      if ((GLOBAL_FIELDS as readonly string[]).includes(field as string)) {
        patch.custom = { ...row.custom, [field]: true };
      }
      return { ...row, ...patch };
    }));
  };

  const changeRowDepartment = (key: string, value: string) =>
    setRows((rs) => rs.map((row) => (row.key === key ? {
      ...row,
      departmentId: value,
      taskTypeId: '', taskSubtypeId: '', customSubtype: '',
      // Requesting-department change only clears the TASK assignee list (dept-scoped);
      // QUERY/HELP recipients are chosen from the separate Target Department, unaffected.
      assigneeIds: row.type === 'TASK' ? (lockAssignee ? row.assigneeIds : []) : row.assigneeIds,
      custom: { ...row.custom, departmentId: true, taskTypeId: false, taskSubtypeId: false },
      errors: [],
    } : row)));

  // Switching Request Type resets the fields that only make sense for the previous
  // type: TASK's department-scoped assignee vs QUERY/HELP's target department + routed
  // recipient. Prevents e.g. a QUERY's cross-department pick silently surviving a
  // switch back to TASK.
  const changeRowType = (key: string, type: RequestType) =>
    setRows((rs) => rs.map((row) => (row.key === key ? {
      ...row,
      type,
      targetDepartmentId: '',
      assigneeIds: (isEmployee && type === 'TASK' && user?.id) ? [user.id] : [],
      errors: [],
    } : row)));

  // Changing the target department invalidates whatever recipient was picked for
  // the PREVIOUS target department (routing-options is keyed by targetDepartmentId,
  // so a stale assigneeIds selection would silently point at someone in the wrong
  // department otherwise).
  const changeRowTargetDepartment = (key: string, targetDepartmentId: string) =>
    setRows((rs) => rs.map((row) => (row.key === key ? {
      ...row,
      targetDepartmentId,
      assigneeIds: [],
      errors: [],
    } : row)));

  const changeRowTaskType = (key: string, value: string) =>
    setRows((rs) => rs.map((row) => (row.key === key ? {
      ...row, taskTypeId: value, taskSubtypeId: '', customSubtype: '',
      custom: { ...row.custom, taskTypeId: true, taskSubtypeId: false }, errors: [],
    } : row)));

  const addRow = () => setRows((rs) => [...rs, makeRow()]);
  const duplicateRow = (key: string) => setRows((rs) => {
    const idx = rs.findIndex((r) => r.key === key);
    if (idx === -1) return rs;
    const copy: TicketRow = { ...rs[idx], key: newKey(), errors: [], aiReason: '', aiBusy: false };
    return [...rs.slice(0, idx + 1), copy, ...rs.slice(idx + 1)];
  });
  const removeRow = (key: string) => setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.key !== key)));

  const suggestPriority = async (key: string) => {
    const row = rows.find((r) => r.key === key);
    if (!row || !row.title.trim()) { toast.error('Enter a title first'); return; }
    patchRow(key, { aiBusy: true, aiReason: '' });
    try {
      const result = await aiApi.suggestPriority(row.title, row.description) as any;
      if (result?.priority) {
        setRows((rs) => rs.map((r) => (r.key === key
          ? { ...r, priority: result.priority, custom: { ...r.custom, priority: true }, aiReason: result.reason ?? '', aiBusy: false }
          : r)));
        if (!result.disabled) toast.success(`AI suggests: ${result.priority}`, { icon: '✨' });
      } else {
        patchRow(key, { aiBusy: false, aiReason: result?.reason ?? '' });
      }
    } catch {
      patchRow(key, { aiBusy: false });
    }
  };

  // ── Validation + payload ─────────────────────────────────────────────────────
  const validateRow = (row: TicketRow): string[] => {
    const e: string[] = [];
    if (!row.title.trim()) e.push('Title is required');
    if (!row.departmentId) e.push('Department is required');
    if (!row.taskTypeId) e.push('Task Type is required');
    if (row.type !== 'TASK' && !row.targetDepartmentId) e.push('Target Department is required');
    if (!isSelfLockedRow(row) && row.assigneeIds.length === 0) e.push(`${labelFor(row.type, 'assignee')} is required`);
    if (!row.dueDate) e.push('Due Date is required');
    if (row.taskSubtypeId === '__custom__' && !row.customSubtype.trim()) e.push('Custom subtype text is required');
    // Start (scheduledStartAt) must not be after Due, and the advanced Scheduled End
    // must be after Start. Compare as real instants so timezone is respected.
    const startIso = combineDueDateTime(row.startDate, row.startTime);
    const dueIso = combineDueDateTime(row.dueDate, row.dueTime);
    if (startIso && dueIso && new Date(startIso).getTime() > new Date(dueIso).getTime()) {
      e.push('Start Date/Time cannot be after Due Date/Time');
    }
    if (row.scheduledEndAt && startIso) {
      const endIso = localDateTimeInputToIso(row.scheduledEndAt);
      if (endIso && new Date(endIso).getTime() <= new Date(startIso).getTime()) {
        e.push('Scheduled End must be after the Start Date/Time');
      }
    }
    return e;
  };

  const rowToPayload = (row: TicketRow) => {
    const estTotal = (parseInt(row.estHours || '0', 10) || 0) * 60 + (parseInt(row.estMinutes || '0', 10) || 0);
    const isCustom = row.taskSubtypeId === '__custom__';
    return {
      type: row.type,
      title: row.title.trim(),
      description: row.description.trim() || undefined,
      category: 'OPERATIONS',
      departmentId: row.departmentId || undefined,
      taskTypeId: row.taskTypeId || undefined,
      taskSubtypeId: (!isCustom && row.taskSubtypeId) ? row.taskSubtypeId : undefined,
      customSubtypeText: isCustom ? (row.customSubtype.trim() || undefined) : undefined,
      assignedToId: row.assigneeIds[0] || (isSelfLockedRow(row) ? user?.id : undefined) || undefined,
      assigneeIds: row.assigneeIds.length ? row.assigneeIds : (isSelfLockedRow(row) && user?.id ? [user.id] : undefined),
      // Cross-department routing target — backend derives requestingDepartmentId/
      // isCrossDepartment/team ids from this + departmentId; TASK never sends it.
      targetDepartmentId: row.type !== 'TASK' ? (row.targetDepartmentId || undefined) : undefined,
      priority: row.priority,
      dueDate: combineDueDateTime(row.dueDate, row.dueTime),
      estimatedMinutes: estTotal > 0 ? estTotal : undefined,
      projectId: row.projectId || undefined,
      // Start Date + Start Time → scheduledStartAt (same timezone-safe combiner as Due;
      // date-only start uses the system's 18:30 IST convention, exactly like Due Date).
      scheduledStartAt: combineDueDateTime(row.startDate, row.startTime),
      scheduledEndAt: localDateTimeInputToIso(row.scheduledEndAt),
      scheduledNote: row.notes.trim() || undefined,
    };
  };

  const handleBack = () => router.push(fromUrl ? decodeURIComponent(fromUrl) : '/tickets');

  const applyRowErrors = (rowErrors: { row: number; error: string }[]) => {
    setRows((rs) => rs.map((row, i) => {
      const match = rowErrors.find((re) => re.row === i + 1);
      return match ? { ...row, errors: match.error.split('; ') } : row;
    }));
  };

  const onSuccess = (created: any[]) => {
    const ids = created.map((t: any) => t.ticketId).filter(Boolean);
    const summary = created.length === 1
      ? `Created ticket ${ids[0] ?? ''}`.trim()
      : `Created ${created.length} tickets: ${ids.join(', ')}`;
    toast.success(summary, { duration: 6000 });
    qc.invalidateQueries({ queryKey: ['tickets'] });
    if (created.length === 1 && created[0]?.id) {
      router.push(fromUrl ? decodeURIComponent(fromUrl) : `/tickets/${created[0].id}`);
    } else {
      router.push(fromUrl ? decodeURIComponent(fromUrl) : '/tickets');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    // Validate every row first; surface row-level errors without creating anything.
    const validated = rows.map((row) => ({ ...row, errors: validateRow(row) }));
    setRows(validated);
    const invalid = validated.filter((r) => r.errors.length > 0);
    if (invalid.length > 0) {
      toast.error(`Fix ${invalid.length} ticket${invalid.length > 1 ? 's' : ''} before creating`);
      return;
    }

    setSubmitting(true);
    try {
      const payloads = rows.map(rowToPayload);
      const created = await ticketsApi.createBulk(payloads) as any[];
      onSuccess(created);
    } catch (err: any) {
      if (Array.isArray(err?.errors)) {
        applyRowErrors(err.errors);
        toast.error(err.message || 'Some rows are invalid — no tickets were created');
      } else {
        toast.error(err?.message || 'Failed to create tickets');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ── Excel import ─────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [importing, setImporting] = useState(false);

  const downloadTemplate = async () => {
    try { await ticketsApi.downloadImportTemplate(); }
    catch { toast.error('Could not download the template'); }
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    setImporting(true);
    try {
      const result = await ticketsApi.previewImport(file) as any;
      setPreview(result);
    } catch (err: any) {
      toast.error(err?.message || 'Could not read that file');
    } finally {
      setImporting(false);
    }
  };

  const createFromPreview = async () => {
    if (!preview || preview.errorCount > 0 || submitting) return;
    setSubmitting(true);
    try {
      const payloads = preview.rows.map((row: any) => row.payload);
      const created = await ticketsApi.createBulk(payloads) as any[];
      setPreview(null);
      onSuccess(created);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create tickets from the file');
    } finally {
      setSubmitting(false);
    }
  };

  const submitLabel = rows.length === 1 ? 'Create Ticket' : `Create ${rows.length} Tickets`;
  const inputCls = 'apex-input';
  const labelCls = 'apex-label';
  const sectionCls = 'text-xs font-semibold uppercase tracking-wider pb-1.5 mb-3 border-b';

  return (
    <div className="max-w-4xl mx-auto pb-10">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={handleBack} className="p-2 rounded-lg transition-colors"
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
          <ArrowLeft size={18} style={{ color: 'var(--text-secondary)' }} />
        </button>
        <div className="flex-1">
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Create Tickets</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Add one or many tickets — each becomes its own ticket ID</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={downloadTemplate}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition-colors"
            style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}>
            <Download size={13} /> Download Excel Template
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={importing}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}>
            {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Import from Excel
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFilePicked} />
        </div>
      </div>

      {preselectedProjectName && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm mb-3"
          style={{ backgroundColor: 'var(--color-info-bg)', border: '1px solid rgba(59,130,246,0.3)', color: 'var(--color-info)' }}>
          <span>New tickets will link to project: <strong>{preselectedProjectName}</strong></span>
        </div>
      )}

      {/* ── Global Defaults ─────────────────────────────────────────────────── */}
      <div className="apex-card p-5 mb-4">
        <p className={sectionCls} style={{ color: 'var(--text-tertiary)', borderColor: 'var(--border-subtle)' }}>
          Global Defaults <span className="font-normal normal-case tracking-normal">— applied to new rows; rows you customize keep their own value</span>
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Department</label>
            {lockDept ? (
              <input readOnly value={deptName(myDeptId) || 'Your department'} className="apex-input cursor-not-allowed"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }} />
            ) : (
              <select value={globalDefaults.departmentId} onChange={(e) => setGlobal('departmentId', e.target.value)} className={inputCls}>
                <option value="">Select…</option>
                {Array.isArray(departments) && departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className={labelCls}>Task Type</label>
            <select value={globalDefaults.taskTypeId} onChange={(e) => setGlobal('taskTypeId', e.target.value)} className={inputCls}
              disabled={!globalDefaults.departmentId}>
              <option value="">{globalDefaults.departmentId ? 'None' : 'Pick department first'}</option>
              {taskTypesFor(globalDefaults.departmentId).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Subtype</label>
            <select value={globalDefaults.taskSubtypeId} onChange={(e) => setGlobal('taskSubtypeId', e.target.value)} className={inputCls}
              disabled={!globalDefaults.taskTypeId || subtypesFor(globalDefaults.departmentId, globalDefaults.taskTypeId).length === 0}>
              <option value="">None</option>
              {subtypesFor(globalDefaults.departmentId, globalDefaults.taskTypeId).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Priority</label>
            <select value={globalDefaults.priority} onChange={(e) => setGlobal('priority', e.target.value)} className={cn(inputCls, 'font-medium', PRIORITY_COLORS[globalDefaults.priority])}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="col-span-2 md:col-span-1">
            <label className={labelCls}>Project</label>
            <select value={globalDefaults.projectId} onChange={(e) => setGlobal('projectId', e.target.value)} className={inputCls}>
              <option value="">No project</option>
              {projectList.map((p: any) => <option key={p.id} value={p.id}>{p.projectId} — {p.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* ── Ticket rows ─────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {rows.map((row, idx) => {
          const rowTaskTypes = taskTypesFor(row.departmentId);
          const rowSubtypes = subtypesFor(row.departmentId, row.taskTypeId);
          const rowUsers = usersFor(row.departmentId);
          const rowRoutingUsers = row.type !== 'TASK' ? routingOptionsFor(row.type, row.targetDepartmentId) : [];
          return (
            <div key={row.key} className="apex-card p-5" style={row.errors.length ? { borderColor: 'var(--color-danger)', borderWidth: 1 } : undefined}>
              {/* Row header */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold px-2.5 py-1 rounded-md" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                  Ticket {idx + 1}
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => duplicateRow(row.key)} title="Duplicate This Ticket"
                    className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-md transition-colors" style={{ color: 'var(--text-tertiary)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                    <Copy size={13} /> Duplicate This Ticket
                  </button>
                  <button type="button" onClick={() => removeRow(row.key)} disabled={rows.length <= 1} title="Remove"
                    className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-red-500"
                    onMouseEnter={(e) => { if (rows.length > 1) e.currentTarget.style.backgroundColor = 'var(--color-danger-bg)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
                    <Trash2 size={13} /> Remove
                  </button>
                </div>
              </div>

              {/* Request Type */}
              <div className="flex flex-wrap gap-2 mb-4">
                {REQUEST_TYPES.map((t) => (
                  <button key={t} type="button" onClick={() => changeRowType(row.key, t)}
                    className={cn('px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                      row.type === t ? 'border-indigo-400 text-indigo-600 bg-indigo-50' : '')}
                    style={row.type === t ? undefined : { borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
                    title={TYPE_META[t].hint}>
                    {TYPE_META[t].label}
                  </button>
                ))}
                <span className="self-center text-xs" style={{ color: 'var(--text-tertiary)' }}>{TYPE_META[row.type].hint}</span>
              </div>


              {/* Title + Description */}
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>{labelFor(row.type, 'title')} *</label>
                  <input type="text" value={row.title} onChange={(e) => setRowField(row.key, 'title', e.target.value)} className={inputCls}
                    placeholder="Short summary…" />
                </div>
                <div>
                  <label className={labelCls}>Description</label>
                  <textarea value={row.description} onChange={(e) => setRowField(row.key, 'description', e.target.value)} className={`${inputCls} resize-none`} rows={2} placeholder="More detail (optional)…" />
                </div>

                {/* Department / Task Type / Subtype */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>Department *</label>
                    {lockDept ? (
                      <input readOnly value={deptName(row.departmentId) || 'Your department'} className="apex-input cursor-not-allowed"
                        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }} />
                    ) : (
                      <select value={row.departmentId} onChange={(e) => changeRowDepartment(row.key, e.target.value)} className={inputCls}>
                        <option value="">Select…</option>
                        {Array.isArray(departments) && departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>{labelFor(row.type, 'taskType')} *</label>
                    <select value={row.taskTypeId} onChange={(e) => changeRowTaskType(row.key, e.target.value)} className={inputCls} disabled={!row.departmentId}>
                      <option value="">{row.departmentId ? 'Select…' : 'Pick department first'}</option>
                      {rowTaskTypes.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Subtype</label>
                    {row.taskTypeId && rowSubtypes.length > 0 ? (
                      <>
                        <select value={row.taskSubtypeId} onChange={(e) => setRowField(row.key, 'taskSubtypeId', e.target.value)} className={inputCls}>
                          <option value="">None</option>
                          {rowSubtypes.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          <option value="__custom__">Custom…</option>
                        </select>
                        {row.taskSubtypeId === '__custom__' && (
                          <input type="text" value={row.customSubtype} onChange={(e) => setRowField(row.key, 'customSubtype', e.target.value)}
                            className={`${inputCls} mt-2`} placeholder="Describe the subtype…" maxLength={80} />
                        )}
                      </>
                    ) : (
                      <input readOnly value="—" className="apex-input cursor-not-allowed" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }} />
                    )}
                  </div>
                </div>

                {/* Target Department — QUERY/HELP only. Separate from the Department field
                    above, which stays the requesting department (task-type scoping, own-dept
                    lock rules unchanged). Sourced from the unscoped routing-departments
                    endpoint (every department in the company), NOT departmentsApi.getAll()
                    (scoped to the caller's own/managed department). Picking a target
                    department loads that department's routable people from the backend,
                    replacing the TASK assignee dropdown. */}
                {row.type !== 'TASK' && (
                  <div>
                    <label className={labelCls}>{row.type === 'QUERY' ? 'Target Department' : 'Help From Department'} *</label>
                    <select value={row.targetDepartmentId}
                      onChange={(e) => changeRowTargetDepartment(row.key, e.target.value)}
                      className={inputCls}>
                      <option value="">Select…</option>
                      {targetDepartmentsFor(row.type).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>
                )}

                {/* Assignee + Priority */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>{labelFor(row.type, 'assignee')} {!isSelfLockedRow(row) && '*'}</label>
                    {isSelfLockedRow(row) ? (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm"
                        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                        <span>👤</span><span>Assigned to you</span>
                      </div>
                    ) : (
                      <MultiSelect
                        options={(row.type === 'TASK' ? rowUsers : rowRoutingUsers).map((u: any) => ({ value: u.id, label: u.name, sublabel: formatRole(u.role), avatar: u.avatar }))}
                        value={row.assigneeIds}
                        onChange={(v) => setRowField(row.key, 'assigneeIds', v)}
                        disabled={row.type !== 'TASK' && !row.targetDepartmentId}
                        placeholder={
                          row.type === 'TASK'
                            ? (row.departmentId ? 'Select…' : 'Pick department first')
                            : (row.targetDepartmentId ? 'Select…' : 'Pick target department first')
                        }
                      />
                    )}
                    {!isSelfLockedRow(row) && row.assigneeIds.length > 0 && <LeaveWarning assigneeIds={row.assigneeIds} />}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Priority *</label>
                      <button type="button" onClick={() => suggestPriority(row.key)} disabled={row.aiBusy || !row.title.trim()}
                        className="flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-md border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed">
                        {row.aiBusy ? <><Loader2 size={11} className="animate-spin" /> …</> : <><Sparkles size={11} /> Suggest</>}
                      </button>
                    </div>
                    <select value={row.priority} onChange={(e) => setRowField(row.key, 'priority', e.target.value)} className={cn(inputCls, 'font-medium', PRIORITY_COLORS[row.priority])}>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    {row.aiReason && <p className="mt-1 text-xs flex items-start gap-1" style={{ color: 'var(--text-tertiary)' }}><Sparkles size={10} className="text-indigo-400 mt-0.5" /> {row.aiReason}</p>}
                  </div>
                </div>

                {/* Start date/time + Due date/time */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className={labelCls}>Start Date</label>
                    <input type="date" value={row.startDate} onChange={(e) => setRowField(row.key, 'startDate', e.target.value)} className={inputCls} min={new Date().toISOString().split('T')[0]} />
                  </div>
                  <div>
                    <label className={labelCls}>Start Time</label>
                    <input type="time" value={row.startTime} onChange={(e) => setRowField(row.key, 'startTime', e.target.value)} className={inputCls} disabled={!row.startDate} />
                  </div>
                  <div>
                    <label className={labelCls}>{labelFor(row.type, 'due')} *</label>
                    <input type="date" value={row.dueDate} onChange={(e) => setRowField(row.key, 'dueDate', e.target.value)} className={inputCls} min={row.startDate || new Date().toISOString().split('T')[0]} />
                  </div>
                  <div>
                    <label className={labelCls}>Due Time</label>
                    <input type="time" value={row.dueTime} onChange={(e) => setRowField(row.key, 'dueTime', e.target.value)} className={inputCls} />
                  </div>
                </div>

                {/* Estimated Time + Project */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>{labelFor(row.type, 'estimate')}</label>
                    <div className="flex items-center gap-1">
                      <input type="number" min="0" max="99" value={row.estHours} onChange={(e) => setRowField(row.key, 'estHours', e.target.value)} className={inputCls} placeholder="0" />
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>h</span>
                      <select value={row.estMinutes} onChange={(e) => setRowField(row.key, 'estMinutes', e.target.value)} className={inputCls}>
                        {EST_MINUTE_STEPS.map((m) => <option key={m} value={m === 0 ? '' : String(m)}>{m}</option>)}
                      </select>
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>m</span>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Project</label>
                    <select value={row.projectId} onChange={(e) => setRowField(row.key, 'projectId', e.target.value)} className={inputCls}>
                      <option value="">No project</option>
                      {projectList.map((p: any) => <option key={p.id} value={p.id}>{p.projectId} — {p.name}</option>)}
                    </select>
                  </div>
                </div>

                {/* Advanced scheduling */}
                <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'var(--border-subtle)' }}>
                  <button type="button" onClick={() => patchRow(row.key, { showAdvanced: !row.showAdvanced })}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    <span className="flex items-center gap-2"><Clock size={13} style={{ color: 'var(--text-tertiary)' }} /> Advanced Scheduling</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>{row.showAdvanced ? '▲' : '▼'}</span>
                  </button>
                  {row.showAdvanced && (
                    <div className="px-3 pb-3 pt-1 border-t grid grid-cols-1 md:grid-cols-2 gap-3" style={{ borderColor: 'var(--border-subtle)' }}>
                      {/* Start Date/Time live in the basic fields above; this is the optional
                          end of the scheduled window. */}
                      <div>
                        <label className={labelCls}>Scheduled End</label>
                        <input type="datetime-local" value={row.scheduledEndAt} onChange={(e) => setRowField(row.key, 'scheduledEndAt', e.target.value)} className={inputCls} min={new Date().toISOString().slice(0, 16)} />
                      </div>
                      <div>
                        <label className={labelCls}>Notes</label>
                        <input type="text" value={row.notes} onChange={(e) => setRowField(row.key, 'notes', e.target.value)} className={inputCls} placeholder="Internal note (optional)…" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Row errors */}
                {row.errors.length > 0 && (
                  <div className="px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
                    {row.errors.map((er, i) => <p key={i}>⚠ {er}</p>)}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Add row */}
        <button type="button" onClick={addRow}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed text-sm font-medium transition-colors"
          style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
          <Plus size={16} /> + Add Another Ticket
        </button>

        {/* Submit */}
        <div className="flex items-center gap-3 pt-1">
          <button type="submit" disabled={submitting}
            className="apex-btn-primary flex-1 font-semibold py-2.5 flex items-center justify-center gap-2 disabled:opacity-50">
            {submitting ? <><Loader2 size={16} className="animate-spin" /> Creating…</> : submitLabel}
          </button>
          <button type="button" onClick={handleBack}
            className="flex-1 text-center border font-medium py-2.5 rounded-lg transition-colors text-sm"
            style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
            Cancel
          </button>
        </div>
      </form>

      {/* ── Import preview overlay ──────────────────────────────────────────── */}
      {preview && (
        <ImportPreview
          preview={preview}
          submitting={submitting}
          onClose={() => setPreview(null)}
          onCreate={createFromPreview}
        />
      )}
    </div>
  );
}

// ─── Leave warning (per row) ─────────────────────────────────────────────────
function LeaveWarning({ assigneeIds }: { assigneeIds: string[] }) {
  const { data: teamStatus } = useQuery({ queryKey: ['workday-team'], queryFn: () => workdayApi.getTeam() as Promise<any[]>, staleTime: 60000 });
  const onLeave = (Array.isArray(teamStatus) ? teamStatus : []).filter(
    (m: any) => assigneeIds.includes(m.id) && (m.onLeaveToday || m.workStatus === 'ON_LEAVE'));
  if (onLeave.length === 0) return null;
  return (
    <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
      {onLeave.map((m: any) => (
        <p key={m.id} className="text-xs text-amber-700"><span className="text-amber-500">⚠</span> <strong>{m.name}</strong> is on approved leave today.</p>
      ))}
    </div>
  );
}

// ─── Import preview table ────────────────────────────────────────────────────
function ImportPreview({ preview, submitting, onClose, onCreate }: {
  preview: any; submitting: boolean; onClose: () => void; onCreate: () => void;
}) {
  const canCreate = preview.errorCount === 0 && preview.totalRows > 0 && !submitting;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="apex-card w-full max-w-5xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Import Preview</h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {preview.totalRows} row{preview.totalRows !== 1 ? 's' : ''} · {preview.validCount} valid · {preview.errorCount} with errors
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg" style={{ color: 'var(--text-tertiary)' }}><X size={18} /></button>
        </div>

        <div className="overflow-auto flex-1 px-5 py-3">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left" style={{ color: 'var(--text-tertiary)' }}>
                <th className="py-2 pr-3 font-medium">#</th>
                <th className="py-2 pr-3 font-medium">Type</th>
                <th className="py-2 pr-3 font-medium">Title</th>
                <th className="py-2 pr-3 font-medium">Department</th>
                <th className="py-2 pr-3 font-medium">Task Type</th>
                <th className="py-2 pr-3 font-medium">Assignee</th>
                <th className="py-2 pr-3 font-medium">Priority</th>
                <th className="py-2 pr-3 font-medium">Due</th>
                <th className="py-2 pr-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row: any) => (
                <tr key={row.row} className="border-t align-top" style={{ borderColor: 'var(--border-subtle)' }}>
                  <td className="py-2 pr-3" style={{ color: 'var(--text-tertiary)' }}>{row.row}</td>
                  <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>{row.display.type}</td>
                  <td className="py-2 pr-3" style={{ color: 'var(--text-primary)' }}>{row.display.title || <span style={{ color: 'var(--color-danger)' }}>—</span>}</td>
                  <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>{row.display.department || '—'}</td>
                  <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>{row.display.taskType || '—'}</td>
                  <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>{row.display.assignee || '—'}</td>
                  <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>{row.display.priority}</td>
                  <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>{row.display.dueDate || '—'}</td>
                  <td className="py-2 pr-3">
                    {row.valid
                      ? <span className="text-xs font-medium text-green-600">✓ Ready</span>
                      : <span className="text-xs font-medium" style={{ color: 'var(--color-danger)' }}>⚠ {row.error}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {preview.errorCount > 0
              ? `Fix ${preview.errorCount} row${preview.errorCount > 1 ? 's' : ''} in your file and re-import — it's all-or-nothing.`
              : 'All rows are valid and ready to create.'}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="border font-medium py-2 px-4 rounded-lg text-sm" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>Cancel</button>
            <button onClick={onCreate} disabled={!canCreate}
              className="apex-btn-primary font-semibold py-2 px-4 rounded-lg text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
              {submitting ? <><Loader2 size={14} className="animate-spin" /> Creating…</> : `Create All Tickets${preview.validCount ? ` (${preview.validCount})` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
