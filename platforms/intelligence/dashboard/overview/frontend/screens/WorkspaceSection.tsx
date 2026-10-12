'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardList, FolderOpen, Mail, MessageSquare, Pencil, Plus, StickyNote, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { dashboardApi } from '../api';
import type { HomeWorkspace } from './home-types';
import { EmptyState, SectionFrame } from './home-ui';

const shortcutMeta = [
  { key: 'mail' as const, label: 'Mail', Icon: Mail },
  { key: 'teams' as const, label: 'Teams', Icon: MessageSquare },
  { key: 'drive' as const, label: 'Drive', Icon: FolderOpen },
];

export function WorkspaceSection({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['home-workspace', userId];
  const { data, isPending, isError, refetch } = useQuery({ queryKey, queryFn: () => dashboardApi.getHomeWorkspace() as Promise<HomeWorkspace> });
  const mutation = useMutation({
    mutationFn: (patch: Partial<HomeWorkspace>) => dashboardApi.updateHomeWorkspace(patch) as Promise<HomeWorkspace>,
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
    onError: (error: any) => toast.error(error?.message ?? 'Could not save your workspace'),
  });
  const [notes, setNotes] = useState('');
  const [task, setTask] = useState('');
  const [editingLinks, setEditingLinks] = useState(false);
  const [links, setLinks] = useState<HomeWorkspace['shortcuts']>({});
  useEffect(() => { if (data) { setNotes(data.notes); setLinks(data.shortcuts); } }, [data]);
  const checklist = data?.checklist ?? [];
  const completed = checklist.filter((item) => item.done).length;

  const saveNotes = async () => {
    try { await mutation.mutateAsync({ notes }); toast.success('Private note saved'); } catch {}
  };
  const saveChecklist = async (next: HomeWorkspace['checklist']) => {
    try { await mutation.mutateAsync({ checklist: next }); } catch {}
  };
  const addTask = async () => {
    const text = task.trim();
    if (!text || checklist.length >= 30) return;
    await saveChecklist([...checklist, { id: crypto.randomUUID(), text, done: false }]);
    setTask('');
  };
  const saveLinks = async () => {
    try { await mutation.mutateAsync({ shortcuts: links }); setEditingLinks(false); toast.success('Shortcuts saved'); } catch {}
  };

  return (
    <SectionFrame icon={ClipboardList} title="My workspace">
      {isPending && <p className="text-sm text-slate-500">Loading your workspace…</p>}
      {isError && <p className="text-sm text-rose-600">Your workspace could not be loaded. <button onClick={() => refetch()} className="underline">Retry</button></p>}
      {data && <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/70">
          <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Daily essentials</h3><button type="button" onClick={() => setEditingLinks(!editingLinks)} aria-label="Edit shortcuts" className="rounded p-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"><Pencil size={14} /></button></div>
          <div className="grid grid-cols-2 gap-2">
            {shortcutMeta.map(({ key, label, Icon }) => data.shortcuts[key] ? (
              <a key={key} href={data.shortcuts[key]} target="_blank" rel="noopener noreferrer" className="flex min-h-14 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-medium text-blue-700 hover:border-blue-300 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-300"><Icon size={16} className="mb-1" />{label}</a>
            ) : <button key={key} type="button" onClick={() => setEditingLinks(true)} className="flex min-h-14 flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 hover:border-blue-300 dark:border-slate-600"><Icon size={16} className="mb-1" />Set up {label}</button>)}
            <Link href="/tickets" className="flex min-h-14 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white text-xs font-medium text-blue-700 hover:border-blue-300 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-300"><ClipboardList size={16} className="mb-1" />Tickets</Link>
          </div>
          {editingLinks && <div className="mt-3 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
            {shortcutMeta.map(({ key, label }) => <label key={key} className="block text-xs text-slate-600 dark:text-slate-300">{label} HTTPS URL<input type="url" value={links[key] ?? ''} onChange={(event) => setLinks({ ...links, [key]: event.target.value })} placeholder="https://…" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" /></label>)}
            <button type="button" disabled={mutation.isPending} onClick={saveLinks} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save shortcuts</button>
          </div>}
        </div>

        <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/70">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100"><StickyNote size={15} className="text-blue-600" /> Personal notes</h3>
          <textarea aria-label="Private personal notes" value={notes} maxLength={5000} onChange={(event) => setNotes(event.target.value)} placeholder="Write a private reminder…" className="min-h-36 w-full resize-y rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
          <div className="mt-2 flex items-center justify-between gap-2"><span className="text-[11px] text-slate-500 dark:text-slate-400">Only your account can read this note.</span><button type="button" disabled={mutation.isPending || notes === data.notes} onClick={saveNotes} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save note</button></div>
        </div>

        <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/70">
          <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Daily checklist</h3><span className="text-xs font-medium text-slate-500 dark:text-slate-400">{completed}/{checklist.length}</span></div>
          <div className="mb-3 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700"><div className="h-full rounded-full bg-blue-600" style={{ width: checklist.length ? `${completed / checklist.length * 100}%` : '0%' }} /></div>
          {checklist.length ? <ul className="space-y-2">{checklist.map((item) => <li key={item.id} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200"><button type="button" disabled={mutation.isPending} onClick={() => saveChecklist(checklist.map((task) => task.id === item.id ? { ...task, done: !task.done } : task))} aria-label={`${item.done ? 'Uncheck' : 'Complete'} ${item.text}`} className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${item.done ? 'border-slate-800 bg-slate-800 text-white dark:border-blue-500 dark:bg-blue-500' : 'border-slate-400'}`}>{item.done && <Check size={11} />}</button><span className={`flex-1 ${item.done ? 'text-slate-400 line-through' : ''}`}>{item.text}</span><button type="button" disabled={mutation.isPending} onClick={() => saveChecklist(checklist.filter((task) => task.id !== item.id))} aria-label={`Delete ${item.text}`} className="text-slate-400 hover:text-rose-600"><Trash2 size={13} /></button></li>)}</ul> : <EmptyState>Add a task to start your daily checklist.</EmptyState>}
          <form onSubmit={(event) => { event.preventDefault(); addTask(); }} className="mt-4 flex gap-2"><input value={task} maxLength={160} onChange={(event) => setTask(event.target.value)} placeholder="New task" aria-label="New checklist task" className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" /><button type="submit" disabled={mutation.isPending || !task.trim() || checklist.length >= 30} aria-label="Add task" className="rounded-lg bg-blue-600 px-3 text-white disabled:opacity-50"><Plus size={16} /></button></form>
        </div>
      </div>}
    </SectionFrame>
  );
}
