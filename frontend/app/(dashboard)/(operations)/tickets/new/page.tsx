'use client';

import { useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ticketsApi, projectsApi, departmentsApi, usersApi, aiApi, taskTypesApi, workdayApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import toast from 'react-hot-toast';
import { ArrowLeft, Sparkles, Loader2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MultiSelect } from '@/components/ui/multi-select';

// ─── Leave Warning ────────────────────────────────────────────────────────────
function LeaveWarning({ assigneeIds, users }: { assigneeIds: string[]; users: any[] }) {
  const { data: teamStatus } = useQuery({
    queryKey: ['workday-team'],
    queryFn: () => workdayApi.getTeam() as Promise<any[]>,
    staleTime: 60000,
  });

  const onLeave = (Array.isArray(teamStatus) ? teamStatus : []).filter(
    (m: any) => assigneeIds.includes(m.id) && (m.onLeaveToday || m.workStatus === 'ON_LEAVE'),
  );

  if (onLeave.length === 0) return null;

  return (
    <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
      {onLeave.map((m: any) => (
        <p key={m.id} className="text-xs text-amber-700 flex items-center gap-1.5">
          <span className="text-amber-500">&#9888;</span>
          <strong>{m.name}</strong> is on approved leave today. Are you sure you want to assign this task?
        </p>
      ))}
    </div>
  );
}

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'text-slate-500',
  MEDIUM: 'text-blue-600',
  HIGH: 'text-orange-600',
  URGENT: 'text-red-600',
};

