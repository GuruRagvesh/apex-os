import { type LucideIcon } from 'lucide-react';

export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="p-3 rounded-xl mb-4" style={{ background: 'var(--color-primary-soft)' }}>
        <Icon size={22} style={{ color: 'var(--color-primary-text)' }} />
      </div>
      <h3 className="text-sm font-semibold mb-1.5" style={{ color: 'var(--color-text-primary)' }}>
        {title}
      </h3>
      <p className="text-xs max-w-sm" style={{ color: 'var(--color-text-muted)' }}>
        {description}
      </p>
    </div>
  );
}
