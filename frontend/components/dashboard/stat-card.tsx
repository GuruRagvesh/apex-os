import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  bg: string;
  change?: string;
  sub?: string;
  alert?: boolean;
}

export function StatCard({ label, value, icon, bg, change, sub, alert }: StatCardProps) {
  return (
    <div className={cn('bg-white rounded-xl border border-slate-200 p-4', alert && 'border-red-200')}>
      <div className="flex items-center justify-between mb-3">
        <div className={cn('p-2 rounded-lg', bg)}>{icon}</div>
        {alert && <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
      </div>
      <p className="text-2xl font-bold text-slate-800">{value.toLocaleString()}</p>
      <p className="text-xs font-medium text-slate-500 mt-0.5">{label}</p>
      {(change || sub) && (
        <p className="text-xs text-slate-400 mt-1">{change || sub}</p>
      )}
    </div>
  );
}
