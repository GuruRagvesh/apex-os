import Link from 'next/link';
import { cn } from '@apex/shared-utilities';

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  bg: string;
  change?: string;
  sub?: string;
  alert?: boolean;
  href?: string;
}

function CardInner({ label, value, icon, bg, change, sub, alert, href }: StatCardProps) {
  return (
    <div className={cn(
      'bg-white rounded-xl border border-slate-200 p-4',
      alert && 'border-red-200',
      href && 'hover:shadow-md hover:border-slate-300 transition-all cursor-pointer group',
    )}>
      <div className="flex items-center justify-between mb-3">
        <div className={cn('p-2 rounded-lg', bg)}>{icon}</div>
        {alert && <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
      </div>
      <p className={cn('text-2xl font-bold text-slate-800', href && 'group-hover:text-indigo-700 transition-colors')}>
        {value.toLocaleString()}
      </p>
      <p className="text-xs font-medium text-slate-500 mt-0.5">{label}</p>
      {(change || sub) && (
        <p className="text-xs text-slate-400 mt-1">{change || sub}</p>
      )}
    </div>
  );
}

export function StatCard(props: StatCardProps) {
  if (props.href) {
    return (
      <Link href={props.href} className="block">
        <CardInner {...props} />
      </Link>
    );
  }
  return <CardInner {...props} />;
}
