export function Card({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`rounded-2xl border ${className}`}
      style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', ...style }}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ReactNode;
}) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {label}
        </span>
        {icon && (
          <div className="p-1.5 rounded-lg" style={{ background: 'var(--color-primary-soft)' }}>
            {icon}
          </div>
        )}
      </div>
      <div className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
          {sub}
        </div>
      )}
    </Card>
  );
}
