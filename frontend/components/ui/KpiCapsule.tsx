'use client';

import React, { useState } from 'react';
import { LucideIcon, ArrowUpRight, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface KpiCapsuleProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  subtext: string;
  previewItems?: string[];
  statusType: 'blue' | 'green' | 'orange' | 'red';
  onClick: () => void;
}

export default function KpiCapsule({
  label,
  value,
  icon: Icon,
  subtext,
  previewItems = [],
  statusType,
  onClick,
}: KpiCapsuleProps) {
  const [isHovered, setIsHovered] = useState(false);

  const getTheme = () => {
    switch (statusType) {
      case 'green':
        return {
          pulse: 'bg-emerald-500',
          textColor: 'text-emerald-600 dark:text-emerald-400',
          hoverBg: 'hover:bg-[#F0FDF4] dark:hover:bg-emerald-950/20',
          borderColor: 'hover:border-emerald-300 dark:hover:border-emerald-800',
          glow: 'hover:shadow-[0_8px_20px_rgba(16,185,129,0.06)]',
        };
      case 'orange':
        return {
          pulse: 'bg-amber-500',
          textColor: 'text-amber-600 dark:text-amber-400',
          hoverBg: 'hover:bg-[#FFFBEB] dark:hover:bg-amber-950/20',
          borderColor: 'hover:border-amber-300 dark:hover:border-amber-800',
          glow: 'hover:shadow-[0_8px_20px_rgba(245,158,11,0.06)]',
        };
      case 'red':
        return {
          pulse: 'bg-red-500',
          textColor: 'text-red-600 dark:text-red-400',
          hoverBg: 'hover:bg-[#FEF2F2] dark:hover:bg-red-950/20',
          borderColor: 'hover:border-red-300 dark:hover:border-red-800',
          glow: 'hover:shadow-[0_8px_20px_rgba(239,68,68,0.06)]',
        };
      default:
        return {
          pulse: 'bg-blue-600',
          textColor: 'text-blue-600 dark:text-blue-400',
          hoverBg: 'hover:bg-[#F2F7FF] dark:hover:bg-blue-950/20',
          borderColor: 'hover:border-blue-300 dark:hover:border-blue-800',
          glow: 'hover:shadow-[0_8px_20px_rgba(37,99,235,0.06)]',
        };
    }
  };

  const theme = getTheme();

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative w-full bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col justify-between transition-all duration-[220ms] ease-out text-left cursor-pointer group hover:scale-[1.01] hover:-translate-y-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500 hover:border-blue-500 dark:hover:border-blue-500 ${theme.hoverBg} ${theme.glow}`}
    >
      <div className="w-full space-y-2.5">

        {/* Header summary: label and icon */}
        <div className="flex items-center justify-between select-none">
          <span className="text-[10.5px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest leading-none">
            {label}
          </span>
          <div className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-400 dark:text-slate-500 group-hover:bg-blue-50 dark:group-hover:bg-blue-950/40 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors shrink-0">
            <Icon className="w-4 h-4 transition-transform duration-200 group-hover:scale-105" />
          </div>
        </div>

        {/* Data readout */}
        <div className="flex items-baseline justify-between select-none">
          <div className="flex items-center gap-2">
            <span className={`text-3xl font-black font-mono tracking-tight transition-colors duration-200 ${
              isHovered ? theme.textColor : 'text-slate-900 dark:text-white'
            }`}>
              {value}
            </span>
            {/* Soft pulsing state dot */}
            <span className={`w-1.5 h-1.5 rounded-full ${theme.pulse} opacity-40`} />
          </div>
          <ArrowUpRight className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 group-hover:text-blue-500 transition-all duration-[220ms] ease-out shrink-0" />
        </div>

        {/* Dynamic Static Inline Indicator */}
        <div className="h-4 select-none pointer-events-none mt-1">
          <AnimatePresence mode="wait">
            {!isHovered ? (
              <motion.p
                key="static-text"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.15 }}
                className="text-[11px] text-slate-400 dark:text-slate-400 font-semibold truncate capitalize"
              >
                {subtext}
              </motion.p>
            ) : (
              <motion.p
                key="details-text"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.15 }}
                className="text-[11px] text-blue-600 dark:text-blue-400 font-bold truncate flex items-center gap-1"
              >
                <span>View full details</span>
                <ArrowRight className="w-3 h-3" />
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Dynamic reveal of Top 2 items previews in Hover State */}
        <div className="overflow-hidden w-full select-none">
          <AnimatePresence>
            {isHovered && previewItems && previewItems.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0, marginTop: 0 }}
                animate={{ opacity: 1, height: 'auto', marginTop: 10 }}
                exit={{ opacity: 0, height: 0, marginTop: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                className="border-t border-slate-100 dark:border-slate-800 pt-2.5 space-y-1.5 font-sans"
              >
                <div className="text-[9px] font-black text-slate-400 dark:text-slate-500 font-mono tracking-wider uppercase leading-none">
                  TELEMETRY PEEK
                </div>
                <div className="space-y-1 select-none">
                  {previewItems.slice(0, 2).map((item, idx) => (
                    <div
                      key={idx}
                      className="text-[10px] text-slate-600 dark:text-slate-400 font-medium truncate flex items-center gap-1.5 leading-none"
                    >
                      <span className="w-1 h-1 rounded-full bg-blue-500 shrink-0" />
                      <span className="truncate">{item}</span>
                    </div>
                  ))}
                </div>
                {/* View Details clickable overlay */}
                <div className="flex items-center gap-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 pt-1 leading-none select-none">
                  <span>View details</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>
    </button>
  );
}

// Named export for backward compatibility
export { KpiCapsule };
