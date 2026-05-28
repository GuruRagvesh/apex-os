'use client';

import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { ticketsApi, leaveApi } from '@/lib/api';

function CalendarView({ events, router }: { events: any[]; router: any }) {
  const [FC, setFC] = useState<any>(null);
  const [plugins, setPlugins] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      import('@fullcalendar/react'),
      import('@fullcalendar/daygrid'),
      import('@fullcalendar/timegrid'),
      import('@fullcalendar/list'),
      import('@fullcalendar/interaction'),
    ]).then(([fcMod, daygrid, timegrid, list, interaction]) => {
      setFC(() => fcMod.default);
      setPlugins([daygrid.default, timegrid.default, list.default, interaction.default]);
    });
  }, []);

  if (!FC || plugins.length === 0) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Loading calendar…</div>;
  }

  return (
    <FC
      plugins={plugins}
      initialView="dayGridMonth"
      headerToolbar={{
        left: 'prev,next today',
        center: 'title',
        right: 'dayGridMonth,timeGridWeek,listWeek',
      }}
      events={events}
      eventClick={(info: any) => {
        info.jsEvent.preventDefault();
        if (info.event.url) router.push(info.event.url);
      }}
      height="auto"
      eventDisplay="block"
    />
  );
}

export default function CalendarPage() {
  const router = useRouter();
  const user = useAuthStore(s => s.user);
  const token = typeof window !== 'undefined' ? localStorage.getItem('apex_token') : null;

  const { data: ticketsData } = useQuery({
    queryKey: ['calendar-tickets'],
    queryFn: async () => {
      try {
        return await ticketsApi.getAll({ limit: 200 });
      } catch (err) {
        return null;
      }
    },
  });

  const { data: leaveData, isError: leaveError } = useQuery({
    queryKey: ['calendar-leave'],
    queryFn: async () => {
      const data: any = await leaveApi.getAll({ status: 'APPROVED', limit: 100 });
      if (!data) throw new Error('Approved leave events could not be loaded');
      return data;
    },
  });

  const events = useMemo(() => {
    const result: any[] = [];
    const tickets: any[] = ticketsData?.tickets ?? (Array.isArray(ticketsData) ? ticketsData : []);
    const approvedLeaves: any[] = leaveData?.items ?? [];

    const STATUS_COLORS: Record<string, string> = {
      OPEN: '#94a3b8', IN_PROGRESS: '#f59e0b', REVIEW: '#8b5cf6', DONE: '#10b981', CLOSED: '#6b7280',
    };

    tickets.forEach((t: any) => {
      if (t.scheduledStartAt) {
        result.push({
          id: 'sched-' + t.id,
          title: `${t.ticketId} · ${t.title}`,
          start: t.scheduledStartAt,
          end: t.scheduledEndAt ?? undefined,
          backgroundColor: STATUS_COLORS[t.status] ?? '#6366f1',
          borderColor: 'transparent',
          url: `/tickets/${t.id}`,
        });
      }
      if (t.dueDate && !['DONE','CLOSED'].includes(t.status)) {
        result.push({
          id: 'due-' + t.id,
          title: `Due: ${t.ticketId}`,
          start: t.dueDate,
          allDay: true,
          backgroundColor: t.isOverdue ? '#ef4444' : '#f59e0b',
          borderColor: 'transparent',
          url: `/tickets/${t.id}`,
        });
      }
    });

    approvedLeaves.forEach((l: any) => {
      result.push({
        id: 'leave-' + l.id,
        title: `${l.user?.name ?? 'Leave'} · ${l.type}`,
        start: l.startDate,
        end: l.endDate,
        allDay: true,
        backgroundColor: l.userId === user?.id ? '#10b981' : '#6366f1',
        borderColor: 'transparent',
        url: '/leave',
      });
    });

    return result;
  }, [ticketsData, leaveData, user?.id]);

  return (
    <div id="apex-main-content">
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Calendar</h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>Your scheduled tickets, due dates, and leave in one view</p>
      </div>

      <div className="apex-card" style={{ padding: 16, overflow: 'hidden' }}>
        {leaveError && (
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--color-warning)' }}>
            Approved leave events could not be loaded. Ticket events are still shown.
          </p>
        )}
        <CalendarView events={events} router={router} />
      </div>
    </div>
  );
}
