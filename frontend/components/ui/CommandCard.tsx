'use client';

import React from 'react';

interface CommandCardProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  accentColor?: string;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
}

export function CommandCard({
  title,
  subtitle,
  icon,
  accentColor = '#2563EB',
  footer,
  className = '',
  children,
  onClick,
}: CommandCardProps) {
  return (
    <div
      className={`rounded-2xl overflow-hidden shadow-sm border border-slate-200 dark:border-slate-700/50 transition-all duration-150 ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={{
        borderLeft: `3px solid ${accentColor}`,
        transform: 'translateY(0)',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
      }}
      onClick={onClick}
      onMouseEnter={onClick ? (e) => {
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
        (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)';
      } : undefined}
      onMouseLeave={onClick ? (e) => {
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
        (e.currentTarget as HTMLElement).style.boxShadow = '';
      } : undefined}
    >
      {/* Dark navy header */}
      <div
        className="px-5 py-4 flex items-center gap-3"
        style={{ backgroundColor: '#0B1220' }}
      >
        {icon && (
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
          >
            {icon}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">{title}</h3>
          {subtitle && (
            <p className="text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>
          )}
        </div>
      </div>

      {/* White/light body */}
      <div className="bg-white dark:bg-slate-900 px-5 py-4">
        {children}
      </div>

      {/* Optional footer */}
      {footer && (
        <div className="bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-700/50 px-5 py-3">
          {footer}
        </div>
      )}
    </div>
  );
}
