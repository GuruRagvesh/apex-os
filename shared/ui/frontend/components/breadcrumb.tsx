import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="flex items-center gap-1 text-xs text-slate-400 mb-1 flex-wrap">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={12} className="text-slate-300 flex-shrink-0" />}
          {item.href ? (
            <Link
              href={item.href}
              className="hover:text-slate-600 transition-colors hover:underline"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-slate-600 font-medium">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
