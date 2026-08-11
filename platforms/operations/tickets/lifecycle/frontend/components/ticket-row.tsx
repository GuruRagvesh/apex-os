'use client';

import Link from 'next/link';
import { PRIORITY_COLORS, PRIORITY_LABELS } from '@apex/shared-configuration';
import { STATUS_COLORS, STATUS_LABELS, DEPT_COLORS, formatRelativeTime } from '@/lib/utils';
import { cn, formatDate, getInitials } from '@apex/shared-utilities';
import { getTicketVisibility, PRIORITY_DOT } from '../../shared/ticket-visibility';
import { TimingTicker } from '@apex/operations-tickets-sla/components/OverdueTicker';
import { Clock, Copy, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

// Request Type (Task / Query / Help) replaces the old internal Category in the UI.
const REQUEST_TYPE_LABELS: Record<string, string> = { TASK: 'Task', QUERY: 'Query', HELP: 'Help' };

interface TicketRowProps {
  ticket: any;
  compact?: boolean;
  onStatusChange?: (id: string, status: string) => void;
  href?: string;
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

export function TicketRow({ ticket, compact, onStatusChange, href }: TicketRowProps) {
  const isDone = ticket.status === 'DONE' || ticket.status === 'CLOSED';
  const deptColor = ticket.department?.color || DEPT_COLORS[ticket.department?.name] || '#e2e8f0';
  const ticketHref = href ?? `/tickets/${ticket.id}`;

  if (compact) {
    return (
      <Link href={ticketHref} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <CopyId ticketId={ticket.ticketId} className="text-xs text-slate-400" />
            <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {REQUEST_TYPE_LABELS[ticket.type] ?? 'Task'}
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

  const vis = getTicketVisibility({
    status: ticket.status,
    isOverdue: ticket.isOverdue,
    overdueSeverity: ticket.overdueSeverity,
  });

  return (
    <Link
      href={ticketHref}
      className={cn(
        'grid grid-cols-12 items-center gap-4 px-4 py-3.5 transition-all border-b last:border-0',
        'hover:bg-slate-50 dark:hover:bg-slate-800/40',
        vis.borderClass, vis.bgClass,
      )}
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      {/* Ticket col-span-5 */}
      <div className="col-span-5 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <CopyId ticketId={ticket.ticketId} className="text-xs text-slate-400 font-medium" />
          {ticket.project && (
            <span className="text-xs text-slate-400 font-medium">· Project: {ticket.project.projectId}</span>
          )}
          {ticket.isOverdue && (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
              <AlertTriangle size={9} />
              OVERDUE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('inline-block w-2 h-2 rounded-full flex-shrink-0', PRIORITY_DOT[ticket.priority] ?? 'bg-gray-400')} />
          <p className="text-sm font-semibold text-slate-800 dark:text-gray-200 truncate">{ticket.title}</p>
        </div>
        
        {/* Richer Operational Subtitle */}
        <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-gray-500 mt-1 flex-wrap font-medium">
          {ticket.createdBy && (
            <span>By {ticket.createdBy.name}</span>
          )}
          {ticket.department && (
            <>
              <span>·</span>
              <span>{ticket.department.name}</span>
            </>
          )}
          {ticket.updatedAt && (
            <>
              <span>·</span>
              <span>Updated {formatRelativeTime(ticket.updatedAt)}</span>
            </>
          )}
        </div>

        {/* Latest Comment Preview */}
        {ticket.comments?.[0] && (
          <p className="text-xs text-slate-500 dark:text-gray-400 italic mt-1.5 truncate border-l-2 border-slate-200 dark:border-slate-700 pl-2">
            💬 <span className="font-semibold not-italic text-slate-600 dark:text-gray-300">{ticket.comments[0].author?.name}:</span> "{ticket.comments[0].content}"
          </p>
        )}

        {ticket.scheduledStartAt && ticket.scheduledEndAt && (
          <p className="text-xs text-slate-400 dark:text-gray-500 mt-1 font-medium">
            📅 {new Date(ticket.scheduledStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} → {new Date(ticket.scheduledEndAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
        {!isDone && typeof ticket.slaPercent === 'number' && (
          <div className="mt-2">
            <SlaBar slaPercent={ticket.slaPercent} isOverdue={ticket.isOverdue} />
          </div>
        )}
      </div>

      {/* Type col-span-2 — Request Type + Task Type (replaces old Category) */}
      <div className="col-span-2 space-y-1">
        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 inline-block">
          {REQUEST_TYPE_LABELS[ticket.type] ?? 'Task'}
        </span>
        {ticket.taskType?.name && (
          <div className="text-xs text-slate-500 dark:text-gray-400 truncate" title={ticket.taskType.name}>
            {ticket.taskType.name}
          </div>
        )}
      </div>

      {/* Priority col-span-1 */}
      <div className="col-span-1">
        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', PRIORITY_COLORS[ticket.priority])}>
          {PRIORITY_LABELS[ticket.priority] ?? ticket.priority}
        </span>
      </div>

      {/* Status col-span-2 */}
      <div className="col-span-2 space-y-1">
        <span className={cn('text-xs px-2 py-1 rounded-lg font-medium inline-block', vis.badgeClass)}>
          {vis.badgeText}
        </span>
        {ticket.status === 'REVIEW' && (
          <div className="text-[10px] font-bold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded w-fit">
            Waiting for Review
          </div>
        )}
        <TimingTicker ticket={ticket} />
      </div>

      {/* Assignee col-span-2 */}
      <div className="col-span-2 flex items-center gap-2 min-w-0">
        {ticket.assignedTo ? (
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0" title={ticket.assignedTo.name}>
              <span className="text-white text-xs font-semibold">{getInitials(ticket.assignedTo.name)}</span>
            </div>
            <span className="text-xs font-semibold text-slate-700 dark:text-gray-300 truncate" title={ticket.assignedTo.name}>
              {ticket.assignedTo.name}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 bg-slate-200 dark:bg-gray-700 rounded-full flex items-center justify-center flex-shrink-0" title="Unassigned">
              <span className="text-slate-400 text-xs font-semibold">?</span>
            </div>
            <span className="text-xs text-slate-400 font-medium">Unassigned</span>
          </div>
        )}
        {(ticket.estimatedMinutes || ticket.estimatedTime) && (
          <div className="flex items-center gap-1 text-xs text-slate-400 hidden xl:flex flex-shrink-0 ml-1">
            <Clock size={11} />
            {ticket.estimatedMinutes ? `${ticket.estimatedMinutes}m` : `${ticket.estimatedTime}h`}
          </div>
        )}
      </div>
    </Link>
  );
}
