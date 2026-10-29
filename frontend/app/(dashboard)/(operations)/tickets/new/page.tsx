'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { aiApi, taskTypesApi, workdayApi } from '@/lib/api';
import { usersApi } from '@apex/core-users/api';
import { ticketsApi, ticketTemplatesApi } from '@apex/operations-tickets-lifecycle/api';
import { departmentsApi } from '@apex/core-organization-departments/api';
import { projectsApi } from '@apex/operations-projects/api';
import { useAuthStore } from '@apex/core-identity';
import toast from 'react-hot-toast';
import { ArrowLeft, Sparkles, Loader2, Clock, Plus, Copy, Trash2, Download, Upload, X, Settings2 } from 'lucide-react';
import { TicketDefaultsPanel, DEFAULT_TICKET_DEFAULTS, readTicketDefaults, type TicketDefaults } from '@/components/settings/TicketDefaultsPanel';
import { formatRole } from '@apex/operations-tickets-lifecycle/shared/ticket-vocabulary';
import { cn } from '@apex/shared-utilities';
import { MultiSelect } from '@apex/shared-ui/components/multi-select';
import { useTicketCreationGate } from '@apex/operations-tickets-lifecycle/components/ticket-creation-gate';
import {
  isActiveWorkdayRequiredError,
  PUNCH_IN_TO_CREATE_MESSAGE,
  WORKDAY_TODAY_QUERY_KEY,
} from '@apex/operations-tickets-lifecycle/shared/ticket-creation-gate';
import {
  companyDateTimeLocalToIso,
  companyPlanningNow,
  companyWallClockToIso,
  withStartDate,
} from '@apex/operations-tickets-lifecycle/shared/ticket-planning-date';
import {
  NO_RECURRENCE,
  RECURRENCE_END_PRESETS,
  RECURRENCE_OPTIONS,
  recurrencePayload,
  type RecurrenceChoice,
} from '@apex/operations-tickets-lifecycle/shared/ticket-recurrence';
import { draftRowFrom } from '@apex/operations-tickets-lifecycle/shared/ticket-nav-state';
import { useTicketNavState } from '@apex/operations-tickets-lifecycle/components/use-ticket-nav-state';
import { QuickTicketTags, type QuickTicketTagsHandle, type QuickTicketTemplate } from '@apex/operations-tickets-lifecycle/components/quick-ticket-tags';

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

