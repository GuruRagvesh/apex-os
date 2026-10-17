'use client';

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ChevronDown, ChevronUp, Copy, Eye, EyeOff,
  Pencil, Pin, PinOff, Plus, Search, Settings2, Trash2, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ticketTemplatesApi } from '../api/tickets-api';
import { MultiSelect } from '@apex/shared-ui/components/multi-select';

export type QuickTicketTemplate = {
  id: string;
  code: string;
  name: string;
  title: string;
  description?: string | null;
  departmentId?: string | null;
  taskTypeId?: string | null;
  taskSubtypeId?: string | null;
  assigneeIds: string[];
  priority?: string | null;
  estimatedMinutes?: number | null;
  projectId?: string | null;
  isVisible: boolean;
  isPinned: boolean;
  displayOrder: number;
  validation: { status: 'READY' | 'NEEDS_UPDATE'; invalidFields: string[]; messages: string[] };
};

type FormState = {
  name: string; title: string; description: string; departmentId: string;
  taskTypeId: string; taskSubtypeId: string; assigneeIds: string[];
  priority: string; hours: string; minutes: string; projectId: string;
};

type Props = {
  departments: any[];
  projects: any[];
  assigneesFor: (departmentId: string) => any[];
  departmentLocked: boolean;
  assigneeLocked: boolean;
  taskTypesFor: (departmentId: string) => any[];
  ensureTaskTypes: (departmentId: string) => void;
  currentUser: any;
  initialDefaults: { departmentId: string; taskTypeId: string; taskSubtypeId: string; priority: string; projectId: string };
  hasExistingData: boolean;
  onApply: (template: QuickTicketTemplate) => void;
};

const EMPTY: FormState = {
  name: '', title: '', description: '', departmentId: '', taskTypeId: '', taskSubtypeId: '',
  assigneeIds: [], priority: '', hours: '', minutes: '', projectId: '',
};

export type QuickTicketTagsHandle = {
  openCreate: () => void;
};

export const QuickTicketTags = forwardRef<QuickTicketTagsHandle, Props>(function QuickTicketTags(props, ref) {
  const qc = useQueryClient();
  const [editor, setEditor] = useState<QuickTicketTemplate | 'new' | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [pendingApply, setPendingApply] = useState<QuickTicketTemplate | null>(null);
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['quick-ticket-templates'],
    queryFn: () => ticketTemplatesApi.list() as Promise<{ templates: QuickTicketTemplate[]; preference: { visibleCount: number } }>,
  });
  const templates = query.data?.templates ?? [];
  const visibleCount = query.data?.preference?.visibleCount ?? 5;
  const visible = templates.filter((template) => template.isVisible).slice(0, visibleCount);
  const showManagementActions = templates.length > 3;

  useImperativeHandle(ref, () => ({
    openCreate: () => setEditor('new'),
  }), []);

  const refresh = async () => qc.invalidateQueries({ queryKey: ['quick-ticket-templates'] });
  const action = useMutation({
    mutationFn: async (run: () => Promise<any>) => run(),
    onSuccess: refresh,
    onError: (error: any) => toast.error(error?.message || 'Default Ticket update failed'),
  });

  const requestApply = (template: QuickTicketTemplate) => {
    if (template.validation.status !== 'READY') {
      toast.error(template.validation.messages[0] || 'This Default Ticket needs an update');
      setEditor(template);
      return;
    }
    if (props.hasExistingData) setPendingApply(template);
    else props.onApply(template);
  };

  return (
    <>
      {query.isLoading ? null : visible.length ? (
        <section className="mb-4 overflow-x-auto" aria-label="Default Tickets">
          <div className="flex flex-nowrap items-center gap-2 min-w-max">
            {visible.map((template) => (
              <button key={template.id} type="button" onClick={() => requestApply(template)}
                className="apex-btn-primary group flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500"
                aria-label={`Apply Default Ticket ${template.name}`}>
                {template.isPinned && <Pin size={12} />}
                <span>{template.name}</span>
                <span className="text-[10px] opacity-75">{template.code}</span>
                {template.validation.status === 'NEEDS_UPDATE' && <AlertTriangle size={13} aria-label="Needs update" />}
              </button>
            ))}
            {showManagementActions && (
              <>
                <button type="button" onClick={() => setManagerOpen(true)} className="shrink-0 border px-3 py-2 rounded-lg text-xs font-medium" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}>
                  View All
                </button>
                <button type="button" onClick={() => setManagerOpen(true)} className="shrink-0 border px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-1" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}>
                  <Settings2 size={13} /> Customize
                </button>
              </>
            )}
          </div>
        </section>
      ) : null}

      {editor && (
        <TemplateEditor
          template={editor === 'new' ? null : editor}
          {...props}
          onClose={() => setEditor(null)}
          onSaved={async () => { setEditor(null); await refresh(); }}
        />
      )}

      {managerOpen && (
        <ManagerModal
          templates={templates}
          visibleCount={visibleCount}
          search={search}
          setSearch={setSearch}
          busy={action.isPending}
          onClose={() => setManagerOpen(false)}
          onEdit={(template) => setEditor(template)}
          onCreate={() => setEditor('new')}
          onDuplicate={(id) => action.mutate(() => ticketTemplatesApi.duplicate(id))}
          onDelete={(id) => {
            if (window.confirm('Delete this Default Ticket? Existing tickets will not be changed.')) {
              action.mutate(() => ticketTemplatesApi.remove(id));
            }
          }}
          onVisible={(template) => action.mutate(() => ticketTemplatesApi.setVisibility(template.id, !template.isVisible))}
          onPin={(template) => action.mutate(() => ticketTemplatesApi.setPin(template.id, !template.isPinned))}
          onMove={(id, direction) => {
            const ordered = [...templates].sort((a, b) => a.displayOrder - b.displayOrder);
            const index = ordered.findIndex((template) => template.id === id);
            const target = index + direction;
            if (index < 0 || target < 0 || target >= ordered.length) return;
            [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
            action.mutate(() => ticketTemplatesApi.reorder(ordered.map((template) => template.id)));
          }}
          onVisibleCount={(count) => action.mutate(() => ticketTemplatesApi.updatePreference(count))}
        />
      )}

      {pendingApply && (
        <Modal title="Apply this Default Ticket?" onClose={() => setPendingApply(null)}>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Some information already entered in the ticket form will be replaced.</p>
          <div className="flex justify-end gap-2 mt-6">
            <button type="button" onClick={() => setPendingApply(null)} className="border px-4 py-2 rounded-lg text-sm font-medium" style={{ borderColor: 'var(--border-primary)' }}>Cancel</button>
            <button type="button" onClick={() => { props.onApply(pendingApply); setPendingApply(null); }} className="apex-btn-primary px-4 py-2 rounded-lg text-sm font-semibold">Apply Default</button>
          </div>
        </Modal>
      )}
    </>
  );
});

