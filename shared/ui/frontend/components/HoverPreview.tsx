'use client';

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface HoverPreviewProps {
  items: string[];
  visible: boolean;
  severity?: 'success' | 'warning' | 'urgent' | 'neutral' | 'blue';
}

export default function HoverPreview({ items, visible, severity = 'blue' }: HoverPreviewProps) {
  const getBulletColor = () => {
    switch (severity) {
      case 'urgent':
        return 'bg-red-500';
      case 'warning':
        return 'bg-amber-500';
      case 'success':
        return 'bg-emerald-500';
      default:
        return 'bg-blue-500';
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 4 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="absolute left-1/2 -translate-x-1/2 -top-24 w-66 bg-[#0B1220] border border-blue-900/50 rounded-xl p-3.5 shadow-[0_12px_28px_rgba(11,18,32,0.45)] pointer-events-none z-30 select-none text-left"
          style={{ width: '264px' }}
        >
          {/* Glowing bottom indicator */}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-[5px] w-2.5 h-2.5 bg-[#0B1220] border-r border-b border-blue-900/50 rotate-45" />

          <p className="text-[9.5px] font-black font-mono text-blue-400 uppercase tracking-widest border-b border-blue-950/50 pb-1.5 leading-none">
            📡 TELEMETRY PEEK
          </p>

          <div className="mt-2 space-y-1.5 select-text">
            {items.slice(0, 2).map((item, idx) => (
              <div key={idx} className="flex items-start gap-2 text-[10.5px] text-slate-300 font-mono truncate">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${getBulletColor()}`} />
                <span className="truncate leading-none">{item}</span>
              </div>
            ))}

            {items.length === 0 && (
              <p className="text-[10px] text-slate-500 font-semibold italic">No direct items to reveal.</p>
            )}

            {items.length > 2 && (
              <div className="text-[9.5px] text-blue-400 font-bold pl-3.5 leading-none">
                + {items.length - 2} more elements. Click to explore
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