// Date / time inputs carry no timezone. They are company wall-clock values
// (Asia/Kolkata), the same on every browser, like the Excel import: a date +
// time is read in the company timezone, and a date alone keeps the system
// convention (18:30 IST = 13:00 UTC).
const localDateTimeInputToIso = companyDateTimeLocalToIso;
const combineDueDateTime = companyWallClockToIso;

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
  outputTargetMinutes: string;
  startDate: string;
  startTime: string;
  dueDate: string;
  dueTime: string;
  estHours: string;
  estMinutes: string;
  projectId: string;
  scheduledEndAt: string;
  notes: string;
  recurrence: RecurrenceChoice;
  showAdvanced: boolean;
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
  const canAssignAcrossDepartments = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);
  const myDeptId = user?.department?.id ?? '';
  const lockDept = isTL || isEmployee;     // department fixed to own dept
  const lockAssignee = isEmployee;          // always self-assigned — TASK only, see isSelfLockedRow
  const [ticketDefaults, setTicketDefaults] = useState<TicketDefaults>(DEFAULT_TICKET_DEFAULTS);
  const [showTicketDefaults, setShowTicketDefaults] = useState(false);
  // Employee/Intern self-assign applies to TASK rows only — QUERY/HELP are requests
  // directed at someone else (often in another department), so a row's type decides
  // whether the self-lock actually applies, not just the creator's role.
  const isSelfLockedRow = (row: TicketRow) => lockAssignee && row.type === 'TASK';

  const makeRow = (): TicketRow => ({
    key: newKey(),
    type: 'TASK',
    title: '', description: '',
    departmentId: lockDept ? myDeptId : '',
    taskTypeId: '',
    taskSubtypeId: '',
    customSubtype: '',
    assigneeIds: (lockAssignee || (ticketDefaults.autoAssign && lockDept && myDeptId)) && user?.id ? [user.id] : [],
    targetDepartmentId: '',
    priority: ticketDefaults.defaultPriority,
    outputTargetMinutes: '',
    // Planning default: now, in company time. Editable and clearable; it starts
    // no timer and never sets actualStartAt (the ticket is created OPEN).
    startDate: companyPlanningNow().date, startTime: companyPlanningNow().time,
    dueDate: '', dueTime: '',
    estHours: '', estMinutes: '',
    projectId: preselectedProjectId,
    scheduledEndAt: '',
    notes: '',
    recurrence: NO_RECURRENCE,
    showAdvanced: false,
    errors: [],
  });

  const [rows, setRows] = useState<TicketRow[]>([makeRow()]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let mounted = true;
    usersApi.getPreferences().then((raw: any) => {
      if (!mounted) return;
      const defaults = readTicketDefaults(raw);
      setTicketDefaults(defaults);
      setRows((current) => current.map((row) => row.title || row.description || row.notes || row.priority !== 'MEDIUM' || (row.assigneeIds.length > 0 && !(lockAssignee && row.assigneeIds.length === 1 && row.assigneeIds[0] === user.id))
        ? row : { ...row, priority: defaults.defaultPriority, assigneeIds: (lockAssignee || (defaults.autoAssign && lockDept && myDeptId)) ? [user.id] : [] }));
    }).catch(() => { /* Keep safe defaults if the preference service is unavailable. */ });
    return () => { mounted = false; };
  }, [user?.id, lockAssignee, lockDept, myDeptId]);

  // ── Unsaved draft (this tab, 30 minutes) ───────────────────────────────────
  // Only the non-text fields survive navigation and refresh: type, priority,
  // dates, estimate, recurrence and selected ids. Title, description, notes
  // and the custom subtype text are never stored. Submit or Cancel clears it.
  const draftPath = `/tickets/new${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  const draft = useTicketNavState('ticket-new', draftPath, user?.id);
  const draftLoaded = useRef(false);
  useEffect(() => {
    if (!draft.checked || draftLoaded.current) return;
    draftLoaded.current = true;
    const saved = draft.restored;
    if (!saved) return;
    setRows(saved.rows.map((d) => {
      const row: TicketRow = {
        ...makeRow(), ...d, recurrence: { ...d.recurrence } as RecurrenceChoice,
        departmentId: lockDept ? myDeptId : d.departmentId,
      };
      if (isSelfLockedRow(row) && user?.id) row.assigneeIds = [user.id];
      return row;
    }));
  }, [draft.checked]); // eslint-disable-line react-hooks/exhaustive-deps
  // Runs on mount (skipped: nothing loaded yet) and then when rows change.
  useEffect(() => {
    if (!draftLoaded.current) return;
    draft.save({ rows: rows.map((r) => draftRowFrom(r)) });
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  // Creation needs an active workday. The backend enforces it; this mirrors
  // its answer so the page says why instead of failing on submit.
  const creationGate = useTicketCreationGate();
  const canCreate = creationGate.allowed;

  // ── Reference data ─────────────────────────────────────────────────────────
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: () => departmentsApi.getAll() as Promise<any[]> });
  const { data: projectsRaw } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.getAll() as Promise<any> });
  const { data: usersData } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.getAll() as Promise<any> });
  const { data: creationAssigneesData } = useQuery({
    queryKey: ['ticket-creation-assignees'],
    queryFn: () => ticketsApi.getCreationAssignees() as Promise<any[]>,
    enabled: canAssignAcrossDepartments,
  });
  const { data: quickTagsData } = useQuery({
    queryKey: ['quick-ticket-templates'],
    queryFn: () => ticketTemplatesApi.list() as Promise<any>,
  });

  const projectList = useMemo(() => {
    if (!projectsRaw) return [];
    if (Array.isArray(projectsRaw)) return projectsRaw;
    if (Array.isArray(projectsRaw?.projects)) return projectsRaw.projects;
    return [];
  }, [projectsRaw]);
  const userList: any[] = usersData?.users ?? (Array.isArray(usersData) ? usersData : []);
  const creationAssignees: any[] = Array.isArray(creationAssigneesData) ? creationAssigneesData : [];

  // Task types are dept-scoped and rows can span departments, so fetch per dept on demand.
  const [taskTypesByDept, setTaskTypesByDept] = useState<Record<string, any[]>>({});
  const loadingDepts = useRef<Set<string>>(new Set());
  const ensureTaskTypes = useCallback((departmentId: string) => {
    if (!departmentId || taskTypesByDept[departmentId] || loadingDepts.current.has(departmentId)) return;
    loadingDepts.current.add(departmentId);
    taskTypesApi.getByDepartment(departmentId)
      .then((taskTypes: any) => {
        setTaskTypesByDept((previous) => ({
          ...previous,
          [departmentId]: Array.isArray(taskTypes) ? taskTypes : [],
        }));
      })
      .catch(() => {
        setTaskTypesByDept((previous) => ({ ...previous, [departmentId]: [] }));
      })
      .finally(() => loadingDepts.current.delete(departmentId));
  }, [taskTypesByDept]);

  useEffect(() => {
    const deptIds = new Set<string>();
    rows.forEach((row) => { if (row.departmentId) deptIds.add(row.departmentId); });
    (quickTagsData?.templates ?? []).forEach((template: any) => {
      if (template.departmentId) deptIds.add(template.departmentId);
    });
    deptIds.forEach(ensureTaskTypes);
  }, [rows, quickTagsData, ensureTaskTypes]);

  const taskTypesFor = (deptId: string): any[] => taskTypesByDept[deptId] ?? [];
  const subtypesFor = (deptId: string, taskTypeId: string): any[] =>
    taskTypesFor(deptId).find((t: any) => t.id === taskTypeId)?.subtypes ?? [];
  const usersFor = (deptId: string): any[] => {
    if (canAssignAcrossDepartments) return creationAssignees;
    const scoped = deptId ? userList.filter((u: any) => u.departmentId === deptId) : userList;
    if (isEmployee) return scoped.filter((u: any) => u.id === user?.id);
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

  // ── Row handlers ─────────────────────────────────────────────────────────────
  const patchRow = (key: string, patch: Partial<TicketRow>) =>
    setRows((rs) => rs.map((row) => (row.key === key ? { ...row, ...patch, errors: [] } : row)));

  const setRowField = (key: string, field: keyof TicketRow, value: any) => {
    setRows((rs) => rs.map((row) => {
      if (row.key !== key) return row;
      const patch: any = { [field]: value, errors: [] };
      // Clearing Start Date clears Start Time too: a time needs a day.
      if (field === 'startDate') patch.startTime = withStartDate(row, value).startTime;
      return { ...row, ...patch };
    }));
  };

  const changeRowDepartment = (key: string, value: string) =>
    setRows((rs) => rs.map((row) => (row.key === key ? {
      ...row,
      departmentId: value,
      taskTypeId: '', taskSubtypeId: '', customSubtype: '',
      outputTargetMinutes: '',
      // Requesting-department change only clears the TASK assignee list (dept-scoped);
      // QUERY/HELP recipients are chosen from the separate Target Department, unaffected.
      assigneeIds: row.type === 'TASK' ? (lockAssignee || (ticketDefaults.autoAssign && value === myDeptId && user?.id) ? [user!.id] : []) : row.assigneeIds,
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
      outputTargetMinutes: type === 'TASK' ? row.outputTargetMinutes : '',
      assigneeIds: ((isEmployee || (ticketDefaults.autoAssign && row.departmentId === myDeptId)) && type === 'TASK' && user?.id) ? [user.id] : [],
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
      ...row, taskTypeId: value, taskSubtypeId: '', customSubtype: '', errors: [],
    } : row)));

  const addRow = () => setRows((rs) => [...rs, makeRow()]);
  const duplicateRow = (key: string) => setRows((rs) => {
    const idx = rs.findIndex((r) => r.key === key);
    if (idx === -1) return rs;
    const copy: TicketRow = { ...rs[idx], key: newKey(), errors: [], aiReason: '', aiBusy: false };
    return [...rs.slice(0, idx + 1), copy, ...rs.slice(idx + 1)];
  });
  const removeRow = (key: string) => setRows((rs) => (rs.length <= 1 ? rs : rs.filter((r) => r.key !== key)));

  const hasMeaningfulTicketData = rows.length > 1 || rows.some((row) =>
    Boolean(
      row.title.trim() || row.description.trim() || row.dueDate || row.dueTime ||
      row.estHours || row.estMinutes || row.notes.trim() || row.scheduledEndAt ||
      row.outputTargetMinutes || row.targetDepartmentId || row.recurrence.mode !== 'none' ||
      (!isSelfLockedRow(row) && row.assigneeIds.length > 0)
    ),
  );

  // The template editor may start from the parent ticket's current selections,
  // but these values are not applied to other ticket rows. Additional tickets
  // remain independent unless the user explicitly duplicates a ticket.
  const quickTagInitialDefaults = useMemo(() => {
    const parent = rows[0];
    return {
      departmentId: parent?.departmentId ?? (lockDept ? myDeptId : ''),
      taskTypeId: parent?.taskTypeId ?? '',
      taskSubtypeId: parent?.taskSubtypeId ?? '',
      priority: parent?.priority ?? 'MEDIUM',
      projectId: parent?.projectId ?? preselectedProjectId,
    };
  }, [rows, lockDept, myDeptId, preselectedProjectId]);

  const applyQuickTag = (template: QuickTicketTemplate) => {
    setRows((current) => current.map((row, index) => index !== 0 ? row : {
      ...row,
      type: 'TASK',
      title: template.title,
      description: template.description ?? '',
      departmentId: template.departmentId,
      taskTypeId: template.taskTypeId,
      taskSubtypeId: template.taskSubtypeId ?? '',
      customSubtype: '',
      assigneeIds: template.assigneeIds ?? [],
      targetDepartmentId: '',
      priority: template.priority ?? 'MEDIUM',
      outputTargetMinutes: '',
      startDate: '',
      startTime: '',
      dueDate: '',
      dueTime: '',
      estHours: template.estimatedMinutes ? String(Math.floor(template.estimatedMinutes / 60)) : '',
      estMinutes: template.estimatedMinutes ? String(template.estimatedMinutes % 60) : '',
      projectId: template.projectId ?? '',
      scheduledEndAt: '',
      notes: '',
      recurrence: NO_RECURRENCE,
      showAdvanced: false,
      errors: [],
    }));
    toast.success(`Applied Default Ticket: ${template.name}`);
  };

  const suggestPriority = async (key: string) => {
    const row = rows.find((r) => r.key === key);
    if (!row || !row.title.trim()) { toast.error('Enter a title first'); return; }
    patchRow(key, { aiBusy: true, aiReason: '' });
    try {
      const result = await aiApi.suggestPriority(row.title, row.description) as any;
      if (result?.priority) {
        setRows((rs) => rs.map((r) => (r.key === key
          ? { ...r, priority: result.priority, aiReason: result.reason ?? '', aiBusy: false }
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
    if (row.outputTargetMinutes) {
      const outputMinutes = Number(row.outputTargetMinutes);
      if (!Number.isInteger(outputMinutes) || outputMinutes < 1 || outputMinutes > 1440) {
        e.push('Minutes of output per day must be a whole number from 1 to 1440');
      }
    }
    if (row.recurrence.mode === 'custom_time' && !row.recurrence.oneTimeAt) e.push('Pick the reminder date and time');
    if (row.recurrence.mode !== 'none' && row.recurrence.mode !== 'custom_time' &&
        row.recurrence.endPreset === 'custom' && !row.recurrence.endDate) e.push('Pick the date the reminders end');
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
      outputTargetMinutes: row.outputTargetMinutes ? Number(row.outputTargetMinutes) : undefined,
      dueDate: combineDueDateTime(row.dueDate, row.dueTime),
      estimatedMinutes: estTotal > 0 ? estTotal : undefined,
      projectId: row.projectId || undefined,
      // Start Date + Start Time → scheduledStartAt (same timezone-safe combiner as Due;
      // date-only start uses the system's 18:30 IST convention, exactly like Due Date).
      scheduledStartAt: combineDueDateTime(row.startDate, row.startTime),
      scheduledEndAt: localDateTimeInputToIso(row.scheduledEndAt),
      scheduledNote: row.notes.trim() || undefined,
      // Existing reminder schedule fields (scheduler + ticket page already use them).
      ...recurrencePayload(row.recurrence),
    };
  };

  const handleBack = () => router.push(fromUrl ? decodeURIComponent(fromUrl) : '/tickets');
  const handleCancel = () => { draft.clear(); handleBack(); };

  const applyRowErrors = (rowErrors: { row: number; error: string }[]) => {
    setRows((rs) => rs.map((row, i) => {
      const match = rowErrors.find((re) => re.row === i + 1);
      return match ? { ...row, errors: match.error.split('; ') } : row;
    }));
  };

  const onSuccess = (created: any[]) => {
    draft.clear();
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

  const handleActiveWorkdayRequired = (err: any): boolean => {
    if (!isActiveWorkdayRequiredError(err)) return false;
    toast.error(err?.message || PUNCH_IN_TO_CREATE_MESSAGE);
    qc.invalidateQueries({ queryKey: WORKDAY_TODAY_QUERY_KEY });
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !canCreate) return;

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
      if (handleActiveWorkdayRequired(err)) return;
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
  const defaultTicketsRef = useRef<QuickTicketTagsHandle>(null);
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
    if (!preview || preview.errorCount > 0 || submitting || !canCreate) return;
    setSubmitting(true);
    try {
      const payloads = preview.rows.map((row: any) => row.payload);
      const created = await ticketsApi.createBulk(payloads) as any[];
      setPreview(null);
      onSuccess(created);
    } catch (err: any) {
      if (handleActiveWorkdayRequired(err)) return;
      toast.error(err?.message || 'Failed to create tickets from the file');
    } finally {
      setSubmitting(false);
    }
  };

  const submitLabel = rows.length === 1 ? 'Create Ticket' : `Create ${rows.length} Tickets`;
  const inputCls = 'apex-input';
  const labelCls = 'apex-label';

  return (
    <div className="w-full px-[10px] md:px-[50px] pb-10">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <button onClick={handleBack} className="p-2 rounded-lg transition-colors"
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}>
          <ArrowLeft size={18} style={{ color: 'var(--text-secondary)' }} />
        </button>
        <div className="flex-1">
          <h2 className="apex-page-title text-xl" style={{ color: 'var(--text-primary)' }}>Create Tickets</h2>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={() => setShowTicketDefaults((value) => !value)} className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }} aria-expanded={showTicketDefaults}><Settings2 size={14} /> My ticket defaults</button>
          <button type="button" onClick={() => defaultTicketsRef.current?.openCreate()}
            className="apex-btn-primary flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg transition-colors">
            <Plus size={13} /> Create Default Tickets
          </button>
          <button type="button" onClick={downloadTemplate}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition-colors"
            style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}>
            <Download size={13} /> Download Excel Template
          </button>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={importing || !canCreate}
            title={!canCreate ? creationGate.reason ?? undefined : undefined}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}>
            {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Import from Excel
          </button>
          <input ref={fileInputRef} id="ticket-import-file" name="ticketImportFile" aria-label="Import tickets from an Excel file" type="file" accept=".xlsx,.xls" className="hidden" onChange={onFilePicked} />
        </div>
      </div>

      {showTicketDefaults && <TicketDefaultsPanel value={ticketDefaults} onSaved={setTicketDefaults} onClose={() => setShowTicketDefaults(false)} />}

      {!canCreate && creationGate.reason && (
        <div role="status" className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm mb-3"
          style={{ backgroundColor: 'var(--color-warning-bg, rgba(245,158,11,0.1))', border: '1px solid rgba(245,158,11,0.35)', color: 'var(--color-warning, #b45309)' }}>
          <Clock size={14} />
          <span>{creationGate.reason}</span>
        </div>
      )}

      {preselectedProjectName && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm mb-3"
          style={{ backgroundColor: 'var(--color-info-bg)', border: '1px solid rgba(59,130,246,0.3)', color: 'var(--color-info)' }}>
          <span>New tickets will link to project: <strong>{preselectedProjectName}</strong></span>
        </div>
      )}

      <QuickTicketTags
        ref={defaultTicketsRef}
        departments={Array.isArray(departments) ? departments : []}
        projects={projectList}
        assigneesFor={usersFor}
        departmentLocked={lockDept}
        assigneeLocked={lockAssignee}
        taskTypesFor={taskTypesFor}
        ensureTaskTypes={ensureTaskTypes}
        currentUser={user}
        initialDefaults={quickTagInitialDefaults}
        hasExistingData={hasMeaningfulTicketData}
        onApply={applyQuickTag}
      />

      {/* ── Ticket rows ─────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {rows.map((row, idx) => {
          const rowTaskTypes = taskTypesFor(row.departmentId);
          const rowSubtypes = subtypesFor(row.departmentId, row.taskTypeId);
          const rowUsers = usersFor(row.departmentId);
          const rowRoutingUsers = row.type !== 'TASK' ? routingOptionsFor(row.type, row.targetDepartmentId) : [];
          // Unique per row: every control gets an id, a name and a label pointing at it.
          const fid = (field: string) => `${row.key}-${field}`;
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
                  <label className={labelCls} htmlFor={fid('title')}>{labelFor(row.type, 'title')} *</label>
                  <input id={fid('title')} name={fid('title')} type="text" value={row.title} onChange={(e) => setRowField(row.key, 'title', e.target.value)} className={inputCls}
                    placeholder="Short summary…" />
                </div>
                <div>
                  <label className={labelCls} htmlFor={fid('description')}>Description</label>
                  <textarea id={fid('description')} name={fid('description')} value={row.description} onChange={(e) => setRowField(row.key, 'description', e.target.value)} className={`${inputCls} resize-none`} rows={2} placeholder="More detail (optional)…" />
                </div>

                {/* Department / Task Type / Subtype */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls} htmlFor={fid('department')}>Department *</label>
                    {lockDept ? (
                      <input id={fid('department')} name={fid('department')} readOnly value={deptName(row.departmentId) || 'Your department'} className="apex-input cursor-not-allowed"
                        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }} />
                    ) : (
                      <select id={fid('department')} name={fid('department')} value={row.departmentId} onChange={(e) => changeRowDepartment(row.key, e.target.value)} className={inputCls}>
                        <option value="">Select…</option>
                        {Array.isArray(departments) && departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className={labelCls} htmlFor={fid('task-type')}>{labelFor(row.type, 'taskType')} *</label>
                    <select id={fid('task-type')} name={fid('task-type')} value={row.taskTypeId} onChange={(e) => changeRowTaskType(row.key, e.target.value)} className={inputCls} disabled={!row.departmentId}>
                      <option value="">{row.departmentId ? 'Select…' : 'Pick department first'}</option>
                      {rowTaskTypes.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls} htmlFor={fid('subtype')}>Subtype</label>
                    {row.taskTypeId && rowSubtypes.length > 0 ? (
                      <>
                        <select id={fid('subtype')} name={fid('subtype')} value={row.taskSubtypeId} onChange={(e) => setRowField(row.key, 'taskSubtypeId', e.target.value)} className={inputCls}>
                          <option value="">None</option>
                          {rowSubtypes.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          <option value="__custom__">Custom…</option>
                        </select>
                        {row.taskSubtypeId === '__custom__' && (
                          <input id={fid('custom-subtype')} name={fid('custom-subtype')} aria-label="Custom subtype" type="text" value={row.customSubtype} onChange={(e) => setRowField(row.key, 'customSubtype', e.target.value)}
                            className={`${inputCls} mt-2`} placeholder="Describe the subtype…" maxLength={80} />
                        )}
                      </>
                    ) : (
                      <input id={fid('subtype')} name={fid('subtype')} readOnly value="—" className="apex-input cursor-not-allowed" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }} />
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
                    <label className={labelCls} htmlFor={fid('target-department')}>{row.type === 'QUERY' ? 'Target Department' : 'Help From Department'} *</label>
                    <select id={fid('target-department')} name={fid('target-department')} value={row.targetDepartmentId}
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
                    <label className={labelCls} htmlFor={isSelfLockedRow(row) ? undefined : fid('assignees')}>{labelFor(row.type, 'assignee')} {!isSelfLockedRow(row) && '*'}</label>
                    {isSelfLockedRow(row) ? (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm"
                        style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                        <span>👤</span><span>Assigned to you</span>
                      </div>
                    ) : (
                      <MultiSelect
                        id={fid('assignees')}
                        name={fid('assignees')}
                        label={labelFor(row.type, 'assignee')}
                        options={(row.type === 'TASK' ? rowUsers : rowRoutingUsers).map((u: any) => ({
                          value: u.id,
                          label: u.name,
                          sublabel: [formatRole(u.role), u.departmentName].filter(Boolean).join(' • '),
                          avatar: u.avatar,
                        }))}
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
                      <label htmlFor={fid('priority')} className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Priority *</label>
                      <button type="button" onClick={() => suggestPriority(row.key)} disabled={row.aiBusy || !row.title.trim()}
                        className="flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-md border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed">
                        {row.aiBusy ? <><Loader2 size={11} className="animate-spin" /> …</> : <><Sparkles size={11} /> Suggest</>}
                      </button>
                    </div>
                    <select id={fid('priority')} name={fid('priority')} value={row.priority} onChange={(e) => setRowField(row.key, 'priority', e.target.value)} className={cn(inputCls, 'font-medium', PRIORITY_COLORS[row.priority])}>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    {row.aiReason && <p className="mt-1 text-xs flex items-start gap-1" style={{ color: 'var(--text-tertiary)' }}><Sparkles size={10} className="text-indigo-400 mt-0.5" /> {row.aiReason}</p>}
                  </div>
                </div>

                {row.type === 'TASK' && ['content', 'content sales'].includes(deptName(row.departmentId).trim().toLowerCase()) && (
                  <div>
                    <label className={labelCls} htmlFor={fid('output-minutes')}>Minutes of output per day (optional)</label>
                    <input
                      id={fid('output-minutes')}
                      name={fid('output-minutes')}
                      type="number"
                      min={1}
                      max={1440}
                      step={1}
                      value={row.outputTargetMinutes}
                      onChange={(e) => setRowField(row.key, 'outputTargetMinutes', e.target.value)}
                      className={inputCls}
                      placeholder="1 to 1440"
                    />
                    <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>Output target only; this does not change estimates, timers, SLA, review, or rework.</p>
                  </div>
                )}

                {/* Start date/time + Due date/time */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className={labelCls} htmlFor={fid('start-date')}>Start Date</label>
                    <input id={fid('start-date')} name={fid('start-date')} type="date" value={row.startDate} onChange={(e) => setRowField(row.key, 'startDate', e.target.value)} className={inputCls} min={companyPlanningNow().date} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor={fid('start-time')}>Start Time</label>
                    <input id={fid('start-time')} name={fid('start-time')} type="time" value={row.startTime} onChange={(e) => setRowField(row.key, 'startTime', e.target.value)} className={inputCls} disabled={!row.startDate} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor={fid('due-date')}>{labelFor(row.type, 'due')} *</label>
                    <input id={fid('due-date')} name={fid('due-date')} type="date" value={row.dueDate} onChange={(e) => setRowField(row.key, 'dueDate', e.target.value)} className={inputCls} min={row.startDate || companyPlanningNow().date} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor={fid('due-time')}>Due Time</label>
                    <input id={fid('due-time')} name={fid('due-time')} type="time" value={row.dueTime} onChange={(e) => setRowField(row.key, 'dueTime', e.target.value)} className={inputCls} />
                  </div>
                </div>

                {/* Estimated Time + Project */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls} htmlFor={fid('estimated-hours')}>{labelFor(row.type, 'estimate')}</label>
                    <div className="flex items-center gap-1">
                      <input id={fid('estimated-hours')} name={fid('estimated-hours')} aria-label={`${labelFor(row.type, 'estimate')} hours`} type="number" min="0" max="99" value={row.estHours} onChange={(e) => setRowField(row.key, 'estHours', e.target.value)} className={inputCls} placeholder="0" />
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>h</span>
                      <select id={fid('estimated-minutes')} name={fid('estimated-minutes')} aria-label={`${labelFor(row.type, 'estimate')} minutes`} value={row.estMinutes} onChange={(e) => setRowField(row.key, 'estMinutes', e.target.value)} className={inputCls}>
                        {EST_MINUTE_STEPS.map((m) => <option key={m} value={m === 0 ? '' : String(m)}>{m}</option>)}
                      </select>
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>m</span>
                    </div>
                  </div>
                  <div>
                    <label className={labelCls} htmlFor={fid('project')}>Project</label>
                    <select id={fid('project')} name={fid('project')} value={row.projectId} onChange={(e) => setRowField(row.key, 'projectId', e.target.value)} className={inputCls}>
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
                        <label className={labelCls} htmlFor={fid('scheduled-end')}>Scheduled End</label>
                        <input id={fid('scheduled-end')} name={fid('scheduled-end')} type="datetime-local" value={row.scheduledEndAt} onChange={(e) => setRowField(row.key, 'scheduledEndAt', e.target.value)} className={inputCls} min={`${companyPlanningNow().date}T${companyPlanningNow().time}`} />
                      </div>
                      <div>
                        <label className={labelCls} htmlFor={fid('notes')}>Notes</label>
                        <input id={fid('notes')} name={fid('notes')} type="text" value={row.notes} onChange={(e) => setRowField(row.key, 'notes', e.target.value)} className={inputCls} placeholder="Internal note (optional)…" />
                      </div>
                      {/* Reminder schedule — the existing recurrence the scheduler already runs. */}
                      <div>
                        <label className={labelCls} htmlFor={`${row.key}-recurrence`}>Reminder schedule</label>
                        <select id={`${row.key}-recurrence`} name={`${row.key}-recurrence`} value={row.recurrence.mode}
                          onChange={(e) => setRowField(row.key, 'recurrence', { ...row.recurrence, mode: e.target.value })}
                          className={inputCls}>
                          {RECURRENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      {row.recurrence.mode === 'custom_time' ? (
                        <div>
                          <label className={labelCls} htmlFor={`${row.key}-remind-at`}>Remind at</label>
                          <input id={`${row.key}-remind-at`} name={`${row.key}-remind-at`} type="datetime-local" value={row.recurrence.oneTimeAt}
                            onChange={(e) => setRowField(row.key, 'recurrence', { ...row.recurrence, oneTimeAt: e.target.value })}
                            className={inputCls} min={`${companyPlanningNow().date}T${companyPlanningNow().time}`} />
                        </div>
                      ) : row.recurrence.mode !== 'none' ? (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className={labelCls} htmlFor={`${row.key}-remind-until`}>Remind until</label>
                            <select id={`${row.key}-remind-until`} name={`${row.key}-remind-until`} value={row.recurrence.endPreset}
                              onChange={(e) => setRowField(row.key, 'recurrence', { ...row.recurrence, endPreset: e.target.value })}
                              className={inputCls}>
                              {RECURRENCE_END_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                            </select>
                          </div>
                          {row.recurrence.endPreset === 'custom' && (
                            <div>
                              <label className={labelCls} htmlFor={`${row.key}-remind-end`}>End date</label>
                              <input id={`${row.key}-remind-end`} name={`${row.key}-remind-end`} type="date" value={row.recurrence.endDate}
                                onChange={(e) => setRowField(row.key, 'recurrence', { ...row.recurrence, endDate: e.target.value })}
                                className={inputCls} min={companyPlanningNow().date} />
                            </div>
                          )}
                        </div>
                      ) : null}
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
          <button type="submit" disabled={submitting || !canCreate}
            title={!canCreate ? creationGate.reason ?? undefined : undefined}
            className="apex-btn-primary flex-1 font-semibold py-2.5 flex items-center justify-center gap-2 disabled:opacity-50">
            {submitting ? <><Loader2 size={16} className="animate-spin" /> Creating…</> : submitLabel}
          </button>
          <button type="button" onClick={handleCancel}
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
          submitting={submitting || !canCreate}
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