function TemplateEditor({ template, departments, projects, assigneesFor, departmentLocked, assigneeLocked, taskTypesFor, ensureTaskTypes, currentUser, initialDefaults, onClose, onSaved }: Props & {
  template: QuickTicketTemplate | null; onClose: () => void; onSaved: () => void;
}) {
  const initial = useMemo<FormState>(() => template ? {
    name: template.name, title: template.title, description: template.description ?? '',
    departmentId: template.departmentId ?? '', taskTypeId: template.taskTypeId ?? '',
    taskSubtypeId: template.taskSubtypeId ?? '',
    assigneeIds: assigneeLocked && currentUser?.id ? [currentUser.id] : (template.assigneeIds ?? []),
    priority: template.priority ?? '', hours: template.estimatedMinutes ? String(Math.floor(template.estimatedMinutes / 60)) : '',
    minutes: template.estimatedMinutes ? String(template.estimatedMinutes % 60) : '', projectId: template.projectId ?? '',
  } : {
    ...EMPTY, ...initialDefaults,
    assigneeIds: assigneeLocked && currentUser?.id ? [currentUser.id] : [],
  }, [template, initialDefaults, assigneeLocked, currentUser]);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    ensureTaskTypes(form.departmentId);
  }, [form.departmentId, ensureTaskTypes]);
  const taskTypes = taskTypesFor(form.departmentId);
  const subtypes = taskTypes.find((type: any) => type.id === form.taskTypeId)?.subtypes ?? [];
  // Reuse the normal TASK form's role-aware resolver so Default Tickets cannot
  // drift from the existing department and assignee hierarchy.
  const assignees = assigneesFor(form.departmentId);
  const activeProjects = projects.filter((project: any) => !project.status || project.status === 'ACTIVE');
  const set = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    const hasEstimatedTime = form.hours.trim() !== '' || form.minutes.trim() !== '';
    const hours = form.hours.trim() === '' ? 0 : Number(form.hours);
    const minutes = form.minutes.trim() === '' ? 0 : Number(form.minutes);
    if (hasEstimatedTime && (!Number.isInteger(hours) || hours < 0 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59)) {
      toast.error('Hours must be non-negative and minutes must be from 0 to 59'); return;
    }
    const estimatedMinutes = hasEstimatedTime ? (hours * 60) + minutes : null;
    if (hasEstimatedTime && estimatedMinutes! < 1) { toast.error('Estimated time must be greater than zero when provided'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        departmentId: form.departmentId || null,
        taskTypeId: form.taskTypeId || null,
        taskSubtypeId: form.taskSubtypeId || null,
        assigneeIds: assigneeLocked && currentUser?.id ? [currentUser.id] : form.assigneeIds,
        priority: form.priority || null,
        estimatedMinutes,
        projectId: form.projectId || null,
      };
      if (template) await ticketTemplatesApi.update(template.id, payload);
      else await ticketTemplatesApi.create(payload);
      toast.success(template ? 'Default Ticket updated' : 'Default Ticket created');
      onSaved();
    } catch (error: any) {
      toast.error(error?.message || 'Could not save Default Ticket');
    } finally { setSaving(false); }
  };

  return (
    <Modal title={template ? `Edit ${template.code}` : 'Create Default Ticket'} onClose={onClose} wide>
      {template?.validation.status === 'NEEDS_UPDATE' && (
        <div className="mb-4 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-800">
          <strong>Needs Update:</strong> {template.validation.messages.join('; ')}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Default Ticket Name" htmlFor="default-ticket-name"><input id="default-ticket-name" name="defaultTicketName" aria-required="true" className="apex-input" value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Ticket Title" htmlFor="default-ticket-title"><input id="default-ticket-title" name="title" aria-required="true" className="apex-input" value={form.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <div className="md:col-span-2"><Field label="Description" htmlFor="default-ticket-description"><textarea id="default-ticket-description" name="description" className="apex-input min-h-24" value={form.description} onChange={(e) => set('description', e.target.value)} /></Field></div>
        <Field label="Department" htmlFor="default-ticket-department"><select id="default-ticket-department" name="departmentId" className="apex-input" value={form.departmentId} disabled={departmentLocked} onChange={(e) => setForm((current) => ({ ...current, departmentId: e.target.value, taskTypeId: '', taskSubtypeId: '', assigneeIds: [] }))}><option value="">Select…</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></Field>
        <Field label="Task Type" htmlFor="default-ticket-task-type"><select id="default-ticket-task-type" name="taskTypeId" className="apex-input" value={form.taskTypeId} disabled={!form.departmentId} onChange={(e) => setForm((current) => ({ ...current, taskTypeId: e.target.value, taskSubtypeId: '' }))}><option value="">Select…</option>{taskTypes.map((type: any) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></Field>
        <Field label="Subtype" htmlFor="default-ticket-subtype"><select id="default-ticket-subtype" name="taskSubtypeId" className="apex-input" value={form.taskSubtypeId} disabled={!form.taskTypeId || !subtypes.length} onChange={(e) => set('taskSubtypeId', e.target.value)}><option value="">None</option>{subtypes.map((subtype: any) => <option key={subtype.id} value={subtype.id}>{subtype.name}</option>)}</select></Field>
        <Field label="Assigned To" htmlFor={assigneeLocked ? undefined : "default-ticket-assignees"}>{assigneeLocked ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
            <span>👤</span><span>Assigned to you</span>
          </div>
        ) : (
          <MultiSelect id="default-ticket-assignees" name="assigneeIds" label="Assigned To" options={assignees.map((user: any) => ({ value: user.id, label: user.name, sublabel: user.departmentName, avatar: user.avatar }))} value={form.assigneeIds} onChange={(assigneeIds) => setForm((current) => ({ ...current, assigneeIds }))} disabled={!form.departmentId} placeholder={form.departmentId ? 'Select…' : 'Pick department first'} />
        )}</Field>
        <Field label="Priority" htmlFor="default-ticket-priority"><select id="default-ticket-priority" name="priority" className="apex-input" value={form.priority} onChange={(e) => set('priority', e.target.value)}><option value="">None</option>{['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((priority) => <option key={priority}>{priority}</option>)}</select></Field>
        <Field label="Project (optional)" htmlFor="default-ticket-project"><select id="default-ticket-project" name="projectId" className="apex-input" value={form.projectId} onChange={(e) => set('projectId', e.target.value)}><option value="">No project</option>{activeProjects.map((project: any) => <option key={project.id} value={project.id}>{project.projectId} — {project.name}</option>)}</select></Field>
        <Field label="Estimated Hours" htmlFor="default-ticket-estimated-hours"><input id="default-ticket-estimated-hours" name="estimatedHours" type="number" min="0" step="1" className="apex-input" value={form.hours} onChange={(e) => set('hours', e.target.value)} /></Field>
        <Field label="Estimated Minutes" htmlFor="default-ticket-estimated-minutes"><input id="default-ticket-estimated-minutes" name="estimatedMinutes" type="number" min="0" max="59" step="1" className="apex-input" value={form.minutes} onChange={(e) => set('minutes', e.target.value)} /></Field>
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <button type="button" onClick={onClose} className="border px-4 py-2 rounded-lg text-sm font-medium" style={{ borderColor: 'var(--border-primary)' }}>Cancel</button>
        <button type="button" onClick={save} disabled={saving} className="apex-btn-primary px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">{saving ? 'Saving…' : template ? 'Save Default Ticket' : 'Create Default Ticket'}</button>
      </div>
    </Modal>
  );
}

function ManagerModal({ templates, visibleCount, search, setSearch, busy, onClose, onEdit, onCreate, onDuplicate, onDelete, onVisible, onPin, onMove, onVisibleCount }: any) {
  const filtered = templates.filter((template: QuickTicketTemplate) => `${template.name} ${template.code}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <Modal title="Manage Default Tickets" onClose={onClose} wide>
      <div className="flex flex-wrap gap-3 items-center mb-4">
        <div className="relative flex-1 min-w-52"><label htmlFor="default-ticket-manager-search" className="sr-only">Search Default Tickets</label><Search size={15} aria-hidden="true" className="absolute left-3 top-3" /><input id="default-ticket-manager-search" name="defaultTicketSearch" type="search" className="apex-input pl-9" placeholder="Search name or code" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <label htmlFor="default-ticket-visible-count" className="text-sm flex items-center gap-2">Visible tickets <select id="default-ticket-visible-count" name="visibleCount" className="apex-input w-20" value={visibleCount} onChange={(e) => onVisibleCount(Number(e.target.value))}>{Array.from({ length: 20 }, (_, i) => i + 1).map((count) => <option key={count}>{count}</option>)}</select></label>
        <button type="button" onClick={onCreate} className="apex-btn-primary px-3 py-2 rounded-lg text-sm flex items-center gap-1"><Plus size={14} /> Create</button>
      </div>
      <div className="space-y-2 max-h-[55vh] overflow-y-auto">
        {filtered.map((template: QuickTicketTemplate) => (
          <div key={template.id} className="border rounded-lg p-3 flex items-center gap-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="min-w-0 flex-1"><p className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{template.name} <span className="text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>{template.code}</span></p><p className="text-xs truncate" style={{ color: template.validation.status === 'READY' ? 'var(--text-secondary)' : 'var(--color-warning)' }}>{template.validation.status === 'READY' ? template.title : `Needs Update — ${template.validation.messages.join('; ')}`}</p></div>
            <div className="flex items-center gap-1">
              <IconButton label="Move up" onClick={() => onMove(template.id, -1)}><ChevronUp size={15} /></IconButton>
              <IconButton label="Move down" onClick={() => onMove(template.id, 1)}><ChevronDown size={15} /></IconButton>
              <IconButton label={template.isPinned ? 'Unpin' : 'Pin'} onClick={() => onPin(template)}>{template.isPinned ? <PinOff size={15} /> : <Pin size={15} />}</IconButton>
              <IconButton label={template.isVisible ? 'Hide' : 'Show'} onClick={() => onVisible(template)}>{template.isVisible ? <Eye size={15} /> : <EyeOff size={15} />}</IconButton>
              <IconButton label="Edit" onClick={() => onEdit(template)}><Pencil size={15} /></IconButton>
              <IconButton label="Duplicate" onClick={() => onDuplicate(template.id)}><Copy size={15} /></IconButton>
              <IconButton label="Delete" onClick={() => onDelete(template.id)} danger><Trash2 size={15} /></IconButton>
            </div>
          </div>
        ))}
        {!filtered.length && <p className="text-sm py-8 text-center" style={{ color: 'var(--text-secondary)' }}>No Default Tickets found.</p>}
      </div>
      {busy && <p className="text-xs mt-3" style={{ color: 'var(--text-secondary)' }}>Saving changes…</p>}
    </Modal>
  );
}

function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,.65)' }} role="dialog" aria-modal="true" aria-label={title}><div className={`apex-card w-full ${wide ? 'max-w-3xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto p-5`}><div className="flex items-center justify-between mb-4"><h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h3><button type="button" onClick={onClose} aria-label="Close" className="p-2 rounded-lg focus:ring-2 focus:ring-indigo-500"><X size={18} /></button></div>{children}</div></div>;
}

/** A visible label tied to its control by htmlFor (not only by wrapping), so every control has a programmatic name. */
function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return <div className="block">{htmlFor ? <label htmlFor={htmlFor} className="apex-label block">{label}</label> : <span className="apex-label block">{label}</span>}{children}</div>;
}
function IconButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) { return <button type="button" title={label} aria-label={label} onClick={onClick} className={`p-2 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 ${danger ? 'text-red-500' : ''}`} style={danger ? undefined : { color: 'var(--text-secondary)' }}>{children}</button>; }
