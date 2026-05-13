'use client';

import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { projectsApi } from '@/lib/api';
import { cn, PROJECT_STATUS_COLORS, PRIORITY_COLORS, STATUS_COLORS, PROJECT_STATUS_LABELS, PRIORITY_LABELS, formatDate, getInitials } from '@/lib/utils';
import { ArrowLeft, Ticket, Users, Calendar } from 'lucide-react';
import Link from 'next/link';
import { TicketRow } from '@/components/tickets/ticket-row';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.getOne(id) as Promise<any>,
  });

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  if (!project) return <div className="text-center py-12 text-slate-500">Project not found</div>;

  const doneTickets = project.tickets?.filter((t: any) => t.status === 'DONE' || t.status === 'CLOSED').length || 0;
  const progress = project.tickets?.length ? Math.round((doneTickets / project.tickets.length) * 100) : 0;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-start gap-3">
        <Link href="/projects" className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
          <ArrowLeft size={18} className="text-slate-500" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-slate-400 font-mono text-sm">{project.projectId}</span>
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', PROJECT_STATUS_COLORS[project.status])}>{PROJECT_STATUS_LABELS[project.status] ?? project.status}</span>
            <span className={cn('text-xs px-2 py-0.5 rounded font-medium', PRIORITY_COLORS[project.priority])}>{PRIORITY_LABELS[project.priority] ?? project.priority}</span>
          </div>
          <h2 className="text-xl font-bold text-slate-800">{project.name}</h2>
          {project.description && <p className="text-sm text-slate-500 mt-1">{project.description}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          {/* Progress */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-slate-700 text-sm">Progress</h3>
              <span className="text-sm font-bold text-slate-800">{progress}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2.5">
              <div className="bg-blue-600 h-2.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-slate-400 mt-2">{doneTickets} of {project.tickets?.length || 0} tickets resolved</p>
          </div>

          {/* Tickets */}
          <div className="bg-white rounded-xl border border-slate-200">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-700 text-sm flex items-center gap-2">
                <Ticket size={15} /> Tickets ({project.tickets?.length || 0})
              </h3>
              <Link href={`/tickets/new?projectId=${project.id}`} className="text-xs text-blue-600 hover:underline">Add ticket</Link>
            </div>
            <div>
              {project.tickets?.length > 0 ? (
                project.tickets.map((t: any) => <TicketRow key={t.id} ticket={t} />)
              ) : (
                <div className="p-8 text-center text-slate-400 text-sm">No tickets in this project</div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Team */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-700 text-sm mb-3 flex items-center gap-2">
              <Users size={14} /> Team ({project.members?.length || 0})
            </h3>
            <div className="space-y-2.5">
              {project.members?.map((m: any) => (
                <div key={m.id} className="flex items-center gap-2.5">
                  <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-xs font-semibold">{getInitials(m.user?.name || '')}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{m.user?.name}</p>
                    <p className="text-xs text-slate-400">{m.user?.role?.name} · {m.role}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Details */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <h3 className="font-semibold text-slate-700 text-sm">Details</h3>
            {project.department && (
              <div>
                <p className="text-xs text-slate-400">Department</p>
                <p className="text-sm font-medium text-slate-700 mt-0.5">{project.department.name}</p>
              </div>
            )}
            {project.startDate && (
              <div>
                <p className="text-xs text-slate-400">Start Date</p>
                <p className="text-sm font-medium text-slate-700 mt-0.5">{formatDate(project.startDate)}</p>
              </div>
            )}
            {project.endDate && (
              <div>
                <p className="text-xs text-slate-400">End Date</p>
                <p className={cn('text-sm font-medium mt-0.5', new Date(project.endDate) < new Date() ? 'text-red-600' : 'text-slate-700')}>
                  {formatDate(project.endDate)}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
