'use client';

import { useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ticketsApi, projectsApi, departmentsApi, usersApi, aiApi, taskTypesApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import toast from 'react-hot-toast';
import { ArrowLeft, Sparkles, Loader2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MultiSelect } from '@/components/ui/multi-select';

const CATEGORIES = ['IT', 'FACILITIES', 'HR', 'OPERATIONS', 'PROJECT', 'ADMIN'];
const TYPES = ['TASK', 'BUG', 'FEATURE', 'MAINTENANCE', 'SUPPORT', 'INCIDENT', 'REQUEST'];
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
    category: 'IT',
    type: 'TASK',
    priority: 'MEDIUM',
    estimatedTime: '',
    // Pre-fill department for TL / Employee
    departmentId: (isTL || isEmployee) ? myDeptId : '',
    projectId: preselectedProjectId || '',
    // Pre-fill self for Employee/Intern
    assignedToId: isEmployee ? (user?.id ?? '') : '',
    dueDate: '',
    scheduledFor: '',
    scheduledNote: '',
  });

  // Multiple assignees state
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    isEmployee && user?.id ? [user.id] : [],
  );

  const [aiReason, setAiReason] = useState<string>('');
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiDisabled, setAiDisabled] = useState(false);

  const [taskTypeId, setTaskTypeId] = useState('');
  const [taskSubtypeId, setTaskSubtypeId] = useState('');

  const [scheduleRecurring, setScheduleRecurring] = useState('none');
  const [scheduleEndPreset, setScheduleEndPreset] = useState('1_month');
  const [scheduleEndDate, setScheduleEndDate] = useState('');

  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: () => departmentsApi.getAll() as Promise<any[]> });
  const { data: projectsRaw } = useQuery({ queryKey: ['projects'], queryFn: () => projectsApi.getAll() as Promise<any> });
  const { data: usersData } = useQuery({ queryKey: ['users'], queryFn: () => usersApi.getAll() as Promise<any> });

  const deptIdForTypes = form.departmentId || myDeptId;
  const { data: taskTypesRaw } = useQuery({
    queryKey: ['task-types', deptIdForTypes],
    queryFn: () => taskTypesApi.getByDepartment(deptIdForTypes),
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

  // For TEAM_LEAD: show only own-dept users
  // For EMPLOYEE/INTERN: show only themselves + the TL of their dept
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
    if (!form.title.trim()) return toast.error('Title is required');
    mutation.mutate({
      ...form,
      estimatedTime: form.estimatedTime ? parseFloat(form.estimatedTime) : undefined,
      projectId: form.projectId || undefined,
      // Primary assignee = first selected, or the single assignedToId
      assignedToId: assigneeIds[0] || form.assignedToId || undefined,
      assigneeIds: assigneeIds.length > 0 ? assigneeIds : undefined,
      departmentId: form.departmentId || undefined,
      dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
      scheduledFor: form.scheduledFor ? new Date(form.scheduledFor).toISOString() : undefined,
      scheduledNote: form.scheduledNote || undefined,
      scheduleRecurring: scheduleRecurring !== 'none' ? scheduleRecurring : undefined,
      scheduleEndDate: computeEndDate(),
      taskTypeId: taskTypeId || undefined,
      taskSubtypeId: taskSubtypeId || undefined,
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
        // Apply default priority but no success toast
        if (result.priority) setForm((f) => ({ ...f, priority: result.priority }));
      } else if (result?.priority) {
        setForm((f) => ({ ...f, priority: result.priority }));
        setAiReason(result.reason ?? '');
        toast.success(`AI suggests: ${result.priority}`, { icon: '✨' });
      }
    } catch {
      // Silent — backend now always returns a payload. Real errors are rare.
    } finally {
      setAiSuggesting(false);
    }
  };

  const set = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key === 'priority') setAiReason(''); // clear AI hint if user overrides
  };

  const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500';
  const labelCls = 'block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5';

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={handleBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
          <ArrowLeft size={18} className="text-slate-500" />
        </button>
        <div>
          <h2 className="text-xl font-bold text-slate-800">Create New Ticket</h2>
          <p className="text-sm text-slate-500">Report an issue, request, or task</p>
        </div>
      </div>
      {preselectedProjectName && (
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-700 dark:text-blue-300 mb-2">
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

      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 dark:border-gray-700 rounded-xl border border-slate-200 p-6 space-y-5">
        {/* Title */}
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

        {/* Description */}
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

        {/* Row: Category + Type */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Category *</label>
            <select value={form.category} onChange={(e) => set('category', e.target.value)} className={inputCls}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <select value={form.type} onChange={(e) => set('type', e.target.value)} className={inputCls}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Row: Task Type + Task Subtype */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Task Type</label>
            <select
              value={taskTypeId}
              onChange={(e) => { setTaskTypeId(e.target.value); setTaskSubtypeId(''); }}
              className={inputCls}
            >
              <option value="">Select task type...</option>
              {taskTypes.map((t: any) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          {taskTypeId && selectedTaskType?.subtypes?.length > 0 ? (
            <div>
              <label className={labelCls}>Subtype</label>
              <select
                value={taskSubtypeId}
                onChange={(e) => setTaskSubtypeId(e.target.value)}
                className={inputCls}
              >
                <option value="">Select subtype...</option>
                {selectedTaskType.subtypes.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div />
          )}
        </div>

        {/* Row: Priority + Est Time */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-slate-700">Priority</label>
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
          <div>
            <label className={labelCls}>Estimated Time (hours)</label>
            <input
              type="number"
              min="0.5"
              step="0.5"
              value={form.estimatedTime}
              onChange={(e) => set('estimatedTime', e.target.value)}
              className={inputCls}
              placeholder="e.g., 2"
            />
          </div>
        </div>

        {/* Row: Department + Project */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>
              Department
              {(isTL || isEmployee) && (
                <span className="ml-1.5 text-xs text-slate-400 font-normal">(your dept)</span>
              )}
            </label>
            {(isTL || isEmployee) ? (
              <input
                readOnly
                value={Array.isArray(departments)
                  ? (departments.find((d: any) => d.id === myDeptId)?.name ?? 'Your department')
                  : 'Your department'}
                className={`${inputCls} bg-slate-50 dark:bg-gray-700 text-slate-500 dark:text-gray-400 cursor-not-allowed`}
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
                <option value="">Select department</option>
                {Array.isArray(departments) && departments.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
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

        {/* Row: Assignees + Due Date */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Assign To</label>
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
          </div>
          <div>
            <label className={labelCls}>Due Date</label>
            <input
              type="date"
              value={form.dueDate}
              onChange={(e) => set('dueDate', e.target.value)}
              className={inputCls}
              min={new Date().toISOString().split('T')[0]}
            />
          </div>
        </div>

        {/* Scheduling Section */}
        <div className="border border-slate-200 dark:border-gray-700 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-gray-300 mb-3 flex items-center gap-1.5">
            <Clock size={14} className="text-slate-400" />
            Schedule (optional)
          </h3>

          {/* Recurrence */}
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <label className={labelCls}>Recurrence</label>
              <select
                value={scheduleRecurring}
                onChange={(e) => setScheduleRecurring(e.target.value)}
                className={inputCls}
              >
                <option value="none">One-time only</option>
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

          {scheduleRecurring === 'none' ? (
            <div>
              <label className={labelCls}>Date &amp; Time</label>
              <input
                type="datetime-local"
                value={form.scheduledFor}
                onChange={(e) => set('scheduledFor', e.target.value)}
                className={inputCls}
                min={new Date().toISOString().slice(0, 16)}
              />
              <p className="mt-1 text-xs text-slate-400 dark:text-gray-500">Assignees notified at this time</p>
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
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
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
            className="flex-1 text-center border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 font-medium py-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
