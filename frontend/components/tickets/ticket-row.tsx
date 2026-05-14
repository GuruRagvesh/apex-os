'use client';

import Link from 'next/link';
import { cn, PRIORITY_COLORS, STATUS_COLORS, CATEGORY_COLORS, STATUS_LABELS, PRIORITY_LABELS, CATEGORY_LABELS, formatDate, getInitials, DEPT_COLORS } from '@/lib/utils';
import { Clock, Copy, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

interface TicketRowProps {
  ticket: any;
  compact?: boolean;
  onStatusChange?: (id: string, status: string) => void;
}

function CopyId({ ticketId, className }: { ticketId: string; className?: string }) {
  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(ticketId).then(() => {
      toast.success(`Copied ${ticketId}`, { duration: 2000 });
    });
  };

  return (
    <button
      onClick={handleCopy}
      className={cn('group flex items-center gap-0.5 font-mono hover:text-slate-600 transition-colors', className)}
      title="Copy ticket ID"
    >
      {ticketId}
      <Copy size={10} className="opacity-0 group-hover:opacity-60 transition-opacity ml-0.5" />
    </button>
  );
}

function SlaBar({ slaPercent, isOverdue }: { slaPercent: number; isOverdue: boolean }) {
  const pct = Math.min(slaPercent, 100);
  const color = isOverdue || pct >= 100
    ? 'bg-red-500'
    : pct >= 80
    ? 'bg-orange-400'
    : 'bg-emerald-400';

  return (
    <div className="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden" title={`SLA: ${pct}%`}>
      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function TicketRow({ ticket, compact, onStatusChange }: TicketRowProps) {
  const isDone = ticket.status === 'DONE' || ticket.status === 'CLOSED';
  const deptColor = ticket.department?.color || DEPT_COLORS[ticket.department?.name] || '#e2e8f0';

  if (compact) {
    return (
      <Link href={`/tickets/${ticket.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <CopyId ticketId={ticket.ticketId} className="text-xs text-slate-400" />
            <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', CATEGORY_COLORS[ticket.category])}>
              {CATEGORY_LABELS[ticket.category] ?? ticket.category}
            </span>
            {ticket.isOverdue && (
              <span className="flex items-center gap-0.5 text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                <AlertTriangle size={9} />
                OVERDUE
              </span>
            )}
          </div>
          <p className="text-sm font-medium text-slate-700 truncate">{ticket.title}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', PRIORITY_COLORS[ticket.priority])}>
            {PRIORITY_LABELS[ticket.priority] ?? ticket.priority}
          </span>
          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_COLORS[ticket.status])}>
            {STATUS_LABELS[ticket.status] ?? ticket.status}
          </span>
        </div>
      </Link>
    );
  }

  return (
    <Link
      href={`/tickets/${ticket.id}`}
      className="grid grid-cols-12 items-center gap-4 px-4 py-3.5 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
      style={{ borderLeft: `3px solid ${deptColor}` }}
    >
      {/* Ticket col-span-6 */}
      <div className="col-span-6 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <CopyId ticketId={ticket.ticketId} className="text-xs text-slate-400 font-medium" />
          {ticket.project && (
            <span className="text-xs text-slate-400">{ticket.project.projectId}</span>
          )}
          {ticket.isOverdue && (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
              <AlertTriangle size={9} />
              OVERDUE
            </span>
          )}
        </div>
        <p className="text-sm font-semibold text-slate-800 truncate">{ticket.title}</p>
        {ticket.department && (
          <p className="text-xs text-slate-400 mt-0.5">{ticket.department.name}</p>
        )}
        {!isDone && typeof ticket.slaPercent === 'number' && (
          <div className="mt-1.5">
            <SlaBar slaPercent={ticket.slaPercent} isOverdue={ticket.isOverdue} />
          </div>
        )}
      </div>

      {/* Category col-span-2 */}
      <div className="col-span-2">
        <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', CATEGORY_COLORS[ticket.category])}>
          {CATEGORY_LABELS[ticket.category] ?? ticket.category}
        </span>
      </div>

      {/* Priority col-span-1 */}
      <div className="col-span-1">
        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', PRIORITY_COLORS[ticket.priority])}>
          {PRIORITY_LABELS[ticket.priority] ?? ticket.priority}
        </span>
      </div>

      {/* Status col-span-2 */}
      <div className="col-span-2">
        <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium', STATUS_COLORS[ticket.status])}>
          {STATUS_LABELS[ticket.status] ?? ticket.status}
        </span>
      </div>

      {/* Assignee col-span-1 */}
      <div className="col-span-1 flex items-center gap-2">
        {ticket.assignedTo ? (
          <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center" title={ticket.assignedTo.name}>
            <span className="text-white text-xs font-semibold">{getInitials(ticket.assignedTo.name)}</span>
          </div>
        ) : (
          <div className="w-7 h-7 bg-slate-200 rounded-full flex items-center justify-center" title="Unassigned">
            <span className="text-slate-400 text-xs">?</span>
          </div>
        )}
        {ticket.estimatedTime && (
          <div className="flex items-center gap-1 text-xs text-slate-400 hidden xl:flex">
            <Clock size={11} />
            {ticket.estimatedTime}h
          </div>
        )}
      </div>
    </Link>
  );
}
