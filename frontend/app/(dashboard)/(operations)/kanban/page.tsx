'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { ticketsApi, departmentsApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { cn, PRIORITY_COLORS, CATEGORY_COLORS, PRIORITY_LABELS, CATEGORY_LABELS, getInitials, formatDate, DEPT_COLORS } from '@/lib/utils';
import { getTicketVisibility, PRIORITY_DOT } from '@/lib/ticket-visibility';
import { TimingTicker } from '@/components/tickets/OverdueTicker';
import { SkeletonKanbanColumn } from '@/components/ui/skeleton';
import { Plus, Clock, AlertTriangle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';

const COLUMNS = [
  { key: 'OPEN',        label: 'Open',        color: 'bg-yellow-50 border-yellow-200', headerColor: 'text-yellow-700 bg-yellow-100' },
  { key: 'IN_PROGRESS', label: 'In Progress',  color: 'bg-blue-50 border-blue-200',    headerColor: 'text-blue-700 bg-blue-100'   },
  { key: 'REVIEW',      label: 'Review',       color: 'bg-purple-50 border-purple-200', headerColor: 'text-purple-700 bg-purple-100' },
  { key: 'DONE',        label: 'Done',         color: 'bg-green-50 border-green-200',  headerColor: 'text-green-700 bg-green-100' },
];

// ─── Static card UI (also used for DragOverlay) ───────────────────────────────
function CardContent({ ticket, isPending }: { ticket: any; isPending?: boolean }) {
  const deptColor = ticket.department?.color || DEPT_COLORS[ticket.department?.name] || '#e2e8f0';
  const vis = getTicketVisibility({
    status: ticket.status,
    isOverdue: ticket.isOverdue,
    overdueSeverity: ticket.overdueSeverity,
  });
  return (
    <div
      className={cn('relative rounded-xl p-3', vis.borderClass, vis.bgClass, isPending && 'opacity-70')}
      style={{ backgroundColor: 'var(--surface-card)', border: '1px solid var(--border-primary)', boxShadow: 'var(--shadow-sm)' }}
    >
      {/* Priority dot — absolute top-right */}
      <span className={cn('absolute top-2 right-2 w-2.5 h-2.5 rounded-full', PRIORITY_DOT[ticket.priority] ?? 'bg-gray-400')} />

      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs text-slate-400 dark:text-gray-500 font-mono">{ticket.ticketId}</span>
        <div className="flex items-center gap-1.5 pr-4">
          {isPending && <Loader2 size={12} className="animate-spin text-indigo-500" />}
          {ticket.priority === 'URGENT' && <AlertTriangle size={13} className="text-red-500 flex-shrink-0" />}
        </div>
      </div>

      <Link href={`/tickets/${ticket.id}`} onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-medium text-slate-800 dark:text-gray-200 leading-snug hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors line-clamp-2 mb-1">
          {ticket.title}
        </p>
      </Link>

      <TimingTicker ticket={ticket} className="mt-1 mb-1.5" />

      {ticket.scheduledStartAt && (
        <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-0.5 mb-1.5">
          🕑 {new Date(ticket.scheduledStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {ticket.scheduledEndAt && ` → ${new Date(ticket.scheduledEndAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
        </p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', CATEGORY_COLORS[ticket.category])}>
          {CATEGORY_LABELS[ticket.category] ?? ticket.category}
        </span>
        <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', PRIORITY_COLORS[ticket.priority])}>
          {PRIORITY_LABELS[ticket.priority] ?? ticket.priority}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {(ticket.estimatedMinutes || ticket.estimatedTime) && (
            <span className="text-xs text-slate-400 dark:text-gray-500 flex items-center gap-1">
              <Clock size={11} />
              {ticket.estimatedMinutes ? `${ticket.estimatedMinutes}m` : `${ticket.estimatedTime}h`}
            </span>
          )}
          {ticket.dueDate && (
            <span className={cn('text-xs', new Date(ticket.dueDate) < new Date() ? 'text-red-500' : 'text-slate-400 dark:text-gray-500')}>
              {formatDate(ticket.dueDate)}
            </span>
          )}
        </div>
        {ticket.assignedTo ? (
          <div className="w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center" title={ticket.assignedTo.name}>
            <span className="text-white text-[10px] font-bold">{getInitials(ticket.assignedTo.name)}</span>
          </div>
        ) : (
          <div className="w-6 h-6 bg-slate-200 dark:bg-gray-700 rounded-full" title="Unassigned" />
        )}
      </div>

      {/* SLA bar */}
      {typeof ticket.slaPercent === 'number' && !['DONE', 'CLOSED'].includes(ticket.status) && (
        <div className="mt-2 w-full h-1 bg-slate-100 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full',
              ticket.isOverdue || ticket.slaPercent >= 100 ? 'bg-red-500' : ticket.slaPercent >= 80 ? 'bg-orange-400' : 'bg-emerald-400',
            )}
            style={{ width: `${Math.min(ticket.slaPercent, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Draggable card wrapper ───────────────────────────────────────────────────
function DraggableCard({ ticket, columnKey, isPending, canMove }: { ticket: any; columnKey: string; isPending: boolean; canMove: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: ticket.id,
    data: { columnKey, ticket },
    disabled: isPending || !canMove,
  });

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn('touch-none', isDragging && 'opacity-30 cursor-grabbing')}
    >
      <CardContent ticket={ticket} isPending={isPending} />
    </div>
  );
}

// ─── Droppable column ─────────────────────────────────────────────────────────
function DroppableColumn({
  col,
  tickets,
  pendingIds,
  onMovePrev,
  onMoveNext,
  getPrevStatus,
  getNextStatus,
  canMoveCard,
}: {
  col: typeof COLUMNS[0];
  tickets: any[];
  pendingIds: Set<string>;
  onMovePrev: (id: string) => void;
  onMoveNext: (id: string) => void;
  getPrevStatus: (key: string) => string | null;
  getNextStatus: (key: string) => string | null;
  canMoveCard: (ticket: any) => boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-xl border p-3 min-h-[400px] transition-all',
        col.color,
        isOver && 'ring-2 ring-indigo-400 ring-offset-1',
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full', col.headerColor)}>
          {col.label}
        </span>
        <span
          className="text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center"
          style={{ backgroundColor: 'var(--surface-card)', color: 'var(--text-secondary)', boxShadow: 'var(--shadow-sm)' }}
        >
          {tickets.length}
        </span>
      </div>

      <div className="space-y-2.5">
        {tickets.map((ticket) => (
          <div key={ticket.id} className="group relative">
            <DraggableCard
              ticket={ticket}
              columnKey={col.key}
              isPending={pendingIds.has(ticket.id)}
              canMove={canMoveCard(ticket)}
            />
            {/* Fallback move buttons for non-drag interactions */}
            {!pendingIds.has(ticket.id) && canMoveCard(ticket) && (
              <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {getPrevStatus(col.key) && (
                  <button
                    onClick={() => onMovePrev(ticket.id)}
                    className="flex-1 text-xs py-1 bg-slate-100 hover:bg-slate-200 rounded text-slate-600 transition-colors"
                  >
                    ← Back
                  </button>
                )}
                {getNextStatus(col.key) && (
                  <button
                    onClick={() => onMoveNext(ticket.id)}
                    className="flex-1 text-xs py-1 bg-indigo-100 hover:bg-indigo-200 rounded text-indigo-700 transition-colors"
                  >
                    Move →
                  </button>
                )}
              </div>
            )}
          </div>
        ))}

        {tickets.length === 0 && (
          <div
            className="flex flex-col items-center justify-center h-32 rounded-lg border-2 border-dashed transition-colors p-4 text-center"
            style={{
              borderColor: isOver ? 'var(--accent-border)' : 'var(--border-primary)',
              backgroundColor: isOver ? 'var(--accent-subtle)' : 'transparent',
            }}
          >
            <span className="text-2xl mb-1" style={{ color: 'var(--text-tertiary)' }}>+</span>
            <p className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>No tickets here</p>
            <Link href="/tickets/new" className="text-xs hover:underline mt-0.5" style={{ color: 'var(--accent)' }} onClick={(e) => e.stopPropagation()}>
              Create a new ticket
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type KanbanData = Record<string, any[]>;

export default function KanbanPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [departmentId, setDepartmentId] = useState('');
  const [localKanban, setLocalKanban] = useState<KanbanData>({});
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [activeTicket, setActiveTicket] = useState<any>(null);

  const canMoveCard = (ticket: any) => {
    if (!user) return false;
    const roleName = (user.role as any)?.name ?? user.role ?? '';
    const isOwner = ticket.createdById === user.id;
    const isAssignee = ticket.assignedToId === user.id ||
      ticket.assignees?.some((a: any) => a.userId === user.id);
    const isManagerPlus = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);
    const isTeamLead = roleName === 'TEAM_LEAD';
    return isOwner || isAssignee || isManagerPlus || isTeamLead;
  };

  const { data: kanban, isLoading } = useQuery({
    queryKey: ['kanban', departmentId],
    queryFn: () => ticketsApi.getKanban(departmentId ? { departmentId } : {}) as Promise<KanbanData>,
    refetchInterval: 30000,
  });

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll() as Promise<any[]>,
  });

  // Keep local state in sync with server data (but not while dragging)
  useEffect(() => {
    if (kanban) setLocalKanban(kanban);
  }, [kanban]);

  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      ticketsApi.updateStatus(id, status),
    onError: (_err, variables) => {
      toast.error('Failed to move ticket — reverting');
      // Revert to server data
      if (kanban) setLocalKanban(kanban);
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(variables.id);
        return next;
      });
    },
    onSuccess: (_data, variables) => {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(variables.id);
        return next;
      });
      qc.invalidateQueries({ queryKey: ['kanban'] });
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['dashboard-overview'] });
      qc.invalidateQueries({ queryKey: ['ticket-stats'] });
      qc.invalidateQueries({ queryKey: ['activity-feed'] });
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const getNextStatus = (current: string) => {
    const idx = COLUMNS.findIndex((c) => c.key === current);
    return idx < COLUMNS.length - 1 ? COLUMNS[idx + 1].key : null;
  };

  const getPrevStatus = (current: string) => {
    const idx = COLUMNS.findIndex((c) => c.key === current);
    return idx > 0 ? COLUMNS[idx - 1].key : null;
  };

  const moveTicket = (ticketId: string, fromColumn: string, toColumn: string) => {
    if (fromColumn === toColumn) return;

    // Optimistic update
    setLocalKanban((prev) => {
      const ticket = prev[fromColumn]?.find((t) => t.id === ticketId);
      if (!ticket) return prev;
      return {
        ...prev,
        [fromColumn]: prev[fromColumn].filter((t) => t.id !== ticketId),
        [toColumn]: [{ ...ticket, status: toColumn }, ...(prev[toColumn] ?? [])],
      };
    });

    setPendingIds((prev) => new Set(prev).add(ticketId));
    moveMutation.mutate({ id: ticketId, status: toColumn });
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTicket(event.active.data.current?.ticket ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveTicket(null);
    const { active, over } = event;
    if (!over) return;
    const fromColumn = active.data.current?.columnKey as string;
    const toColumn = over.id as string;
    const ticket = active.data.current?.ticket;
    if (ticket && !canMoveCard(ticket)) {
      toast.error('You do not have permission to move this ticket');
      return;
    }
    moveTicket(active.id as string, fromColumn, toColumn);
  };

  return (
    <div className="space-y-5 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Kanban Board</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>Drag cards between columns to update status</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="apex-select"
          >
            <option value="">All Departments</option>
            {Array.isArray(departments) && departments.map((d: any) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <Link href="/tickets/new" className="apex-btn-new-ticket">
            <Plus size={16} /> New Ticket
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {COLUMNS.map((col) => <SkeletonKanbanColumn key={col.key} cards={3} />)}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="grid grid-cols-4 gap-4">
            {COLUMNS.map((col) => (
              <DroppableColumn
                key={col.key}
                col={col}
                tickets={localKanban[col.key] ?? []}
                pendingIds={pendingIds}
                getPrevStatus={getPrevStatus}
                getNextStatus={getNextStatus}
                canMoveCard={canMoveCard}
                onMovePrev={(id) => {
                  const prev = getPrevStatus(col.key);
                  if (prev) moveTicket(id, col.key, prev);
                }}
                onMoveNext={(id) => {
                  const next = getNextStatus(col.key);
                  if (next) moveTicket(id, col.key, next);
                }}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
            {activeTicket && (
              <div className="rotate-2 scale-105 shadow-xl">
                <CardContent ticket={activeTicket} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
