'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { ticketsApi, projectsApi, teamApi } from '@/lib/api';
import { Search, Ticket, FolderKanban, Users, ArrowRight, X } from 'lucide-react';
import { cn } from '@apex/shared-utilities';

interface SearchResult {
  id:       string;
  label:    string;
  sub?:     string;
  badge?:   string;
  href:     string;
  group:    'Tickets' | 'Projects' | 'People';
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const GROUP_ICONS: Record<string, React.ReactNode> = {
  Tickets:  <Ticket size={13} className="text-blue-500" />,
  Projects: <FolderKanban size={13} className="text-indigo-500" />,
  People:   <Users size={13} className="text-emerald-500" />,
};

interface CommandPaletteProps {
  open:    boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router   = useRouter();
  const { user } = useAuthStore();
  const roleName = (user?.role as any)?.name || (user?.role as any) || '';
  const canSearchPeople = ['ADMIN', 'SUPER_ADMIN', 'MANAGER'].includes(roleName);

  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor,  setCursor]  = useState(0);

  const inputRef    = useRef<HTMLInputElement>(null);
  const listRef     = useRef<HTMLUListElement>(null);
  const debouncedQ  = useDebounce(query, 300);

  // Focus input when palette opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setResults([]);
      setCursor(0);
    }
  }, [open]);

  // Keyboard shortcut: Ctrl+K / Cmd+K handled by parent; Escape closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Search
  useEffect(() => {
    if (!debouncedQ.trim()) { setResults([]); setLoading(false); return; }

    let cancelled = false;
    setLoading(true);

    const run = async () => {
      try {
        const params = { search: debouncedQ, limit: 5 };

        const [ticketRes, projectRes, peopleRes] = await Promise.allSettled([
          ticketsApi.getAll(params) as Promise<any>,
          projectsApi.getAll(params) as Promise<any>,
          canSearchPeople ? (teamApi.getDirectory() as Promise<any[]>) : Promise.resolve([]),
        ]);

        if (cancelled) return;

        const out: SearchResult[] = [];

        // Tickets
        if (ticketRes.status === 'fulfilled') {
          const list: any[] = ticketRes.value?.tickets ?? ticketRes.value ?? [];
          list.slice(0, 5).forEach((t: any) => {
            out.push({
              id:    t.id,
              label: t.title,
              sub:   t.ticketId,
              badge: t.status,
              href:  `/tickets/${t.id}`,
              group: 'Tickets',
            });
          });
        }

        // Projects
        if (projectRes.status === 'fulfilled') {
          const list: any[] = projectRes.value?.projects ?? projectRes.value ?? [];
          list.slice(0, 5).forEach((p: any) => {
            out.push({
              id:    p.id,
              label: p.name,
              sub:   p.projectId,
              badge: p.status,
              href:  `/projects/${p.id}`,
              group: 'Projects',
            });
          });
        }

        // People — filter client-side by the search term
        if (peopleRes.status === 'fulfilled') {
          const list: any[] = Array.isArray(peopleRes.value) ? peopleRes.value : [];
          const q = debouncedQ.toLowerCase();
          list
            .filter((u: any) =>
              u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q),
            )
            .slice(0, 5)
            .forEach((u: any) => {
              out.push({
                id:    u.id,
                label: u.name,
                sub:   u.department?.name ?? u.email,
                badge: u.role?.name,
                href:  `/users/${u.id}`,
                group: 'People',
              });
            });
        }

        setResults(out);
        setCursor(0);
      } catch {
        // silently ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [debouncedQ, canSearchPeople]);

  // Arrow-key navigation + Enter
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter' && results[cursor]) {
        e.preventDefault();
        navigate(results[cursor]);
      }
    },
    [results, cursor],
  );

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const navigate = (result: SearchResult) => {
    onClose();
    router.push(result.href);
  };

  if (!open) return null;

  // Group results
  const groups = (['Tickets', 'Projects', 'People'] as const).filter((g) =>
    results.some((r) => r.group === g),
  );

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[12vh] px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ background: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200"
        style={{ maxHeight: '70vh' }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100">
          <Search size={18} className="text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tickets, projects, people…"
            className="flex-1 text-sm text-slate-800 placeholder:text-slate-400 outline-none bg-transparent"
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin flex-shrink-0" />
          )}
          <button
            onClick={onClose}
            className="flex-shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(70vh - 57px)' }}>
          {!query.trim() && (
            <div className="py-10 text-center text-sm text-slate-400">
              <Search size={32} className="mx-auto mb-3 opacity-30" />
              Type to search across tickets, projects and people
            </div>
          )}

          {query.trim() && !loading && results.length === 0 && (
            <div className="py-10 text-center text-sm text-slate-400">
              <span className="text-2xl block mb-2">🔍</span>
              No results for <strong className="text-slate-600">"{query}"</strong>
            </div>
          )}

          {groups.length > 0 && (
            <ul ref={listRef} className="py-2">
              {groups.map((group) => {
                const items = results.filter((r) => r.group === group);
                return (
                  <li key={group}>
                    {/* Group header */}
                    <div className="flex items-center gap-2 px-4 py-1.5 mt-1">
                      {GROUP_ICONS[group]}
                      <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                        {group}
                      </span>
                    </div>
                    {/* Items */}
                    {items.map((result) => {
                      const globalIdx = results.indexOf(result);
                      const isActive  = globalIdx === cursor;
                      return (
                        <button
                          key={result.id + result.group}
                          className={cn(
                            'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                            isActive ? 'bg-blue-50' : 'hover:bg-slate-50',
                          )}
                          onMouseEnter={() => setCursor(globalIdx)}
                          onClick={() => navigate(result)}
                        >
                          <div className="flex-1 min-w-0">
                            <p className={cn(
                              'text-sm font-medium truncate',
                              isActive ? 'text-blue-700' : 'text-slate-800',
                            )}>
                              {result.label}
                            </p>
                            {result.sub && (
                              <p className="text-xs text-slate-400 truncate mt-0.5">
                                {result.sub}
                              </p>
                            )}
                          </div>
                          {result.badge && (
                            <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded uppercase tracking-wide">
                              {result.badge}
                            </span>
                          )}
                          {isActive && (
                            <ArrowRight size={14} className="flex-shrink-0 text-blue-400" />
                          )}
                        </button>
                      );
                    })}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-slate-100 flex items-center gap-4 text-[11px] text-slate-400">
          <span><kbd className="font-mono bg-slate-100 px-1 rounded">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono bg-slate-100 px-1 rounded">↵</kbd> open</span>
          <span><kbd className="font-mono bg-slate-100 px-1 rounded">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
