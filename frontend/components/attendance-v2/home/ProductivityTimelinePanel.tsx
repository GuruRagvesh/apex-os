'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@apex/core-identity';
import { workdayApi } from '@/lib/api';
import {
  AlarmClock, CalendarDays, ChevronDown, Clock3, Coffee, ExternalLink,
  Layers3, Search, TicketCheck, TimerReset, Users, X,
} from 'lucide-react';
import s from './productivity-timeline.module.css';

type SegmentType = 'TICKET' | 'REWORK' | 'OPEN' | 'REVIEW_WAIT' | 'COMPLETED' | 'OVERDUE_EXECUTION' | 'OVERDUE_REVIEW' | 'BREAK' | 'MEETING' | 'UNDEFINED';
type TimelinePerson = {
  id: string; name: string; photoUrl?: string | null; avatar?: string | null;
  role: { name: string }; department?: { id: string; name: string } | null;
};
type TimelineSegment = {
  id: string; type: SegmentType; label: string; startAt: string; endAt: string;
  startMinute: number; endMinute: number; durationSeconds: number;
  continuesBefore: boolean; continuesAfter: boolean;
  ticketDbId?: string; ticketId?: string; ticketTitle?: string; ticketStatus?: string; ticketStage?: string;
  projectName?: string | null; taskTypeName?: string | null; benchmarkMinutes?: number | null;
  blockedReason?: string | null;
  overdueReason?: 'EXECUTION_DELAY' | 'REVIEW_DELAY'; breakType?: string; meetingTopic?: string | null;
};
type TimelineDay = {
  date: string; dayNumber: number; weekday: string; attendanceStatus: string | null; evaluationState: string | null;
  segments: TimelineSegment[];
  kpis: { productiveSeconds: number; meetingSeconds: number; breakSeconds: number; undefinedSeconds: number; sessionCount: number; ticketsTouched: number; ticketsCompleted: number };
};
type TimelineData = {
  identity: { id: string; name: string; role: string; department: { id: string; name: string } | null };
  month: string; timezone: string; rangePages: { from: number; to: number }[]; days: TimelineDay[];
  ledger: { productiveSeconds: number; meetingSeconds: number; breakSeconds: number; undefinedSeconds: number; sessionCount: number; ticketsTouched: number; ticketsCompleted: number; executionOverdueTickets: number; reviewOverdueTickets: number; overlappingTickets: number; blockedTickets: number };
  ticketAnalysis: { ticketDbId: string; ticketId: string; title: string; seconds: number; benchmarkMinutes: number | null; actualMinutes: number; varianceMinutes: number | null; comparison: string }[];
};

const FILTERS: { type: SegmentType; label: string; color: string }[] = [
  { type: 'OPEN', label: 'Open · not started', color: '#9aaac0' },
  { type: 'TICKET', label: 'In progress', color: '#1677c8' },
  { type: 'REVIEW_WAIT', label: 'Waiting for review', color: '#f1b62b' },
  { type: 'REWORK', label: 'Rework in progress', color: '#d45aa6' },
  { type: 'COMPLETED', label: 'Completed', color: '#22a06b' },
  { type: 'MEETING', label: 'Meeting', color: '#7857d8' },
  { type: 'BREAK', label: 'Break', color: '#f28c28' },
  { type: 'UNDEFINED', label: 'Untracked time', color: '#98a2b3' },
];
const OVERDUE_FILTERS: { type: SegmentType; label: string; color: string }[] = [
  { type: 'OVERDUE_REVIEW', label: 'Review overdue', color: '#a91f3d' },
  { type: 'OVERDUE_EXECUTION', label: 'User overdue', color: '#df3d55' },
];
const TICKET_COLORS = ['#1677c8', '#079c91', '#5b66d6', '#2a9c54', '#0d89b7'];
const SEGMENT_HEIGHT = 25;
const SEGMENT_LANE_STEP = 31;
const SEGMENT_TOP = 11;

