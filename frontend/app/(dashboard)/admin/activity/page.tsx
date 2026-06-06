'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Activity } from 'lucide-react';
import Link from 'next/link';
import { eventsApi } from '@/lib/api';
import { getCompanyNow, getCompanyTodayStart, getCompanyStartOfDay } from '@/lib/company-date';

// ── Timestamp helpers ─────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  const ts = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - ts.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;

  const today = getCompanyTodayStart();
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const tsDay = getCompanyStartOfDay(ts);

  const timeStr = ts.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

  if (tsDay.getTime() === today.getTime()) return `Today · ${timeStr}`;
  if (tsDay.getTime() === yesterday.getTime()) return `Yesterday · ${timeStr}`;

  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h}h ago`;

  return ts.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ` · ${timeStr}`;
}

function exactTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

// ── Event type badge ──────────────────────────────────────────────────────────

function getEventBadge(action: string): { label: string; color: string; dot: string } {
  if (['TICKET_CREATED','TICKET_ASSIGNED','TICKET_STARTED','TICKET_SUBMITTED_FOR_REVIEW',
       'TICKET_REVIEWED','TICKET_DONE','TICKET_CLOSED','TICKET_REOPENED','TICKET_CANCELLED',
       'TICKET_BLOCKED','TICKET_DELETED','TICKET_UPDATED','TICKET_OVERDUE',
       'COMMENT_ADDED','ATTACHMENT_UPLOADED'].includes(action)) {
    return { label: 'Ticket', color: 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400', dot: '#3b82f6' };
  }
  if (['LEAVE_REQUESTED','LEAVE_APPROVED','LEAVE_REJECTED','LEAVE_CANCELLED'].includes(action)) {
    return { label: 'Leave', color: 'bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400', dot: '#8b5cf6' };
  }
  if (['WORKDAY_STARTED','WORKDAY_ENDED','BREAK_STARTED','BREAK_ENDED',
       'IDLE_DETECTED','IDLE_CLASSIFIED'].includes(action)) {
    return { label: 'Workday', color: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400', dot: '#10b981' };
  }
  if (['PROJECT_CREATED','PROJECT_UPDATED','PROJECT_MEMBER_ADDED',
       'PROJECT_MEMBER_REMOVED','PROJECT_DELETED'].includes(action)) {
    return { label: 'Project', color: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400', dot: '#6366f1' };
  }
  if (['USER_LOGIN','USER_LOGOUT','USER_AUTO_LOGOUT','USER_CREATED',
       'USER_ROLE_CHANGED','PROFILE_UPDATED'].includes(action)) {
    return { label: 'User', color: 'bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400', dot: '#6b7280' };
  }
  if (action === 'SETTINGS_UPDATED') {
    return { label: 'Settings', color: 'bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400', dot: '#f97316' };
  }
  return { label: 'System', color: 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400', dot: '#94a3b8' };
}

// ── Empty state helper ────────────────────────────────────────────────────────

const EVENT_TYPE_LABELS: Record<string, string> = {
  USER_LOGIN: 'login', WORKDAY_STARTED: 'workday start', WORKDAY_ENDED: 'workday end',
  BREAK_STARTED: 'break', TICKET_CREATED: 'ticket creation', TICKET_ASSIGNED: 'ticket assignment',
  TICKET_STARTED: 'ticket progress', TICKET_SUBMITTED_FOR_REVIEW: 'review submission',
  TICKET_DONE: 'ticket completion', COMMENT_ADDED: 'comment', LEAVE_REQUESTED: 'leave request',
  LEAVE_APPROVED: 'leave approval', PROJECT_CREATED: 'project creation',
};

function getEmptyState(dateRange: string, eventType: string, scopeText: string) {
  const rangeLabel: Record<string, string> = {
    today: 'today',
    week: 'this week',
    last7: 'in the last 7 days',
    all: 'in your scope',
  };
  const rl = rangeLabel[dateRange] ?? dateRange;
  const tl = eventType ? (EVENT_TYPE_LABELS[eventType] ?? eventType.toLowerCase().replace(/_/g, ' ')) : null;

  if (tl) {
    return {
      title: `No ${tl} activity ${rl}`,
      hint: dateRange === 'today'
        ? 'Try switching to "This Week" or "Last 7 Days" to see older events.'
        : dateRange !== 'all'
        ? 'Try "All" to see your complete history, or clear the event filter.'
        : `No ${tl} events recorded under your ${scopeText}.`,
    };
  }
  if (dateRange === 'today') {
    return {
      title: 'No activity recorded today',
      hint: 'Start your workday, create a ticket, or take an action to see events here.',
    };
  }
  if (dateRange === 'week') {
    return {
      title: 'No activity this week',
      hint: 'Try "Last 7 Days" or "All" to see older events.',
    };
  }
  return {
    title: `No activity found ${rl}`,
    hint: 'Try expanding the date range or selecting "All" to see your complete history.',
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ActivityLogPage() {
  const user = useAuthStore(s => s.user);
  const router = useRouter();
  const role: string = (user?.role as any)?.name ?? '';
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'last7' | 'all'>('today');
  const [eventType, setEventType] = useState('');
  const token = typeof window !== 'undefined' ? localStorage.getItem('apex_token') : null;

  const buildParams = () => {
    const p: any = { limit: 100 };
    if (eventType) p.action = eventType;
    const now = getCompanyNow();
    if (dateRange === 'today') {
      const start = getCompanyTodayStart();
      p.from = start.toISOString();
    } else if (dateRange === 'week') {
      const start = getCompanyStartOfDay(new Date(now));
      const day = start.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      start.setDate(start.getDate() + diff);
      p.from = start.toISOString();
    } else if (dateRange === 'last7') {
      const start = new Date(now); start.setDate(start.getDate() - 7);
      p.from = start.toISOString();
    }
    // 'all' — no date filter
    return p;
  };

  const { data: events = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['activity-log', dateRange, eventType],
    queryFn: async () => {
      const res: any = await eventsApi.getAll(buildParams());
      return res;
    },
    staleTime: 30000,
  });

  // ── Scope metadata ────────────────────────────────────────────────────────
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(role);
  const isDeptLead = ['MANAGER', 'TEAM_LEAD'].includes(role);

  const scopeText = isAdmin ? 'Company Scope' : isDeptLead ? 'Department Scope' : 'Personal Scope';
  const scopeBadgeColor = isAdmin
    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/20 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-900'
    : isDeptLead
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-900'
    : 'bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-400 border border-blue-200/50 dark:border-blue-900';

  const subtitle = isAdmin
    ? 'Global operational activity — all company events'
    : isDeptLead
    ? 'Activity timeline for your department members'
    : 'Your personal activity timeline';

  // ── Active filter summary ─────────────────────────────────────────────────
  const rangeLabels: Record<string, string> = {
    today: 'Today', week: 'This Week', last7: 'Last 7 Days', all: 'All Time',
  };
  const filterSummary = [
    eventType ? (EVENT_TYPE_LABELS[eventType] ?? eventType.replace(/_/g, ' ')) : 'All events',
    rangeLabels[dateRange],
    scopeText,
  ].join(' · ');

  // ── Empty state ───────────────────────────────────────────────────────────
  const emptyState = getEmptyState(dateRange, eventType, scopeText);

  return (
    <div id="apex-main-content">

      {/* ── Header ── */}
      <div style={{ marginBottom: 20 }} className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Activity Log
            </h1>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${scopeBadgeColor}`}>
              {scopeText}
            </span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            {subtitle}
          </p>
        </div>
      </div>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['today', 'week', 'last7', 'all'] as const).map(r => (
          <button
            key={r}
            onClick={() => setDateRange(r)}
            style={{
              padding: '5px 12px', borderRadius: 8, fontSize: 12, border: '1px solid', cursor: 'pointer',
              background: dateRange === r ? 'var(--accent-subtle)' : 'var(--surface-card)',
              color: dateRange === r ? 'var(--accent-text)' : 'var(--text-secondary)',
              borderColor: dateRange === r ? 'var(--accent-border)' : 'var(--border-primary)',
              fontWeight: dateRange === r ? 600 : 400,
            }}
          >
            {{ today: 'Today', week: 'This Week', last7: 'Last 7 Days', all: 'All' }[r]}
          </button>
        ))}

        <select
          value={eventType}
          onChange={e => setEventType(e.target.value)}
          style={{
            padding: '5px 10px', borderRadius: 8, fontSize: 12,
            border: `1px solid ${eventType ? 'var(--accent-border)' : 'var(--border-primary)'}`,
            background: eventType ? 'var(--accent-subtle)' : 'var(--surface-card)',
            color: eventType ? 'var(--accent-text)' : 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          <option value="">All Event Types</option>
          <optgroup label="Workday">
            <option value="USER_LOGIN">Login</option>
            <option value="USER_LOGOUT">Logout</option>
            <option value="WORKDAY_STARTED">Work Start</option>
            <option value="WORKDAY_ENDED">Work End</option>
            <option value="BREAK_STARTED">Break Started</option>
            <option value="BREAK_ENDED">Break Ended</option>
          </optgroup>
          <optgroup label="Tickets">
            <option value="TICKET_CREATED">Ticket Created</option>
            <option value="TICKET_ASSIGNED">Ticket Assigned</option>
            <option value="TICKET_STARTED">Ticket Started</option>
            <option value="TICKET_SUBMITTED_FOR_REVIEW">Submitted for Review</option>
            <option value="TICKET_DONE">Ticket Completed</option>
            <option value="COMMENT_ADDED">Comment Added</option>
            <option value="ATTACHMENT_UPLOADED">Attachment Uploaded</option>
          </optgroup>
          <optgroup label="Leave">
            <option value="LEAVE_REQUESTED">Leave Requested</option>
            <option value="LEAVE_APPROVED">Leave Approved</option>
            <option value="LEAVE_REJECTED">Leave Rejected</option>
          </optgroup>
          <optgroup label="Projects">
            <option value="PROJECT_CREATED">Project Created</option>
            <option value="PROJECT_UPDATED">Project Updated</option>
          </optgroup>
        </select>

        {/* Clear event type filter */}
        {eventType && (
          <button
            onClick={() => setEventType('')}
            style={{
              padding: '5px 10px', borderRadius: 8, fontSize: 11, border: '1px solid var(--border-primary)',
              background: 'var(--surface-card)', color: 'var(--text-tertiary)', cursor: 'pointer',
            }}
          >
            Clear ×
          </button>
        )}
      </div>

      {/* ── Active filter summary ── */}
      <div style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: 0 }}>
          <Activity size={10} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
          {filterSummary}
          {!isLoading && (events as any[]).length > 0 && (
            <span style={{ marginLeft: 6, fontWeight: 600, color: 'var(--text-secondary)' }}>
              · {(events as any[]).length} event{(events as any[]).length !== 1 ? 's' : ''}
            </span>
          )}
        </p>
      </div>

      {/* ── Timeline ── */}
      <div className="apex-card" style={{ padding: 0, overflow: 'hidden' }}>

        {/* Loading skeleton */}
        {isLoading ? (
          <div>
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="animate-pulse" style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
                borderBottom: i < 5 ? '1px solid var(--border-subtle)' : 'none',
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--border-primary)', flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ height: 11, width: '55%', background: 'var(--border-primary)', borderRadius: 4 }} />
                  <div style={{ height: 9, width: '30%', background: 'var(--border-subtle)', borderRadius: 4 }} />
                </div>
                <div style={{ height: 10, width: 60, background: 'var(--border-subtle)', borderRadius: 4, flexShrink: 0 }} />
              </div>
            ))}
          </div>

        ) : isError ? (
          /* Error state */
          <div style={{ padding: '36px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3, color: 'var(--color-danger)' }}>
              <Activity size={28} style={{ display: 'inline' }} />
            </div>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 6px' }}>
              Unable to load activity.
            </p>
            <button 
              onClick={() => refetch()}
              className="mt-2 text-xs font-semibold text-blue-600 hover:underline bg-transparent border-none cursor-pointer"
            >
              Please retry
            </button>
          </div>

        ) : (events as any[]).length === 0 ? (
          /* Empty state */
          <div style={{ padding: '36px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3 }}>
              <Activity size={28} style={{ display: 'inline' }} />
            </div>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', margin: '0 0 6px' }}>
              {emptyState.title}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0, maxWidth: 360, marginLeft: 'auto', marginRight: 'auto' }}>
              {emptyState.hint}
            </p>
          </div>

        ) : (
          /* Event rows */
          (events as any[]).map((ev: any, i: number) => {
            const badge = getEventBadge(ev.action);
            const isClickable = !!ev.entityUrl;
            const desc = ev.description ?? ev.action?.toLowerCase().replace(/_/g, ' ') ?? '';
            const tsFormatted = formatTimestamp(ev.timestamp);
            const tsExact = exactTimestamp(ev.timestamp);

            return (
              <div
                key={i}
                onClick={() => isClickable && router.push(ev.entityUrl)}
                title={tsExact}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
                  borderBottom: i < (events as any[]).length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  cursor: isClickable ? 'pointer' : 'default',
                }}
                className={isClickable ? 'hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors group/row' : ''}
              >
                {/* Status dot */}
                <span style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: badge.dot, flexShrink: 0,
                }} />

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                      {ev.actor?.name ?? 'System'}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}>
                      {desc}
                    </span>
                    {ev.entityType === 'Ticket' && ev.metadata?.ticketId && (
                      <span className="text-blue-600 dark:text-blue-400 font-mono font-bold text-[10px] shrink-0">
                        [{ev.metadata.ticketId}]
                      </span>
                    )}
                  </div>
                </div>

                {/* Badge + timestamp + click arrow */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${badge.color}`}>
                    {badge.label}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                    {tsFormatted}
                  </span>
                  {isClickable && (
                    <ArrowUpRight
                      size={12}
                      className="text-slate-300 group-hover/row:text-blue-500 transition-colors"
                    />
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── View full log link ── */}
      {!isLoading && (events as any[]).length >= 100 && (
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            Showing first 100 events. Narrow your date range or event type to see more.
          </p>
        </div>
      )}
    </div>
  );
}
