'use client';

import React from 'react';

export interface KpiCapsuleProps {
  label: string;
  value: number | string;
  icon?: React.ReactNode;
  color?: string;
  trend?: { direction: 'up' | 'down' | 'neutral'; value: string };
  onClick?: () => void;
}

export function KpiCapsule({ label, value, icon, color = '#2563EB', trend, onClick }: KpiCapsuleProps) {
  const trendColor =
    trend?.direction === 'up' ? '#10B981' :
    trend?.direction === 'down' ? '#EF4444' :
    '#64748B';

  const trendArrow =
    trend?.direction === 'up' ? '↑' :
    trend?.direction === 'down' ? '↓' :
    '→';

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-900 shadow-sm transition-all duration-150 ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
      onMouseEnter={onClick ? (e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 2px ${color}40`;
        (e.currentTarget as HTMLElement).style.borderColor = color;
      } : undefined}
      onMouseLeave={onClick ? (e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = '';
        (e.currentTarget as HTMLElement).style.borderColor = '';
      } : undefined}
    >
      {icon && (
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: `${color}15`, color }}
        >
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span
            className="text-2xl font-bold leading-none"
            style={{ fontFamily: 'var(--font-mono, JetBrains Mono, monospace)', color: 'var(--text-primary, #0f172a)' }}
          >
            {value ?? 0}
          </span>
          {trend && (
            <span className="text-xs font-semibold" style={{ color: trendColor }}>
              {trendArrow} {trend.value}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{label}</p>
      </div>
    </div>
  );
}
