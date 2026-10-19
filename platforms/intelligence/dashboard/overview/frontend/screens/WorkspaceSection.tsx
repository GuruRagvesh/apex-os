'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { CalendarPlus, Check, ClipboardList, ExternalLink, FolderPlus, Pencil, Plus, StickyNote, Ticket, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@apex/core-identity';
import { useTicketCreationGate } from '@apex/operations-tickets-lifecycle/components/ticket-creation-gate';
import { dashboardApi } from '../api';
import type { HomeWorkspace } from './home-types';
import { EmptyState, SectionFrame } from './home-ui';

function noteDateTime(value: string | null) {
  if (!value) return { date: 'Not written yet', time: '' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: 'Saved note', time: '' };
  return {
    date: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }),
    time: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  };
}

export function WorkspaceSection({ userId, drawer = false }: { userId: string; drawer?: boolean }) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const ticketGate = useTicketCreationGate({ enabled: drawer });
  const roleName = String((user?.role as any)?.name ?? user?.role ?? '').toUpperCase();
  const canCreateProject = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);
  const queryClient = useQueryClient();
  const queryKey = ['home-workspace', userId];
  const { data, isPending, isError, refetch } = useQuery({
    queryKey,
    queryFn: () => dashboardApi.getHomeWorkspace() as Promise<HomeWorkspace>,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const mutation = useMutation({
    mutationFn: (patch: Partial<HomeWorkspace>) => dashboardApi.updateHomeWorkspace(patch) as Promise<HomeWorkspace>,
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
    onError: (error: any) => toast.error(error?.message ?? 'Could not save your workspace'),
  });
  const [notes, setNotes] = useState<HomeWorkspace['notes']>([]);
  const [activeNote, setActiveNote] = useState(0);
  const [task, setTask] = useState('');
  const [taskPriority, setTaskPriority] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('MEDIUM');
  const [editingEssentials, setEditingEssentials] = useState(false);
  const [essentials, setEssentials] = useState<HomeWorkspace['essentials']>([]);

  useEffect(() => {
    if (!data) return;
    setNotes(data.notes);
    setEssentials(data.essentials);
  }, [data]);

  const checklist = data?.checklist ?? [];
  const completed = checklist.filter((item) => item.done).length;
  const notesChanged = !!data && JSON.stringify(notes) !== JSON.stringify(data.notes);

  const saveNotes = async () => { try { await mutation.mutateAsync({ notes }); toast.success('Personal notes saved'); } catch {} };
  const updateNote = (index: number, key: 'title' | 'content', value: string) => setNotes((current) => current.map((note, itemIndex) => {
    if (itemIndex !== index) return note;
    const now = new Date().toISOString();
    return { ...note, [key]: value, createdAt: note.createdAt ?? now, updatedAt: now };
  }));
  const saveChecklist = async (next: HomeWorkspace['checklist']) => { try { await mutation.mutateAsync({ checklist: next }); } catch {} };
  const addTask = async () => {
    const text = task.trim();
    if (!text || checklist.length >= 30) return;
    await saveChecklist([...checklist, { id: crypto.randomUUID(), text, done: false, priority: taskPriority }]);
    setTask('');
  };
  const saveEssentials = async () => { try { await mutation.mutateAsync({ essentials }); setEditingEssentials(false); toast.success('Daily essential saved'); } catch {} };
  const updateEssential = (index: number, key: 'label' | 'url', value: string) => setEssentials((current) => current.map((essential, itemIndex) => itemIndex === index ? { ...essential, [key]: value } : essential));

  const content = <>
    {isPending && <p className="text-sm text-slate-500">Loading your workspace…</p>}
    {isError && <p className="text-sm text-rose-600">Your workspace could not be loaded. <button onClick={() => refetch()} className="underline">Retry</button></p>}
    {data && <div className={drawer ? 'space-y-4' : 'grid gap-3 lg:grid-cols-3'}>
      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
        <div className="mb-1 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Daily essential</h3><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">One personal link, editable by you.</p></div><button type="button" onClick={() => setEditingEssentials((open) => !open)} aria-expanded={editingEssentials} className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-blue-700 dark:hover:bg-slate-900" title="Edit daily essential"><Pencil size={15} /></button></div>
        <div className="mt-3 grid grid-cols-1 gap-2">
          {data.essentials.map((essential) => essential.url ? <a key={essential.id} href={essential.url} target="_blank" rel="noopener noreferrer" className="group flex min-h-16 flex-col items-center justify-center rounded-xl border border-slate-200 bg-white px-2 text-center text-xs font-semibold text-slate-700 transition hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><span className="mb-1 flex size-6 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-950/50"><ExternalLink size={13} /></span>{essential.label}</a> : <button key={essential.id} type="button" onClick={() => setEditingEssentials(true)} className="flex min-h-16 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 px-2 text-center text-xs font-medium text-slate-500 transition hover:border-blue-300 hover:text-blue-700 dark:border-slate-600"><Plus size={14} className="mb-1" />{essential.label}</button>)}
        </div>
        {editingEssentials && <div className="mt-4 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          {essentials.map((essential, index) => <div key={essential.id} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]"><input value={essential.label} maxLength={40} onChange={(event) => updateEssential(index, 'label', event.target.value)} aria-label="Essential link label" className="min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-800 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" /><input type="url" value={essential.url} maxLength={500} onChange={(event) => updateEssential(index, 'url', event.target.value)} placeholder="https://…" aria-label="Essential link URL" className="min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-800 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" /></div>)}
          <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={() => { setEssentials(data.essentials); setEditingEssentials(false); }} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700">Cancel</button><button type="button" disabled={mutation.isPending} onClick={saveEssentials} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save essential</button></div>
        </div>}
      </section>

      {drawer && <nav className="apex-workspace-action-strip" aria-label="Quick actions">
        <button
          type="button"
          className="apex-workspace-action apex-workspace-action-ticket"
          aria-disabled={!ticketGate.allowed || undefined}
          title={!ticketGate.allowed ? ticketGate.reason ?? 'Ticket creation is unavailable' : 'Create ticket'}
          onClick={() => { if (ticketGate.allowed) router.push('/tickets/new'); }}
        >
          <span className="apex-workspace-action-icon"><Ticket size={17} /></span>
          <span className="apex-workspace-action-label">Create Ticket</span>
        </button>
        {canCreateProject && <button type="button" className="apex-workspace-action apex-workspace-action-project" onClick={() => router.push('/projects?create=1')} title="Create project">
          <span className="apex-workspace-action-icon"><FolderPlus size={17} /></span>
          <span className="apex-workspace-action-label">Create Project</span>
        </button>}
        <button type="button" className="apex-workspace-action apex-workspace-action-leave" onClick={() => router.push('/leave')} title="Apply leave">
          <span className="apex-workspace-action-icon"><CalendarPlus size={17} /></span>
          <span className="apex-workspace-action-label">Apply Leave</span>
        </button>
        <button type="button" className="apex-workspace-action apex-workspace-action-edit" onClick={() => router.push('/settings?tab=appearance')} title="Edit hero bar appearance">
          <span className="apex-workspace-action-icon"><Pencil size={17} /></span>
          <span className="apex-workspace-action-label">Edit Hero Bar</span>
        </button>
      </nav>}

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
        <div className="mb-4"><h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100"><StickyNote size={15} className="text-blue-600" /> Personal notes</h3><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Your latest six private notes. Select one to unfold it.</p></div>
        <div className="apex-sticky-note-stack">
          {notes.map((note, index) => {
            const active = activeNote === index;
            const stamp = noteDateTime(note.updatedAt ?? note.createdAt);
            return <article key={note.id} className={`apex-sticky-note ${active ? 'is-active' : 'is-collapsed'}`} data-tone={index % 6}>
              <button type="button" className="apex-sticky-note-heading" onClick={() => setActiveNote(index)} aria-expanded={active}>
                <span className="min-w-0 text-left"><span className="block truncate text-sm font-bold text-slate-900">{note.title || `Note ${index + 1}`}</span><span className="mt-1 block truncate text-xs text-slate-600">{note.content || 'Tap to write this note'}</span></span>
                <span className="shrink-0 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500"><span className="block">{stamp.date}</span>{stamp.time && <span className="mt-0.5 block">{stamp.time}</span>}</span>
              </button>
              {active && <div className="apex-sticky-note-body">
                <input value={note.title} maxLength={80} onChange={(event) => updateNote(index, 'title', event.target.value)} aria-label={`Note ${index + 1} topic`} placeholder="Note topic" className="w-full border-0 border-b border-slate-900/15 bg-transparent px-0 pb-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-600" />
                <textarea value={note.content} maxLength={1600} onChange={(event) => updateNote(index, 'content', event.target.value)} aria-label={`Note ${index + 1} content`} placeholder="Write your note…" className="mt-2 min-h-32 w-full resize-y border-0 bg-transparent p-0 text-sm leading-6 text-slate-800 outline-none" />
              </div>}
            </article>;
          })}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2"><span className="text-[11px] text-slate-500 dark:text-slate-400">Only your account can read these notes.</span><button type="button" disabled={mutation.isPending || !notesChanged} onClick={saveNotes} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save notes</button></div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
        <div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Daily priorities</h3><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Add today’s tasks and mark what matters most.</p></div><span className="text-xs font-bold text-slate-500 dark:text-slate-400">{completed}/{checklist.length}</span></div>
        <div className="mb-3 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: checklist.length ? `${completed / checklist.length * 100}%` : '0%' }} /></div>
        {checklist.length ? <ul className="space-y-2">{checklist.map((item) => <li key={item.id} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200"><button type="button" disabled={mutation.isPending} onClick={() => saveChecklist(checklist.map((task) => task.id === item.id ? { ...task, done: !task.done } : task))} aria-label={`${item.done ? 'Uncheck' : 'Complete'} ${item.text}`} className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${item.done ? 'border-slate-800 bg-slate-800 text-white dark:border-blue-500 dark:bg-blue-500' : 'border-slate-400'}`}>{item.done && <Check size={11} />}</button><span className={`flex-1 ${item.done ? 'text-slate-400 line-through' : ''}`}>{item.text}</span><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wide ${item.priority === 'HIGH' ? 'bg-rose-100 text-rose-700' : item.priority === 'LOW' ? 'bg-teal-100 text-teal-700' : 'bg-amber-100 text-amber-700'}`}>{item.priority}</span><button type="button" disabled={mutation.isPending} onClick={() => saveChecklist(checklist.filter((task) => task.id !== item.id))} aria-label={`Delete ${item.text}`} className="text-slate-400 hover:text-rose-600"><Trash2 size={13} /></button></li>)}</ul> : <EmptyState>Add a task to start your daily priorities.</EmptyState>}
        <form onSubmit={(event) => { event.preventDefault(); addTask(); }} className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2"><input value={task} maxLength={160} onChange={(event) => setTask(event.target.value)} placeholder="New task" aria-label="New checklist task" className="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" /><select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as 'HIGH' | 'MEDIUM' | 'LOW')} aria-label="Task priority" className="rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option></select><button type="submit" disabled={mutation.isPending || !task.trim() || checklist.length >= 30} aria-label="Add task" className="rounded-lg bg-blue-600 px-3 text-white disabled:opacity-50"><Plus size={16} /></button></form>
      </section>
    </div>}
  </>;

  return drawer ? content : <SectionFrame icon={ClipboardList} title="My workspace">{content}</SectionFrame>;
}
