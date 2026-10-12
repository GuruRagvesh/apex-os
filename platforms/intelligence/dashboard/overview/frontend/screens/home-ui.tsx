import type { ReactNode } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

export function SectionFrame({ icon: Icon, title, subtitle, aside, children, id }: {
  icon: LucideIcon; title: string; subtitle?: string; aside?: ReactNode; children: ReactNode; id?: string;
}) {
  return (
    <section id={id} className="rounded-2xl border border-sky-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
            <Icon size={17} className="text-blue-600 dark:text-blue-400" aria-hidden />{title}
          </h2>
          {subtitle && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">{children}</p>;
}

export function SmallLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">{children} ↗</Link>;
}

export function formatMinutes(minutes: number | null | undefined) {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours ? `${hours}h ${String(rest).padStart(2, '0')}m` : `${rest}m`;
}

export function formatDate(date: string | null | undefined) {
  if (!date) return 'No due date';
  return new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
