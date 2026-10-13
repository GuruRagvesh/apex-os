'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardList, ExternalLink, GripVertical, Pencil, Plus, StickyNote, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { dashboardApi } from '../api';
import type { HomeWorkspace } from './home-types';
import { EmptyState, SectionFrame } from './home-ui';

const EMPTY_NOTES = ['', '', ''];

export function WorkspaceSection({ userId, drawer = false }: { userId: string; drawer?: boolean }) {
  const queryClient = useQueryClient();
  const queryKey = ['home-workspace', userId];
  const { data, isPending, isError, refetch } = useQuery({ queryKey, queryFn: () => dashboardApi.getHomeWorkspace() as Promise<HomeWorkspace> });
  const mutation = useMutation({
    mutationFn: (patch: Partial<HomeWorkspace>) => dashboardApi.updateHomeWorkspace(patch) as Promise<HomeWorkspace>,
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
    onError: (error: any) => toast.error(error?.message ?? 'Could not save your workspace'),
  });
  const [notes, setNotes] = useState<string[]>(EMPTY_NOTES);
  const [activeNote, setActiveNote] = useState(0);
  const [task, setTask] = useState('');
  const [editingEssentials, setEditingEssentials] = useState(false);
  const [essentials, setEssentials] = useState<HomeWorkspace['essentials']>([]);

  useEffect(() => {
    if (!data) return;
    setNotes(Array.from({ length: 3 }, (_, index) => data.notes[index] ?? ''));
    setEssentials(data.essentials);
  }, [data]);

  const checklist = data?.checklist ?? [];
  const completed = checklist.filter((item) => item.done).length;
  const notesChanged = !!data && notes.some((note, index) => note !== (data.notes[index] ?? ''));

  const saveNotes = async () => { try { await mutation.mutateAsync({ notes }); toast.success('Personal notes saved'); } catch {} };
  const saveChecklist = async (next: HomeWorkspace['checklist']) => { try { await mutation.mutateAsync({ checklist: next }); } catch {} };
  const addTask = async () => {
    const text = task.trim();
    if (!text || checklist.length >= 30) return;
    await saveChecklist([...checklist, { id: crypto.randomUUID(), text, done: false }]);
    setTask('');
  };
  const saveEssentials = async () => { try { await mutation.mutateAsync({ essentials }); setEditingEssentials(false); toast.success('Daily essentials saved'); } catch {} };
  const updateEssential = (index: number, key: 'label' | 'url', value: string) => setEssentials((current) => current.map((essential, itemIndex) => itemIndex === index ? { ...essential, [key]: value } : essential));

  const content = <>
    {isPending && <p className="text-sm text-slate-500">Loading your workspace…</p>}
    {isError && <p className="text-sm text-rose-600">Your workspace could not be loaded. <button onClick={() => refetch()} className="underline">Retry</button></p>}
    {data && <div className={drawer ? 'space-y-4' : 'grid gap-3 lg:grid-cols-3'}>
      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
        <div className="mb-1 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Daily essentials</h3><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Five personal links, editable by you.</p></div><button type="button" onClick={() => setEditingEssentials((open) => !open)} aria-expanded={editingEssentials} className="rounded-lg p-2 text-slate-500 hover:bg-white hover:text-blue-700 dark:hover:bg-slate-900" title="Edit daily essentials"><Pencil size={15} /></button></div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {data.essentials.map((essential) => essential.url ? <a key={essential.id} href={essential.url} target="_blank" rel="noopener noreferrer" className="group flex min-h-16 flex-col items-center justify-center rounded-xl border border-slate-200 bg-white px-2 text-center text-xs font-semibold text-slate-700 transition hover:border-blue-300 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><span className="mb-1 flex size-6 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-950/50"><ExternalLink size={13} /></span>{essential.label}</a> : <button key={essential.id} type="button" onClick={() => setEditingEssentials(true)} className="flex min-h-16 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 px-2 text-center text-xs font-medium text-slate-500 transition hover:border-blue-300 hover:text-blue-700 dark:border-slate-600"><Plus size={14} className="mb-1" />{essential.label}</button>)}
        </div>
        {editingEssentials && <div className="mt-4 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700">
          {essentials.map((essential, index) => <div key={essential.id} className="grid grid-cols-[auto_minmax(0,0.7fr)_minmax(0,1.3fr)] items-center gap-2"><GripVertical size={14} className="text-slate-400" /><input value={essential.label} maxLength={40} onChange={(event) => updateEssential(index, 'label', event.target.value)} aria-label={`Essential ${index + 1} label`} className="min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-800 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" /><input type="url" value={essential.url} maxLength={500} onChange={(event) => updateEssential(index, 'url', event.target.value)} placeholder="https://…" aria-label={`Essential ${index + 1} URL`} className="min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-800 outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" /></div>)}
          <div className="flex justify-end gap-2 pt-1"><button type="button" onClick={() => { setEssentials(data.essentials); setEditingEssentials(false); }} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700">Cancel</button><button type="button" disabled={mutation.isPending} onClick={saveEssentials} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save essentials</button></div>
        </div>}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
        <div className="mb-3"><h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100"><StickyNote size={15} className="text-blue-600" /> Personal notes</h3><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Private notes, separated by focus.</p></div>
        <div className="mb-3 flex gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-900">{notes.map((note, index) => <button key={index} type="button" onClick={() => setActiveNote(index)} className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition ${activeNote === index ? 'bg-white text-blue-700 shadow-sm dark:bg-slate-700 dark:text-blue-200' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}>Note {index + 1}{note.trim() ? ' •' : ''}</button>)}</div>
        <textarea aria-label={`Personal note ${activeNote + 1}`} value={notes[activeNote] ?? ''} maxLength={1600} onChange={(event) => setNotes((current) => current.map((note, index) => index === activeNote ? event.target.value : note))} placeholder={`Add a private reminder to Note ${activeNote + 1}…`} className="min-h-32 w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
        <div className="mt-2 flex items-center justify-between gap-2"><span className="text-[11px] text-slate-500 dark:text-slate-400">Only your account can read these notes.</span><button type="button" disabled={mutation.isPending || !notesChanged} onClick={saveNotes} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save notes</button></div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/70">
        <div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Daily checklist</h3><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Keep today’s priorities visible.</p></div><span className="text-xs font-bold text-slate-500 dark:text-slate-400">{completed}/{checklist.length}</span></div>
        <div className="mb-3 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: checklist.length ? `${completed / checklist.length * 100}%` : '0%' }} /></div>
        {checklist.length ? <ul className="space-y-2">{checklist.map((item) => <li key={item.id} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200"><button type="button" disabled={mutation.isPending} onClick={() => saveChecklist(checklist.map((task) => task.id === item.id ? { ...task, done: !task.done } : task))} aria-label={`${item.done ? 'Uncheck' : 'Complete'} ${item.text}`} className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${item.done ? 'border-slate-800 bg-slate-800 text-white dark:border-blue-500 dark:bg-blue-500' : 'border-slate-400'}`}>{item.done && <Check size={11} />}</button><span className={`flex-1 ${item.done ? 'text-slate-400 line-through' : ''}`}>{item.text}</span><button type="button" disabled={mutation.isPending} onClick={() => saveChecklist(checklist.filter((task) => task.id !== item.id))} aria-label={`Delete ${item.text}`} className="text-slate-400 hover:text-rose-600"><Trash2 size={13} /></button></li>)}</ul> : <EmptyState>Add a task to start your daily checklist.</EmptyState>}
        <form onSubmit={(event) => { event.preventDefault(); addTask(); }} className="mt-4 flex gap-2"><input value={task} maxLength={160} onChange={(event) => setTask(event.target.value)} placeholder="New task" aria-label="New checklist task" className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" /><button type="submit" disabled={mutation.isPending || !task.trim() || checklist.length >= 30} aria-label="Add task" className="rounded-lg bg-blue-600 px-3 text-white disabled:opacity-50"><Plus size={16} /></button></form>
      </section>
    </div>}
  </>;

  return drawer ? content : <SectionFrame icon={ClipboardList} title="My workspace">{content}</SectionFrame>;
}
