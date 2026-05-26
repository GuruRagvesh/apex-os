'use client';

import React from 'react';
import { ShieldAlert, Calendar, User, ArrowRight, ExternalLink } from 'lucide-react';

interface Ticket {
  id: string;
  title: string;
  priority: string;
  status?: string;
  category?: string;
  assignee?: string;
  dueDate?: string;
  progress?: number;
}

interface HighPriorityTicketsPreviewProps {
  tickets: Ticket[];
  onOpenTicket?: (ticketId: string) => void;
  onViewAllTickets?: () => void;
}

export default function HighPriorityTicketsPreview({
  tickets,
  onOpenTicket,
  onViewAllTickets,
}: HighPriorityTicketsPreviewProps) {
  // Grab high priority / urgent tickets
  const urgentTickets = tickets.filter(
    (t) =>
      t.priority === 'Urgent' ||
      t.priority === 'URGENT' ||
      t.priority === 'High' ||
      t.priority === 'HIGH',
  );

  return (
    <div className="space-y-6">
      {/* Short instructions block */}
      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 rounded-xl p-3.5 flex items-start gap-2.5">
        <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-xs text-[#0F172A] dark:text-amber-400 font-medium leading-relaxed">
          <p className="font-bold uppercase tracking-wider text-[10px] text-amber-700 dark:text-amber-300 font-mono mb-0.5">
            QC SLA Bounds Warning
          </p>
          The items shown below are flagmarked high-priority. Please check assignees, review QA code merges, and verify release credentials.
        </div>
      </div>

      <div className="space-y-3">
        {urgentTickets.length === 0 && (
          <div className="py-8 text-center bg-slate-50 dark:bg-slate-900/20 border rounded-xl border-dashed border-slate-200 dark:border-slate-800 space-y-2">
            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">No High Priority Tickets</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">
              All tickets are within normal priority bounds.
            </p>
          </div>
        )}

        {urgentTickets.map((t) => (
          <div
            key={t.id}
            className="p-4 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800/80 rounded-xl hover:border-blue-400 dark:hover:border-slate-700 hover:shadow-sm transition-all space-y-3 group"
          >
            {/* Header info */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold text-slate-400 dark:text-slate-500 group-hover:text-blue-500 transition-colors">
                  {t.id}
                </span>
                <span className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded-md border ${
                  t.priority === 'Urgent' || t.priority === 'URGENT'
                    ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900/50'
                    : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/50'
                }`}>
                  {t.priority}
                </span>
              </div>

              {t.category && (
                <span className="text-[11px] font-bold font-mono text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border border-transparent dark:border-blue-900/40 px-2 py-0.5 rounded">
                  {t.category}
                </span>
              )}
            </div>

            {/* Title */}
            <div>
              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 tracking-tight leading-snug group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                {t.title}
              </h4>
            </div>

            {/* Progress indicators */}
            {typeof t.progress === 'number' && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] font-bold font-mono text-slate-400 dark:text-slate-500">
                  <span>Confidence Tracker</span>
                  <span className="text-slate-700 dark:text-slate-300">{t.progress}%</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      t.priority === 'Urgent' || t.priority === 'URGENT' ? 'bg-red-500' : 'bg-blue-500'
                    }`}
                    style={{ width: `${t.progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Bottom Meta */}
            <div className="flex items-center justify-between pt-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 border-t border-slate-50 dark:border-slate-800">
              {t.assignee && (
                <div className="flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                  <span>{t.assignee}</span>
                </div>
              )}

              {t.dueDate && (
                <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                  <Calendar className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                  <span>Due: {t.dueDate}</span>
                </div>
              )}
            </div>

            {/* Launch button */}
            {onOpenTicket && (
              <div className="flex justify-end pt-1">
                <button
                  onClick={() => onOpenTicket(t.id)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 cursor-pointer"
                >
                  <span>Diagnose Ticket</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer controls */}
      <div className="border-t border-slate-100 dark:border-slate-800 pt-4 flex items-center justify-between">
        <span className="text-xs text-slate-400 font-bold font-mono uppercase tracking-wider">
          {urgentTickets.length} Flagged SLA Items
        </span>
        {onViewAllTickets && (
          <button
            onClick={onViewAllTickets}
            className="text-xs px-4 py-2 font-bold text-blue-600 dark:text-blue-400 hover:text-white border border-blue-200 dark:border-blue-900/60 hover:bg-blue-600 rounded-lg transition-all cursor-pointer inline-flex items-center gap-1.5 bg-white dark:bg-[#0F172A]"
          >
            <span>View All in Service Desk</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
