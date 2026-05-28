'use client';

import React, { useState } from 'react';
import { LucideIcon, ArrowUpRight } from 'lucide-react';
import HoverPreview from './HoverPreview';

interface CommandCardProps {
  id: string;
  title: string;
  count: number | string;
  summary: string;
  icon: LucideIcon;
  severity?: 'success' | 'warning' | 'urgent' | 'neutral' | 'blue';
  previewItems: string[];
  onClick: () => void;
}

export default function CommandCard({
  id,
  title,
  count,
  summary,
  icon: Icon,
  severity = 'blue',
  previewItems,
  onClick,
}: CommandCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  // Status-based bullet & badge colors
  const getStyleConfigs = () => {
    switch (severity) {
      case 'urgent':
        return {
          badge: 'bg-red-500 text-white font-mono',
          iconColor: 'text-red-500 group-hover:text-blue-500',
        };
      case 'warning':
        return {
          badge: 'bg-amber-500 text-white font-mono',
          iconColor: 'text-amber-500 group-hover:text-blue-500',
        };
      case 'success':
        return {
          badge: 'bg-emerald-500 text-white font-mono',
          iconColor: 'text-emerald-500 group-hover:text-blue-500',
        };
      default:
        return {
          badge: 'bg-blue-600 text-white font-mono',
          iconColor: 'text-blue-500 group-hover:text-blue-500',
        };
    }
  };

  const style = getStyleConfigs();

  return (
    <button
      id={`command-card-${id}`}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="relative text-left w-full h-full bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-[22px] p-5 flex flex-col justify-between transition-all duration-[220ms] ease-out hover:border-blue-500 hover:shadow-[0_12px_28px_rgba(37,99,235,0.08)] dark:hover:shadow-[0_12px_28px_rgba(37,99,235,0.15)] hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 select-none group"
    >
      {/* Absolute Hover preview peek panel */}
      <div className="hidden md:block">
        <HoverPreview
          items={previewItems}
          visible={isHovered}
          severity={severity}
        />
      </div>

      <div className="w-full flex flex-col gap-3.5">
        {/* Header row */}
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl transition-colors duration-200 ${isHovered ? 'bg-[#EFF6FF] dark:bg-blue-950/40 text-blue-600 dark:text-blue-400' : 'bg-slate-50 dark:bg-slate-900 text-slate-400 dark:text-slate-500'}`}>
              <Icon className="w-5 h-5 transition-transform duration-200 group-hover:scale-110" />
            </div>
            <span className="font-sans font-bold text-[#0B1220] dark:text-slate-100 text-sm tracking-tight group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              {title}
            </span>
          </div>

          <div className={`px-2.5 py-0.5 text-xs font-black rounded-lg ${style.badge}`}>
            {count}
          </div>
        </div>

        {/* Short Summary */}
        <p className="text-slate-500 dark:text-slate-400 text-xs font-semibold pl-0.5 leading-relaxed">
          {summary}
        </p>

        {/* Inline preview rows — always visible when items exist */}
        {previewItems.length > 0 && (
          <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800">
            <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 font-mono uppercase tracking-widest leading-none mb-2">
              Top Items
            </p>
            <div className="space-y-1.5">
              {previewItems.slice(0, 2).map((item, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <span className={`w-1 h-1 rounded-full shrink-0 flex-shrink-0 ${
                    severity === 'urgent' ? 'bg-red-500' :
                    severity === 'warning' ? 'bg-amber-500' :
                    severity === 'success' ? 'bg-emerald-500' :
                    'bg-blue-500'
                  }`} />
                  <span className="text-[10.5px] text-slate-600 dark:text-slate-400 font-medium truncate">{item}</span>
                </div>
              ))}
              {previewItems.length > 2 && (
                <p className="text-[9.5px] text-slate-400 dark:text-slate-500 font-semibold pl-2.5">
                  +{previewItems.length - 2} more — click to view all
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Mini CTA row indicator */}
      <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end w-full transition-colors">
        <ArrowUpRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-600 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
      </div>
    </button>
  );
}

// Named export for backward compatibility with existing dashboard imports
export { CommandCard };
