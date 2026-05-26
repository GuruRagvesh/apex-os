'use client';

import React from 'react';
import { Megaphone } from 'lucide-react';

interface BroadcastItem {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'urgent';
  timestamp?: string;
}

interface AnnouncementBroadcastProps {
  items?: BroadcastItem[];
  emptyMessage?: string;
}

const TYPE_STYLES = {
  info: {
    border: '#2563EB',
    bg: 'rgba(37,99,235,0.04)',
    badge: 'rgba(37,99,235,0.12)',
    badgeText: '#1D4ED8',
    label: 'Info',
  },
  warning: {
    border: '#F59E0B',
    bg: 'rgba(245,158,11,0.04)',
    badge: 'rgba(245,158,11,0.12)',
    badgeText: '#B45309',
    label: 'Notice',
  },
  urgent: {
    border: '#EF4444',
    bg: 'rgba(239,68,68,0.04)',
    badge: 'rgba(239,68,68,0.12)',
    badgeText: '#B91C1C',
    label: 'Urgent',
  },
};

export function AnnouncementBroadcast({
  items,
  emptyMessage = 'No urgent broadcasts today.',
}: AnnouncementBroadcastProps) {
  if (!items || items.length === 0) {
    return (
      <div
        className="rounded-xl px-5 py-4 flex items-center gap-3"
        style={{
          backgroundColor: 'var(--surface-card)',
          border: '1px solid var(--border-primary)',
        }}
      >
        <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
          <Megaphone size={16} className="text-slate-400" />
        </div>
        <p className="text-sm text-slate-400 dark:text-slate-500">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const style = TYPE_STYLES[item.type] ?? TYPE_STYLES.info;
        return (
          <div
            key={item.id}
            className="rounded-xl px-5 py-3"
            style={{
              backgroundColor: style.bg,
              borderLeft: `3px solid ${style.border}`,
              border: `1px solid ${style.border}30`,
            }}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: style.badge, color: style.badgeText }}
                  >
                    {style.label}
                  </span>
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{item.title}</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{item.message}</p>
              </div>
              {item.timestamp && (
                <span className="text-[10px] text-slate-400 flex-shrink-0 font-mono">{item.timestamp}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
