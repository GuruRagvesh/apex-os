'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { ModalPortal } from '../ui/ModalPortal';

/**
 * The right-side Attendance context drawer.
 *
 * Drill-down without navigating away: the page behind stays visible and keeps
 * its scroll position, so an employee can open a day, read its evidence and
 * close it without losing where they were. That is the whole point of a drawer
 * rather than a route — fifteen separate pages would each be a round trip.
 *
 * Portaled to document.body for the same reason the modals are: a transformed
 * ancestor becomes the containing block for fixed descendants, and the drawer
 * would then be pinned to that ancestor instead of the viewport.
 *
 * Roughly half the screen on desktop, full width on mobile, where a 50% panel
 * would be unusable.
 */
export function AttendanceDrawer({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const getFocusable = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
    ) ?? []);

    const focusFrame = requestAnimationFrame(() =>
      (getFocusable()[0] ?? panelRef.current)?.focus(),
    );

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        e.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = originalOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[9998]">
        {/* Deliberately light: the page behind should remain readable, which
            is what separates a context drawer from a modal. */}
        <div
          className="absolute inset-0 bg-black/30"
          onClick={onClose}
          aria-hidden="true"
        />

        <aside
          ref={panelRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="absolute inset-y-0 right-0 flex w-full flex-col shadow-2xl sm:w-[92%] md:w-[55%] lg:w-[48%]"
          style={{ backgroundColor: 'var(--surface-elevated)' }}
        >
          <header className="flex items-start justify-between gap-3 border-b border-[var(--border-secondary)] px-5 py-4">
            <div className="min-w-0">
              <h2 className="apex-text truncate text-sm font-semibold">{title}</h2>
              {subtitle && <p className="apex-text-muted mt-0.5 text-xs">{subtitle}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="apex-text-muted flex-shrink-0 rounded-lg p-1 hover:bg-[var(--bg-tertiary)]"
            >
              <X size={16} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </aside>
      </div>
    </ModalPortal>
  );
}

/** A labelled fact, matching the density used elsewhere in Attendance. */
export function DrawerFact({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  value: string;
  tone?: 'normal' | 'warn' | 'good';
}) {
  const colour =
    tone === 'warn'
      ? 'text-amber-600 dark:text-amber-400'
      : tone === 'good'
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'apex-text';
  return (
    <div>
      <dt className="apex-text-subtle text-xs font-medium">{label}</dt>
      <dd className={`mt-0.5 text-sm font-semibold ${colour}`}>{value}</dd>
    </div>
  );
}

export function DrawerSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5">
      <h3 className="apex-text-subtle mb-2 text-xs font-semibold uppercase tracking-wide">
        {title}
      </h3>
      {children}
    </section>
  );
}
