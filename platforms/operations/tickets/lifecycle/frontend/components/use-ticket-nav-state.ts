'use client';

// Operations Tickets — navigation state hooks.
//
// Thin browser glue over ../../shared/ticket-nav-state (the schemas, TTL,
// namespacing and validation live there and are unit-tested). Everything here
// is local UI: it reads and writes history.state and sessionStorage, and moves
// scroll positions. It has no network access and never calls an API, so
// restoring state can never change a ticket, a workday or a clock.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  buildEnvelope,
  readHistory,
  readStored,
  removeStored,
  tabIdFor,
  takeBackOrigin,
  ticketIdFromHref,
  writeBackOrigin,
  writeHistory,
  writeStored,
  type KeyStorage,
  type NavData,
  type NavPage,
  type Scroll,
} from '../../shared/ticket-nav-state';

/** The dashboard's scroll container (the window itself does not scroll). */
export const MAIN_SCROLL_ID = 'apex-main-content';

function session(): KeyStorage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

function newTabId(): string {
  try { return crypto.randomUUID(); } catch { return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`; }
}

export function mainScrollElement(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.getElementById(MAIN_SCROLL_ID);
}

export function scrollOf(el: Element | null | undefined): Scroll {
  return el ? { x: Math.max(0, Math.round(el.scrollLeft)), y: Math.max(0, Math.round(el.scrollTop)) } : { x: 0, y: 0 };
}

/**
 * This page's saved state for `path`, read once per mount (Back, Forward and a
 * refresh all mount the page again), and a `save` for it.
 *
 * `restored` is null until `checked` is true, and stays null when there is
 * nothing acceptable to restore. `save` writes history.state (merged, Next.js
 * keys kept) and the sessionStorage fallback; `save(data, { historyToo: false })`
 * writes only the fallback, for use while the page is being left.
 */
export function useTicketNavState<P extends NavPage>(page: P, path: string, userId: string | null | undefined) {
  const [restored, setRestored] = useState<NavData[P] | null>(null);
  const [checked, setChecked] = useState(false);
  const tabRef = useRef<string | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    if (checked || !userId) return;
    const storage = session();
    try {
      if (storage) {
        const tabId = tabIdFor(storage, newTabId);
        tabRef.current = tabId;
        const want = { userId, tabId, page, path: pathRef.current, nowMs: Date.now() };
        setRestored(readHistory(window.history, want) ?? readStored(storage, want));
      }
    } catch {
      setRestored(null);
    }
    setChecked(true);
  }, [checked, userId, page]);

  const save = useCallback((data: NavData[P], opts: { historyToo?: boolean } = {}) => {
    const storage = session();
    if (!userId || !storage) return;
    try {
      const tabId = tabRef.current ?? tabIdFor(storage, newTabId);
      tabRef.current = tabId;
      const env = buildEnvelope(page, data, { userId, tabId, path: pathRef.current, nowMs: Date.now() });
      if (!env) return;
      if (opts.historyToo !== false) writeHistory(window.history, env);
      writeStored(storage, env);
    } catch { /* storage full or blocked: navigation state is a convenience */ }
  }, [page, userId]);

  const clear = useCallback(() => {
    const storage = session();
    if (!userId || !storage) return;
    try {
      const tabId = tabRef.current ?? tabIdFor(storage, newTabId);
      removeStored(storage, userId, tabId, page, pathRef.current);
      writeHistory(window.history, null);
    } catch { /* ignore */ }
  }, [page, userId]);

  return { restored, checked, save, clear };
}

/** How long a restore keeps waiting for the page to grow tall enough to reach its position. */
export const RESTORE_WAIT_MS = 3000;

/**
 * Runs `apply` once `ready` is true: first before the browser paints, so a
 * restored position normally never shows as a jump. `apply` returns false
 * while the content is still too short to reach the saved position (rows
 * still rendering); it is then retried briefly until it succeeds, and the
 * last try is final (`force`).
 */
export function useRestoreOnce(ready: boolean, apply: (force: boolean) => boolean) {
  const done = useRef(false);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useLayoutEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    if (applyRef.current(false)) return;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const retry = () => {
      const last = Date.now() - started >= RESTORE_WAIT_MS;
      if (applyRef.current(last) || last) return;
      timer = setTimeout(retry, 50);
    };
    timer = setTimeout(retry, 50);
    return () => clearTimeout(timer);
  }, [ready]);
}

/**
 * Scrolls `el` to `to` if its content is tall/wide enough to get there (or
 * `force`), and reports whether the position was reached.
 */
export function scrollElementTo(el: HTMLElement | null | undefined, to: Partial<Scroll>, force: boolean): boolean {
  if (!el) return true;
  const x = to.x ?? 0;
  const y = to.y ?? 0;
  const reachable = el.scrollHeight - el.clientHeight >= y && el.scrollWidth - el.clientWidth >= x;
  if (!reachable && !force) return false;
  if (to.x !== undefined) el.scrollLeft = x;
  if (to.y !== undefined) el.scrollTop = y;
  return true;
}

/** Calls `onScroll` (at most every `waitMs`, and once more when scrolling stops) while `el` scrolls. */
export function useThrottledScroll(getElements: () => Array<Element | null>, onScroll: () => void, enabled: boolean, waitMs = 200) {
  const cb = useRef(onScroll);
  cb.current = onScroll;
  useEffect(() => {
    if (!enabled) return;
    const els = getElements().filter((e): e is Element => !!e);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; cb.current(); }, waitMs);
    };
    els.forEach((el) => el.addEventListener('scroll', handler, { passive: true }));
    return () => {
      els.forEach((el) => el.removeEventListener('scroll', handler));
      if (timer) clearTimeout(timer);
    };
  // getElements is read when enabled flips or deps change; callers pass the deps that change their elements.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, waitMs]);
}

/**
 * Records which list a ticket was opened from, when a click inside
 * `containerRef` is on a ticket link or a Kanban card. Capture phase, so it
 * sees the click before the link navigates; it only writes sessionStorage.
 */
export function useRecordTicketOpen(containerRef: RefObject<HTMLElement>, userId: string | null | undefined, path: string) {
  const pathRef = useRef(path);
  pathRef.current = path;
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !userId) return;
    const record = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const card = target.closest('[data-ticket-id]');
      const link = target.closest('a[href]');
      const id = card?.getAttribute('data-ticket-id') ?? ticketIdFromHref(link?.getAttribute('href'));
      const storage = session();
      if (id && storage) {
        try { writeBackOrigin(storage, userId, pathRef.current, id, Date.now()); } catch { /* ignore */ }
      }
    };
    const onClick = (e: MouseEvent) => record(e.target);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter') record(e.target); };
    el.addEventListener('click', onClick, true);
    el.addEventListener('keydown', onKey, true);
    return () => {
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('keydown', onKey, true);
    };
  }, [containerRef, userId]);
}

/** The list path this ticket was opened from (Tickets or Kanban), if it was opened straight from one. */
export function useTicketBackOrigin(ticketRouteId: string | null | undefined, userId: string | null | undefined) {
  // Keyed by ticket: moving from one ticket to another inside the detail page
  // must not let the second ticket's Back reuse the first one's origin.
  const origin = useRef<{ ticketId: string; path: string } | null>(null);
  useEffect(() => {
    const storage = session();
    if (!storage || !ticketRouteId || !userId) return;
    try {
      const found = takeBackOrigin(storage, userId, ticketRouteId, Date.now());
      if (found) origin.current = { ticketId: ticketRouteId, path: found };
    } catch { /* ignore */ }
  }, [ticketRouteId, userId]);
  return useCallback(
    () => (origin.current && origin.current.ticketId === ticketRouteId ? origin.current.path : null),
    [ticketRouteId],
  );
}
