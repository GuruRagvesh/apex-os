'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { workdayNotesApi } from '@/lib/workday-notes-api';
import { useAuthStore } from '@apex/core-identity';

const makeIdempotencyKey = () =>
  globalThis.crypto?.randomUUID?.() ?? `note-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function WorkdayNotesPage() {
  const qc = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [content, setContent] = useState('');
  const [page, setPage] = useState(1);
  const [idempotencyKey, setIdempotencyKey] = useState(makeIdempotencyKey);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['workday-notes', page],
    queryFn: () => workdayNotesApi.list(page, 20) as Promise<any>,
  });
  const createNote = useMutation({
    mutationFn: () => workdayNotesApi.create(content.trim(), idempotencyKey),
    onSuccess: () => {
      toast.success('Note added');
      setContent('');
      setIdempotencyKey(makeIdempotencyKey());
      setPage(1);
      qc.invalidateQueries({ queryKey: ['workday-notes'] });
    },
    onError: (error: any) => toast.error(error?.message ?? 'Could not add note'),
  });
  const notes = data?.notes ?? [];
  const totalPages = Math.max(1, data?.totalPages ?? 1);
  const authorName = user?.name ?? 'You';

  return (
    <div className="mx-auto max-w-5xl">
      <section
        className="overflow-hidden rounded-2xl border"
        style={{ backgroundColor: 'var(--surface-card)', borderColor: 'var(--border-primary)' }}
      >
        <div className="px-4 pb-6 pt-5 sm:px-6">
          <h1 className="text-base font-semibold text-blue-500">Workday Notes</h1>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Private, append-only notes visible only to you.
          </p>

          <textarea
            id="workday-note"
            rows={4}
            maxLength={2000}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Add a new note…"
            className="mt-5 w-full resize-y rounded-xl border bg-transparent px-3 py-3 text-sm outline-none transition-colors focus:border-blue-500"
            style={{ color: 'var(--text-primary)', borderColor: 'var(--border-primary)' }}
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{content.length}/2000</span>
            <button
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!content.trim() || createNote.isPending}
              onClick={() => createNote.mutate()}
            >
              {createNote.isPending ? 'Saving…' : 'Save Note'}
            </button>
          </div>
        </div>

        <div className="px-4 pb-5 sm:px-6">
          {isLoading && <p className="py-5 text-sm" style={{ color: 'var(--text-secondary)' }}>Loading notes…</p>}
          {isError && <p className="py-5 text-sm text-red-600">Could not load notes.</p>}
          {!isLoading && !isError && notes.length === 0 && (
            <p className="py-5 text-sm" style={{ color: 'var(--text-tertiary)' }}>No notes yet.</p>
          )}
          {notes.length > 0 && (
            <div className="relative space-y-3 border-l pl-3" style={{ borderColor: 'var(--border-primary)' }}>
              {notes.map((note: any) => (
                <article
                  key={note.id}
                  className="relative rounded-xl border px-4 py-4"
                  style={{ backgroundColor: 'var(--surface-secondary)', borderColor: 'var(--border-subtle)' }}
                >
                  <span
                    className="absolute -left-[17px] top-5 h-2 w-2 rounded-full border border-blue-500"
                    style={{ backgroundColor: 'var(--surface-card)' }}
                    aria-hidden="true"
                  />
                  <p className="whitespace-pre-wrap break-words text-sm" style={{ color: 'var(--text-primary)' }}>
                    {note.content}
                  </p>
                  <p className="mt-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    <time dateTime={note.createdAt}>
                      {new Date(note.createdAt).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </time>
                    {' · '}{authorName}
                  </p>
                </article>
              ))}
            </div>
          )}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <button className="apex-btn apex-btn-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Page {page} of {totalPages}</span>
              <button className="apex-btn apex-btn-secondary" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