function currentMonth() {
  const value = new Date();
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
function duration(totalSeconds: number) {
  if (!totalSeconds) return '0m';
  const minutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}
function clock(value: string) {
  return new Date(value).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}
function segmentDisplayLabel(segment: TimelineSegment) {
  if (segment.type === 'BREAK') return `Break · ${clock(segment.startAt)}–${clock(segment.endAt)}`;
  if (segment.ticketId) return `${segment.ticketId} · ${stageLabel(segment.type)}`;
  return stageLabel(segment.type);
}
function opensTicket(segment: TimelineSegment) {
  return !!segment.ticketDbId && !['BREAK', 'MEETING', 'UNDEFINED'].includes(segment.type);
}
function stageLabel(type: SegmentType) {
  const labels: Record<SegmentType, string> = {
    OPEN: 'Open · not started',
    TICKET: 'In progress',
    REWORK: 'Rework in progress',
    REVIEW_WAIT: 'Awaiting review',
    COMPLETED: 'Completed',
    OVERDUE_EXECUTION: 'User overdue',
    OVERDUE_REVIEW: 'Review overdue',
    BREAK: 'Break',
    MEETING: 'Meeting',
    UNDEFINED: 'Untracked time',
  };
  return labels[type];
}
function isOverdueType(type: SegmentType) {
  return type === 'OVERDUE_EXECUTION' || type === 'OVERDUE_REVIEW';
}
function visibleSegments(segments: TimelineSegment[], activeFilter: SegmentType | null) {
  if (activeFilter && isOverdueType(activeFilter)) return segments.filter((segment) => segment.type === activeFilter);
  return segments.filter((segment) => !isOverdueType(segment.type));
}
function isDimmed(segment: TimelineSegment, activeFilter: SegmentType | null) {
  return !!activeFilter && !isOverdueType(activeFilter) && segment.type !== activeFilter;
}
function segmentColor(type: SegmentType) {
  return [...FILTERS, ...OVERDUE_FILTERS].find((filter) => filter.type === type)?.color ?? '#98a2b3';
}
function SegmentContents({ segment }: { segment: TimelineSegment }) {
  return <>
    <span className={s.segmentLabel}>{segmentDisplayLabel(segment)}</span>
    <span className={s.segmentTooltip} role="tooltip">
      <strong>{segment.ticketId ? `${segment.ticketId} · ${stageLabel(segment.type)}` : stageLabel(segment.type)}</strong>
      <em>{segment.ticketTitle ?? segment.label}</em>
      <small>{clock(segment.startAt)}–{clock(segment.endAt)} · {duration(segment.durationSeconds)}</small>
      {segment.overdueReason && <b>{segment.overdueReason === 'EXECUTION_DELAY' ? 'User did not submit before the work deadline.' : 'The ticket stayed in review beyond the review deadline.'}</b>}
    </span>
  </>;
}
function ModalActivityRows({ segments, onTicket }: { segments: TimelineSegment[]; onTicket: (event: React.MouseEvent, id?: string) => void }) {
  const groups = new Map<string, TimelineSegment[]>();
  for (const segment of segments) {
    const key = segment.ticketDbId ? `ticket-${segment.ticketDbId}` : `activity-${segment.id}`;
    groups.set(key, [...(groups.get(key) ?? []), segment]);
  }
  if (!groups.size) return <div className={s.emptyActivity}>No activity was recorded for this day.</div>;
  return <div className={s.ticketActivityRows}>
    {Array.from(groups.entries()).map(([key, items]) => {
      const first = items[0];
      const totalSeconds = items.reduce((sum, item) => sum + item.durationSeconds, 0);
      return <article className={s.ticketActivityRow} key={key}>
        <header>
          <div><strong>{first.ticketId ?? stageLabel(first.type)}</strong><span>{first.ticketTitle ?? first.label}</span></div>
          <small>{duration(totalSeconds)} recorded</small>
        </header>
        <div className={s.ticketStageCards}>
          {items.sort((left, right) => left.startMinute - right.startMinute).map((segment) => <button
            type="button"
            key={segment.id}
            style={{ '--stage-color': segmentColor(segment.type) } as CSSProperties}
            onClick={(event) => opensTicket(segment) ? onTicket(event, segment.ticketDbId) : event.stopPropagation()}
          >
            <i />
            <span><strong>{stageLabel(segment.type)}</strong><small>{clock(segment.startAt)}–{clock(segment.endAt)} · {duration(segment.durationSeconds)}</small></span>
            {opensTicket(segment) && <ExternalLink size={16} />}
          </button>)}
        </div>
      </article>;
    })}
  </div>;
}
function dayTitle(date: string) {
  return new Date(`${date}T12:00:00.000Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
function normalizeStatus(value: string | null) {
  return value ? value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase()) : 'No attendance outcome';
}

function segmentLayout(segments: TimelineSegment[]) {
  const grouped = new Map<string, TimelineSegment[]>();
  for (const segment of segments) {
    if (!segment.ticketDbId || ['BREAK', 'MEETING', 'UNDEFINED'].includes(segment.type)) continue;
    grouped.set(segment.ticketDbId, [...(grouped.get(segment.ticketDbId) ?? []), segment]);
  }
  const groups = Array.from(grouped.entries()).sort((left, right) =>
    Math.min(...left[1].map((item) => item.startMinute)) - Math.min(...right[1].map((item) => item.startMinute)));
  const laneGroups: TimelineSegment[][][] = [];
  const ticketLanes = new Map<string, number>();
  const overlaps = (left: TimelineSegment[], right: TimelineSegment[]) => left.some((a) => right.some((b) =>
    a.startMinute < b.endMinute && b.startMinute < a.endMinute));
  for (const [ticketId, ticketSegments] of groups) {
    let lane = 0;
    while (laneGroups[lane]?.some((other) => overlaps(ticketSegments, other))) lane += 1;
    laneGroups[lane] = [...(laneGroups[lane] ?? []), ticketSegments];
    ticketLanes.set(ticketId, lane);
  }
  const ticketLaneCount = Math.max(1, laneGroups.length);
  const items = segments.map((segment) => {
    const linkedLane = segment.ticketDbId ? ticketLanes.get(segment.ticketDbId) : undefined;
    const lane = linkedLane ?? (segment.type === 'UNDEFINED' ? ticketLaneCount + 1 : ticketLaneCount);
    const baseColor = segmentColor(segment.type);
    const color = segment.type === 'TICKET' && lane > 0 ? TICKET_COLORS[lane % TICKET_COLORS.length] : baseColor;
    return { segment, lane, color };
  });
  return { items, maxLane: Math.max(ticketLaneCount + 1, ...items.map((item) => item.lane)) };
}

export function ProductivityTimelinePanel() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const roleValue = (user?.role as any)?.name ?? user?.role ?? '';
  const role = String(roleValue).toUpperCase();
  const visible = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role);
  const [month, setMonth] = useState(currentMonth);
  const [personId, setPersonId] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [activeFilter, setActiveFilter] = useState<SegmentType | null>(null);
  const [selectedDay, setSelectedDay] = useState<TimelineDay | null>(null);
  const [personOpen, setPersonOpen] = useState(false);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [search, setSearch] = useState('');

  const peopleQuery = useQuery({
    queryKey: ['productivity-timeline-people'],
    queryFn: () => workdayApi.getProductivityTimelinePeople() as Promise<TimelinePerson[]>,
    enabled: visible,
    staleTime: 60_000,
  });
  const people = peopleQuery.data ?? [];
  useEffect(() => {
    if (!personId && people.length) setPersonId(people[0].id);
    if (personId && people.length && !people.some((person) => person.id === personId)) setPersonId(people[0].id);
  }, [people, personId]);
  useEffect(() => { setPageIndex(0); setSelectedDay(null); }, [month, personId]);

  const timelineQuery = useQuery({
    queryKey: ['productivity-timeline', personId, month],
    queryFn: () => workdayApi.getProductivityTimeline(personId, month) as Promise<TimelineData>,
    enabled: visible && !!personId,
    staleTime: 30_000,
  });
  const data = timelineQuery.data;
  const page = data?.rangePages[pageIndex];
  const days = page ? data?.days.filter((day) => day.dayNumber >= page.from && day.dayNumber <= page.to) ?? [] : [];
  const selectedPerson = people.find((person) => person.id === personId);
  const shownPeople = people.filter((person) => `${person.name} ${person.role.name} ${person.department?.name ?? ''}`.toLowerCase().includes(search.toLowerCase()));

  if (!visible) return null;

  const openTicket = (event: React.MouseEvent, ticketDbId?: string) => {
    event.stopPropagation();
    if (ticketDbId) router.push(`/tickets/${ticketDbId}`);
  };

  return (
    <section className={s.timelineCard} aria-label="Productivity timeline">
      <header className={s.header}>
        <div>
          <h2>Productivity Timeline</h2>
        </div>
        <div className={s.controls}>
          <div className={s.personPicker}>
            <button type="button" className={s.personButton} onClick={() => setPersonOpen((open) => !open)} aria-expanded={personOpen}>
              <span className={s.avatar}>{selectedPerson?.photoUrl ? <img src={selectedPerson.photoUrl} alt="" /> : initials(selectedPerson?.name ?? 'Select')}</span>
              <span><small>{selectedPerson?.role.name.replaceAll('_', ' ') ?? 'Employee'}</small><strong>{selectedPerson?.name ?? 'Select a person'}</strong></span>
              <ChevronDown size={15} />
            </button>
            {personOpen && <div className={s.personPopover}>
              <label><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people…" autoFocus /></label>
              <div>{shownPeople.map((person) => <button type="button" key={person.id} aria-selected={person.id === personId} onClick={() => { setPersonId(person.id); setPersonOpen(false); setSearch(''); }}>
                <span className={s.avatar}>{person.photoUrl ? <img src={person.photoUrl} alt="" /> : initials(person.name)}</span>
                <span><strong>{person.name}</strong><small>{person.role.name.replaceAll('_', ' ')} · {person.department?.name ?? 'No department'}</small></span>
              </button>)}</div>
            </div>}
          </div>
          <label className={s.monthPicker}><CalendarDays size={15} /><span>Month</span><input type="month" value={month} max={currentMonth()} onChange={(event) => setMonth(event.target.value)} /></label>
        </div>
      </header>

      {!peopleQuery.isLoading && !people.length ? <div className={s.empty}><Users size={24} /><strong>No people are available in your hierarchy.</strong><span>Team leaders can also view themselves; other supervisors see only people below them.</span></div>
      : timelineQuery.isLoading || !data ? <div className={s.loading}>Building the recorded timeline…</div>
      : timelineQuery.isError ? <div className={s.loading}>The timeline could not be loaded. Refresh and try again.</div>
      : <>
        <div className={s.ledger}>
          <Ledger tone="ticket" icon={<TicketCheck />} label="Ticket work" value={duration(data.ledger.productiveSeconds)} detail={`${data.ledger.ticketsTouched} tickets touched · ${data.ledger.ticketsCompleted} completed`} />
          <Ledger tone="meeting" icon={<Users />} label="Meeting time" value={duration(data.ledger.meetingSeconds)} detail="Time spent in recorded meetings" />
          <Ledger tone="break" icon={<Coffee />} label="Break time" value={duration(data.ledger.breakSeconds)} detail="Recorded non-meeting breaks" />
          <Ledger tone="undefined" icon={<TimerReset />} label="Untracked time" value={duration(data.ledger.undefinedSeconds)} detail="Punched in, but no activity was recorded" />
          <Ledger tone="session" icon={<Layers3 />} label="Work sessions" value={String(data.ledger.sessionCount)} detail={`${data.ledger.overlappingTickets} overlapping · ${data.ledger.blockedTickets} blocked`} />
          <Ledger tone="overdue" icon={<AlarmClock />} label="Deadline delays" value={`${data.ledger.executionOverdueTickets} / ${data.ledger.reviewOverdueTickets}`} detail="User delay / reviewer delay" />
        </div>

        <div className={s.legend} aria-label="Timeline filters">
          <span>Filter</span>
          {FILTERS.map((filter) => <button type="button" key={filter.type} aria-pressed={activeFilter === filter.type} onClick={() => setActiveFilter(activeFilter === filter.type ? null : filter.type)}>
            <i style={{ background: filter.color }} />{filter.label}
          </button>)}
          <div className={s.overdueFilter}>
            <button type="button" className={s.overdueFilterButton} aria-haspopup="menu" aria-expanded={overdueOpen} aria-pressed={OVERDUE_FILTERS.some((filter) => filter.type === activeFilter)} onClick={() => setOverdueOpen((open) => !open)}>
              <i style={{ background: '#cf2945' }} />Overdue<ChevronDown size={13} />
            </button>
            {overdueOpen && <div className={s.overdueMenu} role="menu">
              {OVERDUE_FILTERS.map((filter) => <button type="button" role="menuitemcheckbox" aria-checked={activeFilter === filter.type} key={filter.type} onClick={() => { setActiveFilter(activeFilter === filter.type ? null : filter.type); setOverdueOpen(false); }}>
                <i style={{ background: filter.color }} />{filter.label}
              </button>)}
            </div>}
          </div>
        </div>

        {activeFilter && isOverdueType(activeFilter) && <div className={s.overdueNotice} role="status">
          Showing only <strong>{activeFilter === 'OVERDUE_EXECUTION' ? 'user overdue' : 'review overdue'}</strong> tickets on the single date when each ticket first became overdue.
        </div>}

        <div className={s.rangeTabs}>
          {data.rangePages.map((range, index) => <button type="button" key={range.from} aria-pressed={pageIndex === index} onClick={() => setPageIndex(index)}>{range.from}–{range.to}</button>)}
        </div>

        <div className={s.timelineScroll}>
          <div className={s.timelineTable}>
            <div className={s.axisRow}><div>Date</div><TimeAxis /></div>
            {days.map((day) => <DayRow key={day.date} day={day} activeFilter={activeFilter} onOpen={() => setSelectedDay(day)} onTicket={openTicket} />)}
          </div>
        </div>
      </>}

      {selectedDay && <DayTimelineModal day={selectedDay} personName={data?.identity.name ?? ''} activeFilter={activeFilter} onFilter={setActiveFilter} onClose={() => setSelectedDay(null)} onTicket={openTicket} />}
    </section>
  );
}

function Ledger({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail: string; tone: 'ticket' | 'meeting' | 'break' | 'undefined' | 'session' | 'overdue' }) {
  return <div className={`${s.ledgerItem} ${s[`ledger_${tone}`]}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong><em>{detail}</em></div></div>;
}

function TimeAxis() {
  return <div className={s.axis}>{[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => <span key={hour} style={{ left: `${hour / 24 * 100}%` }}>{hour === 0 || hour === 24 ? '12 AM' : hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}</span>)}</div>;
}

function DayRow({ day, activeFilter, onOpen, onTicket }: { day: TimelineDay; activeFilter: SegmentType | null; onOpen: () => void; onTicket: (event: React.MouseEvent, id?: string) => void }) {
  const shownSegments = visibleSegments(day.segments, activeFilter);
  const layout = segmentLayout(shownSegments);
  const rowHeight = Math.max(104, 28 + (layout.maxLane + 1) * SEGMENT_LANE_STEP);
  const specialDay = day.attendanceStatus === 'HOLIDAY'
    ? { label: 'HOLIDAY', className: s.holidayRow }
    : day.attendanceStatus === 'WEEKLY_OFF'
      ? { label: 'WEEKLY OFF', className: s.weeklyOffRow }
      : null;
  return <div className={`${s.dayRow} ${specialDay?.className ?? ''}`} style={{ minHeight: rowHeight }} onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onOpen(); }} role="button" tabIndex={0} aria-label={`Open ${dayTitle(day.date)} details`}>
    <div className={s.dayMeta}><strong>{day.dayNumber}</strong><span>{day.weekday}</span></div>
    <div className={s.track}>
      <div className={s.gridLines}>{Array.from({ length: 9 }, (_, index) => <i key={index} style={{ left: `${index / 8 * 100}%` }} />)}</div>
      {specialDay && <span className={s.specialDayLabel}>{specialDay.label}</span>}
      {!specialDay && !layout.items.length && <span className={s.noRecord}>No recorded activity</span>}
      {layout.items.map(({ segment, lane, color }) => <button
        type="button" key={segment.id}
        className={`${s.segment} ${s[`type_${segment.type}`]} ${isDimmed(segment, activeFilter) ? s.dimmed : ''}`}
        style={{ left: `${segment.startMinute / 1440 * 100}%`, width: `${Math.max(.65, (segment.endMinute - segment.startMinute) / 1440 * 100)}%`, top: `${SEGMENT_TOP + lane * SEGMENT_LANE_STEP}px`, background: color }}
        aria-label={`${segment.label} · ${clock(segment.startAt)}–${clock(segment.endAt)} · ${duration(segment.durationSeconds)}`}
        onClick={(event) => opensTicket(segment) ? onTicket(event, segment.ticketDbId) : event.stopPropagation()}
      >{segment.continuesBefore && <b>‹</b>}<SegmentContents segment={segment} />{segment.continuesAfter && <b>›</b>}</button>)}
    </div>
    <div className={s.rowStats}><span>{duration(day.kpis.productiveSeconds)}</span><small>{day.kpis.ticketsTouched} tickets · {day.kpis.sessionCount} sessions</small></div>
  </div>;
}

