'use client';

import React, { useState } from 'react';
import { Megaphone, Calendar, CheckSquare, Sparkles, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AnnouncementBroadcastProps {
  onAddCalendar?: () => void;
  eventTitle?: string;
  onOpenAnnouncement?: () => void;
  // Legacy compat props
  items?: any[];
  emptyMessage?: string;
  alertCount?: number;
}

export function AnnouncementBroadcast({
  onAddCalendar,
  eventTitle = 'No active operational alerts',
  onOpenAnnouncement,
  alertCount = 0,
}: AnnouncementBroadcastProps) {
  const [added, setAdded] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const hasAlert = eventTitle !== 'No active operational alerts' && eventTitle !== 'No active broadcasts today';

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasAlert && onOpenAnnouncement) {
      onOpenAnnouncement();
      return;
    }
    setAdded(true);
    onAddCalendar?.();
    setTimeout(() => {
      setAdded(false);
    }, 4050);
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div
      onClick={onOpenAnnouncement}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group relative overflow-visible bg-[#0B1220] border border-blue-900/35 rounded-2xl p-4 mb-6 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4 cursor-pointer hover:border-blue-500 transition-all duration-200 select-none"
    >
      {/* Blue left accent */}
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 rounded-l-2xl group-hover:bg-blue-400 transition-colors" />

      {/* Broadcast message elements */}
      <div className="flex items-center gap-4 pl-2 flex-1 w-full">
        {/* Broadcast icon in rounded square, only pulses ONCE on mount */}
        <motion.div
          initial={{ scale: 0.82 }}
          animate={{ scale: [0.82, 1.15, 1] }}
          transition={{ duration: 0.65, ease: 'easeOut' }}
          className="p-2.5 rounded-xl bg-blue-900/40 border border-blue-800/40 text-blue-400 shrink-0 shadow-xs"
        >
          <Megaphone className="w-5 h-5" />
        </motion.div>

        <div className="space-y-1 text-left">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-mono uppercase tracking-wider leading-none">
            <span className={`font-bold ${hasAlert ? 'text-red-400' : 'text-blue-400'}`}>
              {hasAlert ? 'Operational Alert' : 'Latest Alert'}
            </span>
            <span className="text-slate-400 font-semibold">• {today}</span>
            {hasAlert && alertCount > 1 && (
              <span className="bg-red-900/40 text-red-400 border border-red-800/40 px-1.5 py-0.5 rounded text-[9px] font-bold">
                {alertCount} active
              </span>
            )}
          </div>
          <h3 className="text-sm font-bold text-white tracking-tight flex flex-wrap items-center gap-1.5 leading-tight">
            <span>{hasAlert ? eventTitle : 'No active operational alerts'}</span>
            {hasAlert && (
              <>
                <span className="text-slate-400 font-normal">|</span>
                <span className="text-slate-400 font-medium text-xs">Click to view all alerts and take action</span>
              </>
            )}
          </h3>
        </div>
      </div>

      {/* Add To Calendar Button */}
      <div className="flex items-center justify-end pr-2 shrink-0 select-none">
        <button
          onClick={handleAdd}
          disabled={added || !hasAlert}
          className={`px-4 py-2 rounded-xl font-bold text-[11px] font-sans tracking-wide transition-all uppercase flex items-center gap-1.5 cursor-pointer ${
            added
              ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-800/50'
              : !hasAlert
              ? 'border border-slate-700/50 text-slate-600 cursor-not-allowed opacity-50'
              : 'border border-red-900/50 text-red-400 hover:bg-red-950/40'
          }`}
        >
          {added ? (
            <>
              <CheckSquare className="w-3.5 h-3.5" />
              <span>OPENED</span>
            </>
          ) : hasAlert ? (
            <>
              <Info className="w-3.5 h-3.5" />
              <span>View All</span>
            </>
          ) : (
            <>
              <Calendar className="w-3.5 h-3.5" />
              <span>All Clear</span>
            </>
          )}
        </button>
      </div>

      {/* Micro tech decorative elements */}
      <div className="absolute right-3 top-3 opacity-[0.03] select-none pointer-events-none">
        <Sparkles className="w-16 h-16 text-white" />
      </div>

      {/* Hover Broadcast Strip preview details */}
      <AnimatePresence>
        {isHovered && onOpenAnnouncement && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.18 }}
            className="absolute left-6 right-6 bottom-full mb-3 bg-[#0B1220] border border-blue-900/60 rounded-2xl p-4 shadow-xl z-20 text-left pointer-events-none select-none max-w-sm"
          >
            <div className="flex items-start gap-2.5">
              <div className="p-1.5 rounded-lg bg-blue-950 text-blue-400 shrink-0">
                <Info className="w-3.5 h-3.5" />
              </div>
              <div className="space-y-1.5 font-sans">
                <h4 className="text-xs font-bold text-white">{hasAlert ? 'Operational Alert Details' : 'Alert Status'}</h4>
                <div className="space-y-1 font-semibold text-[10px] text-slate-400">
                  <p><span className={hasAlert ? 'text-red-400' : 'text-blue-400'}>Alert:</span> {hasAlert ? eventTitle : 'No active alerts at this time'}</p>
                  <p><span className="text-blue-400">Scope:</span> All team members in your operational scope</p>
                  <p><span className="text-blue-400">Action:</span> {hasAlert ? 'Click to view all alerts and take action' : 'You\'re all clear — no action required'}</p>
                </div>
              </div>
            </div>
            <div className="absolute left-[20px] top-full border-[6px] border-transparent border-t-[#0B1220]" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default AnnouncementBroadcast;