export default function NewTicketPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromUrl = searchParams.get('from');
  const preselectedProjectId = searchParams.get('projectId');
  const preselectedProjectName = searchParams.get('projectName')
    ? decodeURIComponent(searchParams.get('projectName')!)
    : null;
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const roleName = (user?.role as any)?.name ?? user?.role ?? '';
  const isTL       = roleName === 'TEAM_LEAD';
  const isEmployee = roleName === 'EMPLOYEE' || roleName === 'INTERN';
  const myDeptId   = user?.department?.id ?? '';

  const [form, setForm] = useState({
    title: '',
    description: '',
    // category is a required DB enum — hidden from UI, always sent as OPERATIONS
    category: 'OPERATIONS',
    // type has DB default TASK — hidden from UI, always sent as TASK
    type: 'TASK',
    priority: 'MEDIUM',
    estimatedMinutes: '',
    // Pre-fill dept for TL / Employee; manager/admin start empty (must choose)
    departmentId: (isTL || isEmployee) ? myDeptId : '',
    projectId: preselectedProjectId || '',
    // Pre-fill self for Employee/Intern
    assignedToId: isEmployee ? (user?.id ?? '') : '',
    dueDate: '',
    scheduledFor: '',
    scheduledNote: '',
    scheduledStartAt: '',
    scheduledEndAt: '',
  });

  // Advanced Scheduling collapsed by default
  const [showAdvancedSchedule, setShowAdvancedSchedule] = useState(false);

  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    isEmployee && user?.id ? [user.id] : [],
  );

  const [aiReason, setAiReason] = useState<string>('');
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiDisabled, setAiDisabled] = useState(false);

  const [taskTypeId, setTaskTypeId] = useState('');
  const [taskSubtypeId, setTaskSubtypeId] = useState('');
  const [customSubtype, setCustomSubtype] = useState('');

  const [scheduleRecurring, setScheduleRecurring] = useState('none');
  const [customScheduleAt, setCustomScheduleAt] = useState('');
  const [scheduleEndPreset, setScheduleEndPreset] = useState('1_month');
  const [scheduleEndDate, setScheduleEndDate] = useState('');

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll() as Promise<any[]>,
  });
  const { data: projectsRaw } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getAll() as Promise<any>,
  });
  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll() as Promise<any>,
  });

  // Task types scoped strictly to the selected department.
  // For TL/Employee, form.departmentId is pre-filled with myDeptId so this
  // always resolves correctly without silently falling back to the user's own dept
  // in cases where a manager hasn't chosen one yet.
  const { data: taskTypesRaw } = useQuery({
    queryKey: ['task-types', form.departmentId],
    queryFn: () => taskTypesApi.getByDepartment(form.departmentId),
    enabled: !!form.departmentId,
    staleTime: 5 * 60 * 1000,
  });
  const taskTypes: any[] = Array.isArray(taskTypesRaw) ? taskTypesRaw : [];
  const selectedTaskType = taskTypes.find((t: any) => t.id === taskTypeId);

  const projectList = useMemo(() => {
    if (!projectsRaw) return [];
    if (Array.isArray(projectsRaw)) return projectsRaw;
    if (Array.isArray(projectsRaw?.projects)) return projectsRaw.projects;
    return [];
  }, [projectsRaw]);

  const userList: any[] = usersData?.users ?? (Array.isArray(usersData) ? usersData : []);

  // For TL: show only own-dept users. For Employee/Intern: self + TL.
  const filteredUsers = (() => {
    const deptFiltered = form.departmentId
      ? userList.filter((u: any) => u.departmentId === form.departmentId)
      : userList;
    if (isEmployee) {
      return deptFiltered.filter(
        (u: any) => u.id === user?.id || u.role?.name === 'TEAM_LEAD',
      );
    }
    return deptFiltered;
  })();

  const handleBack = () => {
    if (fromUrl) {
      router.push(decodeURIComponent(fromUrl));
    } else {
      router.push('/tickets');
    }
  };

  const mutation = useMutation({
    mutationFn: (data: any) => ticketsApi.create(data),
    onSuccess: (ticket: any) => {
      toast.success(`Ticket ${ticket.ticketId} created!`);
      qc.invalidateQueries({ queryKey: ['tickets'] });
      if (fromUrl) {
        router.push(decodeURIComponent(fromUrl));
      } else {
        router.push(`/tickets/${ticket.id}`);
      }
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to create ticket'),
  });

  const computeEndDate = () => {
    if (scheduleRecurring === 'none') return undefined;
    if (scheduleEndPreset === 'custom') return scheduleEndDate ? new Date(scheduleEndDate).toISOString() : undefined;
    const now = new Date();
    const presetMap: Record<string, number> = {
      '1_week': 7, '1_month': 30, '3_months': 90, '6_months': 180,
    };
    const days = presetMap[scheduleEndPreset] ?? 30;
    now.setDate(now.getDate() + days);
    return now.toISOString();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim())   return toast.error('Title is required');
    if (!form.departmentId)   return toast.error('Department is required');
    if (!taskTypeId)          return toast.error('Task Type is required');
    if (!isEmployee && assigneeIds.length === 0) return toast.error('At least one assignee is required');
    if (!form.dueDate)        return toast.error('Due Date is required');

    const isCustomSubtype = taskSubtypeId === '__custom__';
    mutation.mutate({
      ...form,
      type: 'TASK',
      category: form.category,
      description: form.description,
      estimatedTime: undefined,
      estimatedMinutes: form.estimatedMinutes ? parseInt(form.estimatedMinutes) : undefined,
      projectId: form.projectId || undefined,
      assignedToId: assigneeIds[0] || form.assignedToId || undefined,
      assigneeIds: assigneeIds.length > 0 ? assigneeIds : undefined,
      departmentId: form.departmentId || undefined,
      // Normalize date-only inputs to 18:30 IST (13:00 UTC)
      dueDate: form.dueDate
        ? (form.dueDate.includes('T') ? form.dueDate : `${form.dueDate}T13:00:00.000Z`)
        : undefined,
      scheduledFor: scheduleRecurring === 'custom_time' && customScheduleAt
        ? new Date(customScheduleAt).toISOString()
        : (form.scheduledFor ? new Date(form.scheduledFor).toISOString() : undefined),
      scheduledNote: form.scheduledNote || undefined,
      scheduleRecurring: (scheduleRecurring !== 'none' && scheduleRecurring !== 'custom_time') ? scheduleRecurring : undefined,
      scheduleEndDate: computeEndDate(),
      taskTypeId: taskTypeId || undefined,
      taskSubtypeId: (!isCustomSubtype && taskSubtypeId) ? taskSubtypeId : undefined,
      customSubtypeText: isCustomSubtype ? (customSubtype.trim() || undefined) : undefined,
      scheduledStartAt: form.scheduledStartAt
        ? (form.scheduledStartAt.includes('T') ? form.scheduledStartAt : `${form.scheduledStartAt}T13:00:00.000Z`)
        : undefined,
      scheduledEndAt: form.scheduledEndAt
        ? (form.scheduledEndAt.includes('T') ? form.scheduledEndAt : `${form.scheduledEndAt}T13:00:00.000Z`)
        : undefined,
    });
  };

  const handleSuggestPriority = async () => {
    if (!form.title.trim()) {
      toast.error('Enter a title first');
      return;
    }
    setAiSuggesting(true);
    setAiReason('');
    try {
      const result = await aiApi.suggestPriority(form.title, form.description) as any;
      if (result?.disabled) {
        setAiDisabled(true);
        setAiReason(result.reason ?? 'AI features coming soon.');
        if (result.priority) setForm((f) => ({ ...f, priority: result.priority }));
      } else if (result?.priority) {
        setForm((f) => ({ ...f, priority: result.priority }));
        setAiReason(result.reason ?? '');
        toast.success(`AI suggests: ${result.priority}`, { icon: '✨' });
      }
    } catch {
      // Silent — backend always returns a payload; real errors are rare.
    } finally {
      setAiSuggesting(false);
    }
  };

  const set = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key === 'priority') setAiReason('');
  };

  const inputCls = 'apex-input';
  const labelCls = 'apex-label';
  const sectionCls = 'text-xs font-semibold uppercase tracking-wider pb-1.5 mb-3 border-b';

  return (
    <div className="max-w-2xl mx-auto">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={handleBack}
          className="p-2 rounded-lg transition-colors"
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          <ArrowLeft size={18} style={{ color: 'var(--text-secondary)' }} />
        </button>
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Create New Ticket</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Report an issue, request, or task</p>
        </div>
      </div>

      {preselectedProjectName && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm mb-2"
          style={{ backgroundColor: 'var(--color-info-bg)', border: '1px solid rgba(59,130,246,0.3)', color: 'var(--color-info)' }}>
          <span>Creating ticket for project: <strong>{preselectedProjectName}</strong></span>
          <button
            type="button"
            onClick={() => setForm(f => ({ ...f, projectId: '' }))}
            className="ml-auto text-blue-400 hover:text-blue-600"
          >
            ×
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="apex-card p-6 space-y-6">

        {/* ── 1. BASIC DETAILS ─────────────────────────────────────────────── */}
        <div>
          <p className={sectionCls} style={{ color: 'var(--text-tertiary)', borderColor: 'var(--border-subtle)' }}>
            Basic Details
          </p>
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Title *</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                className={inputCls}
                placeholder="e.g., Replace light bulb in IT Room 3B"
                required
              />
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                className={`${inputCls} resize-none`}
                placeholder="Detailed description of the issue or request..."
                rows={4}
              />
            </div>
          </div>
        </div>

        {/* ── 2. CLASSIFICATION ────────────────────────────────────────────── */}
        <div>
          <p className={sectionCls} style={{ color: 'var(--text-tertiary)', borderColor: 'var(--border-subtle)' }}>
            Classification
          </p>
          <div className="space-y-4">

            {/* Department */}
            <div>
              <label className={labelCls}>
                Department *
                {(isTL || isEmployee) && (
                  <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>(your dept)</span>
                )}
              </label>
              {(isTL || isEmployee) ? (
                <input
                  readOnly
                  value={Array.isArray(departments)
                    ? (departments.find((d: any) => d.id === myDeptId)?.name ?? 'Your department')
                    : 'Your department'}
                  className="apex-input cursor-not-allowed"
                  style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}
                />
              ) : (
                <select
                  value={form.departmentId}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, departmentId: e.target.value, assignedToId: '' }));
                    setTaskTypeId('');
                    setTaskSubtypeId('');
                  }}
                  className={inputCls}
                >
                  <option value="">Select department…</option>
                  {Array.isArray(departments) && departments.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Task Type + Subtype (subtype conditional) */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Task Type *</label>
                <select
                  value={taskTypeId}
                  onChange={(e) => { setTaskTypeId(e.target.value); setTaskSubtypeId(''); setCustomSubtype(''); }}
                  className={inputCls}
                  disabled={!form.departmentId}
                >
                  <option value="">
                    {form.departmentId ? 'Select task type…' : 'Select a department first'}
                  </option>
                  {taskTypes.map((t: any) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {!form.departmentId && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    Choose a department to load its task types
                  </p>
                )}
              </div>
              {taskTypeId && selectedTaskType?.subtypes?.length > 0 ? (
                <div>
                  <label className={labelCls}>Subtype</label>
                  <select
                    value={taskSubtypeId}
                    onChange={(e) => { setTaskSubtypeId(e.target.value); if (e.target.value !== '__custom__') setCustomSubtype(''); }}
                    className={inputCls}
                  >
                    <option value="">Select subtype…</option>
                    {selectedTaskType.subtypes.map((s: any) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                    <option value="__custom__">Custom…</option>
                  </select>
                  {taskSubtypeId === '__custom__' && (
                    <input
                      type="text"
                      value={customSubtype}
                      onChange={(e) => setCustomSubtype(e.target.value)}
                      className={`${inputCls} mt-2`}
                      placeholder="Describe the subtype…"
                      autoFocus
                      maxLength={80}
                    />
                  )}
                </div>
              ) : <div />}
            </div>

            {/* Priority */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Priority *</label>
                  {aiDisabled ? (
                    <span
                      className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border border-slate-200 text-slate-400 bg-slate-50"
                      title="AI features will be enabled once configured"
                    >
                      <Sparkles size={11} /> AI coming soon
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSuggestPriority}
                      disabled={aiSuggesting || !form.title.trim()}
                      className={cn(
                        'flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors',
                        'border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed',
                      )}
                      title="Let AI suggest a priority based on your title and description"
                    >
                      {aiSuggesting
                        ? <><Loader2 size={11} className="animate-spin" /> Thinking…</>
                        : <><Sparkles size={11} /> Suggest</>}
                    </button>
                  )}
                </div>
                <select
                  value={form.priority}
                  onChange={(e) => set('priority', e.target.value)}
                  className={cn(inputCls, 'font-medium', PRIORITY_COLORS[form.priority])}
                >
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                {aiReason && (
                  <p className="mt-1.5 text-xs text-slate-400 flex items-start gap-1">
                    <Sparkles size={10} className="text-indigo-400 mt-0.5 flex-shrink-0" />
                    <span>{aiReason}</span>
                  </p>
                )}
              </div>
              <div />
            </div>
          </div>
        </div>

        {/* ── 3. WORK PLANNING ─────────────────────────────────────────────── */}
        <div>
          <p className={sectionCls} style={{ color: 'var(--text-tertiary)', borderColor: 'var(--border-subtle)' }}>
            Work Planning
          </p>
          <div className="space-y-4">

            {/* Assign To + Due Date */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Assign To *</label>
                {isEmployee ? (
                  <div
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm"
                    style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                  >
                    <span className="text-base">👤</span>
                    <span>This ticket will be assigned to you</span>
                  </div>
                ) : (
                  <>
                    <MultiSelect
                      options={filteredUsers.map((u: any) => ({
                        value: u.id,
                        label: u.name,
                        sublabel: u.role?.name ?? u.role,
                        avatar: u.avatar,
                      }))}
                      value={assigneeIds}
                      onChange={setAssigneeIds}
                      placeholder="Select assignees..."
                    />
                    {assigneeIds.length > 0 && (
                      <LeaveWarning assigneeIds={assigneeIds} users={userList} />
                    )}
                  </>
                )}
              </div>
              <div>
                <label className={labelCls}>Due Date *</label>
                <input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => set('dueDate', e.target.value)}
                  className={inputCls}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>
            </div>

            {/* Estimated Duration + Link to Project */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Estimated Duration (minutes)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.estimatedMinutes ?? ''}
                  onChange={(e) => set('estimatedMinutes', e.target.value)}
                  className={inputCls}
                  placeholder="e.g. 35 for 35 min, 90 for 1.5 hrs"
                />
                {form.estimatedMinutes && Number(form.estimatedMinutes) > 0 && (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    = {Number(form.estimatedMinutes) < 60
                        ? `${form.estimatedMinutes} minutes`
                        : `${Math.floor(Number(form.estimatedMinutes) / 60)}h${Number(form.estimatedMinutes) % 60 > 0 ? ` ${Number(form.estimatedMinutes) % 60}m` : ''}`}
                  </p>
                )}
              </div>
              <div>
                <label className={labelCls}>Link to Project</label>
                <select value={form.projectId} onChange={(e) => set('projectId', e.target.value)} className={inputCls}>
                  <option value="">No project</option>
                  {projectList.map((p: any) => (
                    <option key={p.id} value={p.id}>{p.projectId} — {p.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* ── 4. ADVANCED SCHEDULING (collapsed by default) ────────────────── */}
        <div className="apex-card overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAdvancedSchedule(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium transition-colors"
            style={{ color: 'var(--text-primary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <span className="flex items-center gap-2">
              <Clock size={14} style={{ color: 'var(--text-tertiary)' }} />
              Advanced Scheduling
            </span>
            <span style={{ color: 'var(--text-tertiary)' }}>{showAdvancedSchedule ? '▲' : '▼'}</span>
          </button>

          {showAdvancedSchedule && (
            <div className="px-4 pb-4 pt-2 space-y-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>

              {/* Recurrence + Schedule Note */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Recurrence</label>
                  <select
                    value={scheduleRecurring}
                    onChange={(e) => setScheduleRecurring(e.target.value)}
                    className={inputCls}
                  >
                    <option value="none">One-time only</option>
                    <option value="custom_time">Custom date &amp; time…</option>
                    <option value="daily_morning">Every day — Morning (9:00 AM)</option>
                    <option value="daily_evening">Every day — Evening (6:00 PM)</option>
                    <option value="weekly">Every week (same day)</option>
                    <option value="monthly">Every month (same date)</option>
                    <option value="1_month">For 1 month daily</option>
                    <option value="6_months">For 6 months daily</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Schedule Note</label>
                  <input
                    type="text"
                    value={form.scheduledNote}
                    onChange={(e) => set('scheduledNote', e.target.value)}
                    className={inputCls}
                    placeholder="e.g., Check before standup"
                  />
                </div>
              </div>

              {/* Schedule Date & Time — conditional on recurrence mode */}
              {scheduleRecurring === 'none' ? (
                <div>
                  <label className={labelCls}>Schedule Date &amp; Time</label>
                  <input
                    type="datetime-local"
                    value={form.scheduledFor}
                    onChange={(e) => set('scheduledFor', e.target.value)}
                    className={inputCls}
                    min={new Date().toISOString().slice(0, 16)}
                  />
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>Assignees notified at this time</p>
                </div>
              ) : scheduleRecurring === 'custom_time' ? (
                <div>
                  <label className={labelCls}>Custom Date &amp; Time</label>
                  <input
                    type="datetime-local"
                    value={customScheduleAt}
                    onChange={(e) => setCustomScheduleAt(e.target.value)}
                    className={inputCls}
                    min={new Date().toISOString().slice(0, 16)}
                  />
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>One-time schedule at this exact time</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Remind until</label>
                    <select
                      value={scheduleEndPreset}
                      onChange={(e) => setScheduleEndPreset(e.target.value)}
                      className={inputCls}
                    >
                      <option value="1_week">1 week from now</option>
                      <option value="1_month">1 month from now</option>
                      <option value="3_months">3 months from now</option>
                      <option value="6_months">6 months from now</option>
                      <option value="custom">Custom date</option>
                    </select>
                  </div>
                  {scheduleEndPreset === 'custom' && (
                    <div>
                      <label className={labelCls}>End Date</label>
                      <input
                        type="date"
                        value={scheduleEndDate}
                        onChange={(e) => setScheduleEndDate(e.target.value)}
                        className={inputCls}
                        min={new Date().toISOString().split('T')[0]}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Scheduled Start + End */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Scheduled Start</label>
                  <input
                    type="datetime-local"
                    value={form.scheduledStartAt ?? ''}
                    onChange={(e) => set('scheduledStartAt', e.target.value)}
                    className={inputCls}
                    min={new Date().toISOString().slice(0, 16)}
                  />
                </div>
                <div>
                  <label className={labelCls}>Scheduled End</label>
                  <input
                    type="datetime-local"
                    value={form.scheduledEndAt ?? ''}
                    onChange={(e) => set('scheduledEndAt', e.target.value)}
                    className={inputCls}
                    min={form.scheduledStartAt || new Date().toISOString().slice(0, 16)}
                  />
                </div>
              </div>
              {form.scheduledStartAt && form.scheduledEndAt && (
                (() => {
                  const diffMs = new Date(form.scheduledEndAt).getTime() - new Date(form.scheduledStartAt).getTime();
                  const diffMin = Math.floor(diffMs / 60000);
                  if (diffMin < 0) return (
                    <p className="text-xs text-red-500">⚠ End time must be after start time</p>
                  );
                  return (
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      Duration: {diffMin < 60
                        ? `${diffMin} min`
                        : `${Math.floor(diffMin / 60)}h${diffMin % 60 > 0 ? ` ${diffMin % 60}m` : ''}`.trim()}
                    </p>
                  );
                })()
              )}
            </div>
          )}
        </div>

        {/* ── Submit ───────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="apex-btn-primary flex-1 font-semibold py-2.5 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {mutation.isPending ? (
              <><Loader2 size={16} className="animate-spin" /> Creating…</>
            ) : (
              'Create Ticket'
            )}
          </button>
          <button
            type="button"
            onClick={handleBack}
            className="flex-1 text-center border font-medium py-2.5 rounded-lg transition-colors text-sm"
            style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
