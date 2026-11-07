import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="flex items-center gap-1 text-xs text-apex-muted mb-1 flex-wrap">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={12} className="text-apex-muted flex-shrink-0" />}
          {item.href ? (
            <Link
              href={item.href}
              className="hover:text-apex-text transition-colors hover:underline"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-apex-text font-medium">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