function DayTimelineModal({ day, personName, activeFilter, onFilter, onClose, onTicket }: { day: TimelineDay; personName: string; activeFilter: SegmentType | null; onFilter: (value: SegmentType | null) => void; onClose: () => void; onTicket: (event: React.MouseEvent, id?: string) => void }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  const modalSegments = visibleSegments(day.segments, activeFilter);
  const layout = segmentLayout(modalSegments);
  const modalTrackHeight = Math.max(128, 32 + (layout.maxLane + 1) * SEGMENT_LANE_STEP);
  return <div className={s.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={s.modal} role="dialog" aria-modal="true" aria-label={`${dayTitle(day.date)} productivity details`}>
      <header><div><span>Daily productivity record</span><h3>{dayTitle(day.date)}</h3><p>{personName} · {normalizeStatus(day.attendanceStatus)}</p></div><button type="button" onClick={onClose} aria-label="Close"><X size={19} /></button></header>
      <div className={s.modalKpis}>
        <span><small>Ticket work</small><strong>{duration(day.kpis.productiveSeconds)}</strong></span>
        <span><small>Meetings</small><strong>{duration(day.kpis.meetingSeconds)}</strong></span>
        <span><small>Breaks</small><strong>{duration(day.kpis.breakSeconds)}</strong></span>
        <span><small>Undefined</small><strong>{duration(day.kpis.undefinedSeconds)}</strong></span>
        <span><small>Sessions</small><strong>{day.kpis.sessionCount}</strong></span>
        <span><small>Completed</small><strong>{day.kpis.ticketsCompleted}</strong></span>
      </div>
      <div className={s.modalAxis}><TimeAxis /><div className={s.modalTrack} style={{ height: modalTrackHeight }}>
        {layout.items.map(({ segment, lane, color }) => <button type="button" key={segment.id} className={`${s.segment} ${s[`type_${segment.type}`]} ${isDimmed(segment, activeFilter) ? s.dimmed : ''}`} style={{ left: `${segment.startMinute / 1440 * 100}%`, width: `${Math.max(.65, (segment.endMinute - segment.startMinute) / 1440 * 100)}%`, top: `${SEGMENT_TOP + lane * SEGMENT_LANE_STEP}px`, height: SEGMENT_HEIGHT, background: color }} onClick={(event) => opensTicket(segment) ? onTicket(event, segment.ticketDbId) : event.stopPropagation()} aria-label={`${segment.label} · ${clock(segment.startAt)}–${clock(segment.endAt)} · ${duration(segment.durationSeconds)}`}><SegmentContents segment={segment} /></button>)}
      </div></div>
      <div className={s.modalBody}>
        <div className={s.modalStageFilters} aria-label="Daily timeline filters">
          <span>Show:</span>
          {[...FILTERS, ...OVERDUE_FILTERS].map((filter) => <button type="button" key={filter.type} aria-pressed={activeFilter === filter.type} onClick={() => onFilter(activeFilter === filter.type ? null : filter.type)}><i style={{ background: filter.color }} />{filter.label}</button>)}
        </div>
        <ModalActivityRows segments={modalSegments} onTicket={onTicket} />
      </div>
    </section>
  </div>;
}
