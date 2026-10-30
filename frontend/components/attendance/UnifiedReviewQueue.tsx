'use client';

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, ListFilter, LogIn, LogOut, MoreVertical, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { refreshAttendanceViews } from './attendance-refresh';
import {
  decideUnifiedRequest,
  GRANTED_STATUS_OPTIONS,
  needsGrantedStatus,
  type GrantedAttendanceStatus,
  forwardUnifiedRequest,
  getForwardCandidates,
  getUnifiedReviewQueue,
  reviewSystemAlert,
  type ForwardCandidate,
  type UnifiedReviewItem,
} from './review-queue-api';
import {
  actionLabels,
  activeFilterCount,
  DEFAULT_FILTERS,
  filterQueueItems,
  isSystemItem,
  punchTypeLabel,
  queueOrigin,
  statusLabel,
  statusOptions,
  SYSTEM_COLUMNS,
  SYSTEM_REQUESTS_FILTER,
  SYSTEM_REQUESTS_LABEL,
  USER_REQUEST_TYPES,
} from './review-queue-presentation';

const dash = '—';
const employeeId = (item: UnifiedReviewItem) => item.employee?.employeeId?.trim() || 'Not assigned';

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function CalendarPopover({ value, onChange, onClose }: { value: string; onChange: (value: string) => void; onClose: () => void }) {
  const initial = value ? new Date(`${value}T12:00:00`) : new Date();
  const [cursor, setCursor] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));
  const today = dateKey(new Date());
  const startOffset = cursor.getDay();
  const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const years = Array.from({ length: 11 }, (_, index) => new Date().getFullYear() - 5 + index);
  const monthName = new Intl.DateTimeFormat('en-IN', { month: 'long' }).format(cursor);
  return (
    <div className="absolute right-12 top-12 z-40 w-72 rounded-xl border border-blue-200 bg-white p-3 shadow-2xl dark:border-blue-900 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="rounded-lg border border-slate-200 p-1.5 text-blue-700 hover:bg-blue-50 dark:border-slate-700"><ChevronLeft size={17} /></button>
        <div className="flex gap-1">
          <select aria-label="Calendar month" value={cursor.getMonth()} onChange={(event) => setCursor(new Date(cursor.getFullYear(), Number(event.target.value), 1))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
            {Array.from({ length: 12 }, (_, month) => <option key={month} value={month}>{new Intl.DateTimeFormat('en-IN', { month: 'long' }).format(new Date(2026, month, 1))}</option>)}
          </select>
          <select aria-label="Calendar year" value={cursor.getFullYear()} onChange={(event) => setCursor(new Date(Number(event.target.value), cursor.getMonth(), 1))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </div>
        <button type="button" aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="rounded-lg border border-slate-200 p-1.5 text-blue-700 hover:bg-blue-50 dark:border-slate-700"><ChevronRight size={17} /></button>
      </div>
      <div className="mt-3 grid grid-cols-7 text-center text-[10px] font-semibold uppercase text-slate-500">{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: startOffset }, (_, index) => <span key={`blank-${index}`} />)}
        {Array.from({ length: days }, (_, index) => {
          const day = index + 1;
          const key = dateKey(new Date(cursor.getFullYear(), cursor.getMonth(), day));
          return <button type="button" key={key} onClick={() => { onChange(key); onClose(); }} className={`h-8 rounded-lg text-xs font-semibold transition ${value === key ? 'bg-blue-700 text-white shadow' : key === today ? 'border border-blue-500 text-blue-700 hover:bg-blue-50' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'}`}>{day}</button>;
        })}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3 dark:border-slate-700">
        <span className="text-xs font-medium text-slate-500">{monthName} {cursor.getFullYear()}</span>
        <div className="flex gap-2"><button type="button" onClick={() => { onChange(''); onClose(); }} className="text-xs font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-300">All dates</button><button type="button" onClick={() => { onChange(today); onClose(); }} className="rounded-md bg-blue-700 px-2.5 py-1 text-xs font-semibold text-white">Today</button></div>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function formatTime(value: unknown) {
  if (!value || typeof value !== 'string') return dash;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function display(value: unknown) {
  if (value === null || value === undefined || value === '') return dash;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ') || dash;
  return String(value);
}

function statusClass(status: UnifiedReviewItem['status']) {
  if (status === 'APPROVED') return 'bg-emerald-600 text-white';
  if (status === 'REJECTED') return 'bg-red-600 text-white';
  return 'bg-amber-500 text-white';
}

function StatusPill({ item }: { item: Pick<UnifiedReviewItem, 'status' | 'origin'> }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${statusClass(item.status)}`}>{statusLabel(item)}</span>;
}

/** Marks a row or dialog as generated by the platform, not raised by a person. */
function SystemBadge() {
  return <span className="inline-flex items-center rounded-md bg-violet-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-violet-800 dark:bg-violet-950 dark:text-violet-200">System</span>;
}

function AffectedEmployee({ item }: { item: UnifiedReviewItem }) {
  const person = item.affectedEmployee;
  if (!person) return <span className="text-sm text-slate-500">Unknown employee</span>;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-violet-200 bg-violet-50 text-xs font-semibold text-violet-700">{initials(person.name)}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold text-slate-900 dark:text-white">{person.name}</span>
        <span className="block truncate text-[11px] font-medium text-slate-500">{person.employeeId ?? 'No employee ID'}{person.department ? ` · ${person.department}` : ''}</span>
      </span>
    </div>
  );
}

type AlertReasonView = { code: string; title: string; explanation: string };
const alertReasonsOf = (item: UnifiedReviewItem) => (item.details.alertReasons as AlertReasonView[] | undefined) ?? [];
type PunchEventView = { reviewId: string; punchType: unknown; occurredAt: unknown };
const punchEventsOf = (item: UnifiedReviewItem) => (item.details.punchEvents as PunchEventView[] | undefined) ?? [];
const businessDateOf = (item: UnifiedReviewItem) => {
  const value = item.details.businessDate;
  return typeof value === 'string' && value ? formatDate(`${value}T12:00:00`) : dash;
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

function EmployeeIdentity({ item }: { item: UnifiedReviewItem }) {
  const employee = item.employee;
  if (!employee) return <span className="font-semibold text-slate-900 dark:text-white">Company request</span>;
  const image = employee.photoUrl || employee.avatar;
  const position = employee.designation || employee.role?.name?.replaceAll('_', ' ') || 'Employee';
  return (
    <div className="flex min-w-0 items-center gap-3">
      {image ? (
        <img src={image} alt="" className="h-10 w-10 shrink-0 rounded-full border border-blue-200 object-cover" />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-xs font-semibold text-blue-700">{initials(employee.name)}</span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold text-slate-900 dark:text-white">{employee.name}</span>
        <span className="block truncate text-[11px] font-medium uppercase tracking-wide text-blue-600 dark:text-blue-300">
          {position}{employee.department?.name ? ` · ${employee.department.name}` : ''}
        </span>
      </span>
    </div>
  );
}

const detailLabels: Record<string, string> = {
  correctionType: 'Correction type', currentStatus: 'Current status', requestedIn: 'Requested in', requestedOut: 'Requested out', currentIn: 'Current in', currentOut: 'Current out',
  businessDate: 'Business date', leaveType: 'Leave type', startDate: 'Start date', endDate: 'End date', isHalfDay: 'Half day',
  fromDepartment: 'From department', toDepartment: 'To department', fromRole: 'From role', toRole: 'To role', effectiveOn: 'Effective date',
  reasonCodes: 'Evidence flags', punchType: 'Punch type', occurredAt: 'Occurred at', deviceType: 'Device type', captureChannel: 'Capture channel',
  category: 'Category', action: 'Proposed action', retentionMonths: 'Retention months', noExpiry: 'No expiry',
  reasonCode: 'Reason code', reference: 'Reference', kind: 'Adjustment kind', direction: 'Direction', amount: 'Amount', currency: 'Currency',
};

const hiddenDetailKeys = new Set(['policyCorrectionType', 'currentFingerprint', 'createdById', 'requestedById', 'proposedById']);
const timeDetailKeys = new Set(['requestedIn', 'requestedOut', 'currentIn', 'currentOut', 'occurredAt']);

function RequestDetails({ item, compact = false }: { item: UnifiedReviewItem; compact?: boolean }) {
  const entries = Object.entries(item.details).filter(([key]) => !hiddenDetailKeys.has(key));
  const ordered = item.requestType === 'ATTENDANCE_CORRECTION'
    ? ['requestedIn', 'requestedOut', 'currentIn', 'currentOut'].map((key) => [key, item.details[key]] as const)
    : entries.slice(0, compact ? 3 : entries.length);
  return (
    <div className={`grid gap-x-5 gap-y-3 ${compact ? 'grid-cols-2 xl:grid-cols-4' : 'grid-cols-2'}`}>
      {ordered.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{detailLabels[key] ?? key.replaceAll('_', ' ')}</div>
          <div className="mt-0.5 flex items-center gap-1.5 truncate text-sm font-semibold text-slate-950 dark:text-slate-100">
            {timeDetailKeys.has(key) && (key.toLowerCase().includes('out') ? <LogOut size={15} className="shrink-0 text-blue-600" /> : key === 'occurredAt' ? <Clock3 size={15} className="shrink-0 text-blue-600" /> : <LogIn size={15} className="shrink-0 text-blue-600" />)}
            <span>{timeDetailKeys.has(key) ? formatTime(value) : display(value)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function useConsoleLeft() {
  const [consoleLeft, setConsoleLeft] = useState(0);
  useLayoutEffect(() => {
    const main = document.getElementById('apex-main-content');
    const measure = () => setConsoleLeft(main?.getBoundingClientRect().left ?? 0);
    measure();
    const observer = typeof ResizeObserver === 'undefined' || !main ? null : new ResizeObserver(measure);
    observer?.observe(main);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return consoleLeft;
}

/**
 * A system alert: generated by the attendance validation engine, about an
 * employee who did not raise it. It is marked reviewed or dismissed with a
 * reason; neither touches the employee's attendance.
 */
function SystemAlertModal({ item, onClose }: { item: UnifiedReviewItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const consoleLeft = useConsoleLeft();
  const [reason, setReason] = useState('');
  const isPending = item.status === 'PENDING';
  const labels = actionLabels(item);
  const count = Number(item.details.evidenceCount ?? 1);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  const review = useMutation({
    mutationFn: (action: 'MARK_REVIEWED' | 'DISMISS') => reviewSystemAlert(item, action, reason),
    onSuccess: async (_data, action) => {
      // Only the alert changed; attendance did not, so only the queue refreshes.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['unified-review-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['unified-review-counts'] }),
      ]);
      toast.success(action === 'MARK_REVIEWED' ? 'Alert marked reviewed' : 'Alert dismissed');
      onClose();
    },
    onError: (error: any) => toast.error(error?.response?.data?.message ?? error?.message ?? 'Action failed'),
  });
  const field = (label: string, value: React.ReactNode) => (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 break-words text-sm font-semibold text-slate-950 dark:text-slate-100">{value}</div>
    </div>
  );
  return createPortal(
    <div
      className="fixed bottom-0 right-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-md"
      style={{ left: consoleLeft, top: 0 }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label={`${item.requestTypeLabel} ${item.applicationId}`} className="flex max-h-[92vh] w-full max-w-[652px] flex-col overflow-y-auto rounded-2xl border border-violet-700 bg-white shadow-2xl dark:bg-slate-900">
        <div className="bg-violet-800 px-5 py-5 text-white">
          <div className="relative w-full pr-10">
            <div className="flex flex-wrap items-center gap-2 text-xs text-violet-100"><span className="rounded bg-white/15 px-2 py-0.5 font-bold uppercase tracking-wide">System</span><span>{item.requestTypeLabel}</span>{count > 1 && <span>· {count} evidence items</span>}</div>
            <h2 className="mt-2 break-words text-lg font-bold leading-snug">{item.reason}</h2>
            <button type="button" aria-label="Close" onClick={onClose} className="absolute right-0 top-0 rounded-lg p-2 text-white/90 hover:bg-white/15"><X size={21} /></button>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-4 p-5">
          <div className="grid grid-cols-1 gap-x-5 gap-y-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 dark:bg-slate-800/60">
            {field('Source', 'System')}
            {field('Generated by', 'Attendance Validation Engine')}
            {field('Affected Employee', item.affectedEmployee ? `${item.affectedEmployee.name}${item.affectedEmployee.employeeId ? ` (${item.affectedEmployee.employeeId})` : ''}` : dash)}
            {field('Department', item.affectedEmployee?.department ?? dash)}
            {field('Business Date', businessDateOf(item))}
            {field('Punch Type', punchTypeLabel(item.details.punchType))}
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why this alert was raised</h3>
            <ul className="mt-2 space-y-2">
              {alertReasonsOf(item).map((r) => (
                <li key={r.code} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
                  <div className="font-semibold text-slate-950 dark:text-white">{r.title}</div>
                  <div className="mt-0.5 text-slate-700 dark:text-slate-300">{r.explanation}</div>
                </li>
              ))}
            </ul>
          </div>
          {punchEventsOf(item).length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Punch events</h3>
              <ul className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200 text-sm dark:divide-slate-700 dark:border-slate-700">
                {punchEventsOf(item).map((event) => (
                  <li key={event.reviewId} className="flex items-center justify-between gap-3 px-3 py-2"><span className="font-medium text-slate-900 dark:text-slate-100">{punchTypeLabel(event.punchType)}</span><span className="text-slate-600 dark:text-slate-300">{formatTime(event.occurredAt)}</span></li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-slate-500">Reviewing this alert does not approve, reject or change the employee&apos;s attendance, punches, regularizations, payroll or leave.</p>
          {isPending ? (
            <div>
              <label htmlFor={`dismiss-reason-${item.id}`} className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reason (required to dismiss)</label>
              <textarea id={`dismiss-reason-${item.id}`} value={reason} onChange={(event) => setReason(event.target.value)} rows={3} placeholder="Why is this alert being dismissed?" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-950 outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Final status</span><StatusPill item={item} /></div>
          )}
          {isPending && (
            <div className="mt-auto flex flex-wrap justify-end gap-3 pt-2">
              <button type="button" disabled={review.isPending || !reason.trim()} title={!reason.trim() ? 'Enter a reason to dismiss' : undefined} onClick={() => review.mutate('DISMISS')} className="rounded-lg border border-slate-400 px-5 py-2.5 font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800">{labels.reject}</button>
              <button type="button" disabled={review.isPending} onClick={() => review.mutate('MARK_REVIEWED')} className="rounded-lg bg-violet-700 px-5 py-2.5 font-semibold text-white transition hover:bg-violet-800 disabled:opacity-50">{labels.approve}</button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TransferPicker({ item, onDone, onCancel }: { item: UnifiedReviewItem; onDone: () => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ForwardCandidate | null>(null);
  const [reason, setReason] = useState('');
  const candidates = useQuery({
    queryKey: ['unified-review-forward-candidates', item.requestType, item.id],
    queryFn: () => getForwardCandidates(item.requestType, item.id),
    retry: false,
  });
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (candidates.data?.items ?? []).filter((person) => !needle || `${person.name} ${person.employeeId ?? ''} ${person.role} ${person.department?.name ?? ''}`.toLowerCase().includes(needle));
  }, [candidates.data, search]);
  const transfer = useMutation({
    mutationFn: () => forwardUnifiedRequest(item, selected!.id, reason),
    onSuccess: async () => {
      // A decided correction can change official attendance: refresh every
      // view of it, the Monthly Register included.
      await refreshAttendanceViews(queryClient);
      toast.success(`Transferred to ${selected?.name}`);
      onDone();
    },
    onError: (error: any) => toast.error(error?.response?.data?.message ?? error?.message ?? 'Transfer failed'),
  });
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900 dark:bg-blue-950/20">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold text-slate-950 dark:text-white">Transfer to an eligible reviewer</h4>
        <button type="button" onClick={onCancel} className="rounded p-1 text-slate-500 hover:bg-white"><X size={17} /></button>
      </div>
      <div className="relative mt-3">
        <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, ID, role or department" className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-950 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
      </div>
      <div className="mt-3 max-h-52 space-y-2 overflow-y-auto">
        {candidates.isLoading && <p className="text-sm text-slate-500">Loading eligible reviewers…</p>}
        {!candidates.isLoading && filtered.length === 0 && <p className="text-sm text-slate-500">No eligible reviewer found.</p>}
        {filtered.map((person) => (
          <button
            type="button"
            key={person.id}
            onClick={() => setSelected(person)}
            onDoubleClick={() => setSelected(null)}
            className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition ${selected?.id === person.id ? 'border-blue-600 bg-blue-100 ring-2 ring-blue-200 dark:bg-blue-950' : 'border-slate-200 bg-white hover:border-blue-300 dark:border-slate-700 dark:bg-slate-950'}`}
          >
            <span><span className="block text-sm font-semibold text-slate-950 dark:text-white">{person.name}</span><span className="text-xs text-slate-500">{person.employeeId ?? 'No employee ID'} · {person.role}</span></span>
            <span className="text-xs text-slate-500">{person.department?.name ?? 'Company-wide'}</span>
          </button>
        ))}
      </div>
      <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Transfer note (optional)" rows={2} className="mt-3 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-950 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="apex-btn apex-btn-secondary">Cancel</button>
        <button type="button" disabled={!selected || transfer.isPending} onClick={() => transfer.mutate()} className="apex-btn bg-blue-600 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{transfer.isPending ? 'Transferring…' : 'Confirm Transfer'}</button>
      </div>
    </div>
  );
}

function TransferModal({ item, onDone, onCancel }: { item: UnifiedReviewItem; onDone: () => void; onCancel: () => void }) {
  const [consoleLeft, setConsoleLeft] = useState(0);
  useLayoutEffect(() => {
    const main = document.getElementById('apex-main-content');
    const measure = () => {
      const bounds = main?.getBoundingClientRect();
      setConsoleLeft(bounds?.left ?? 0);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' || !main ? null : new ResizeObserver(measure);
    observer?.observe(main);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onCancel]);
  return createPortal(
    <div
      className="fixed bottom-0 right-0 z-[120] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
      style={{ left: consoleLeft, top: 0 }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <div role="dialog" aria-modal="true" aria-label={`Transfer ${item.requestTypeLabel}`} className="w-full max-w-lg shadow-2xl">
        <TransferPicker item={item} onCancel={onCancel} onDone={onDone} />
      </div>
    </div>,
    document.body,
  );
}

function ReviewModal({ item, onClose }: { item: UnifiedReviewItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [showTransfer, setShowTransfer] = useState(false);
  const [note, setNote] = useState('');
  const [grantedStatus, setGrantedStatus] = useState<GrantedAttendanceStatus | ''>('');
  const isPending = item.status === 'PENDING';
  const statusCorrection = needsGrantedStatus(item);
  const [consoleLeft, setConsoleLeft] = useState(0);
  useLayoutEffect(() => {
    const main = document.getElementById('apex-main-content');
    const measure = () => {
      const bounds = main?.getBoundingClientRect();
      setConsoleLeft(bounds?.left ?? 0);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' || !main ? null : new ResizeObserver(measure);
    observer?.observe(main);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showTransfer) setShowTransfer(false);
      else onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose, showTransfer]);
  const decision = useMutation({
    mutationFn: (action: 'APPROVE' | 'REJECT') => decideUnifiedRequest(item, action, note, action === 'APPROVE' && grantedStatus ? grantedStatus : undefined),
    onSuccess: async (_data, action) => {
      // A decided correction can change official attendance: refresh every
      // view of it, the Monthly Register included.
      await refreshAttendanceViews(queryClient);
      toast.success(action === 'APPROVE' ? 'Request approved' : 'Request rejected');
      onClose();
    },
    onError: (error: any) => toast.error(error?.response?.data?.message ?? error?.message ?? 'Decision failed'),
  });
  return createPortal(
    <div
      className="fixed bottom-0 right-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-md"
      style={{ left: consoleLeft, top: 0 }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-hidden={showTransfer || undefined} aria-label={`${item.requestTypeLabel} ${item.applicationId}`} className="flex min-h-[620px] max-h-[92vh] w-full max-w-[652px] flex-col overflow-y-auto rounded-2xl border border-blue-700 bg-white shadow-2xl dark:bg-slate-900">
        <div className="min-h-20 bg-[#1D4ED9] px-5 py-5 text-white">
          <div className="relative min-h-10 w-full pr-10">
            <div className="font-mono text-xs font-normal text-blue-100" title={item.applicationId}>{item.applicationId}</div>
            <h2 className="mt-2 whitespace-normal break-words text-center text-lg font-bold leading-snug">{item.reason || 'No reason supplied'}</h2>
            <button type="button" aria-label="Close" onClick={onClose} className="absolute right-0 top-0 rounded-lg p-2 text-white/90 hover:bg-white/15"><X size={21} /></button>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-4 p-5">
          <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
              <div className="min-w-0">
                <div className="text-xs uppercase text-slate-500">Employee</div>
                <div className="mt-1 truncate font-semibold text-slate-950 dark:text-white">{item.employee?.name ?? 'Company request'}</div>
                <div className="truncate text-xs text-slate-500">{item.employee ? employeeId(item) : 'Company-wide request'}</div>
              </div>
              <div className="max-w-[220px] text-center">
                <div className="text-xs uppercase text-slate-500">Request type</div>
                <div className="mt-1 font-semibold text-slate-950 dark:text-white">{item.requestTypeLabel}</div>
              </div>
              <div className="min-w-0 text-right font-semibold text-slate-950 dark:text-white">{formatDate(item.requestDate)}</div>
            </div>
            <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
              <RequestDetails item={item} />
            </div>
          </div>
          {isPending ? <div><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Decision note</label><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Add a decision note" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-950 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></div> : <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Final status</span><StatusPill item={item} /></div>}
          {isPending && statusCorrection && <div><label htmlFor={`granted-status-${item.id}`} className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status to grant on approval</label><select id={`granted-status-${item.id}`} name="grantedStatus" value={grantedStatus} onChange={(event) => setGrantedStatus(event.target.value as GrantedAttendanceStatus | '')} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm text-slate-950 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"><option value="">Choose a status</option>{GRANTED_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><p className="mt-1 text-xs text-slate-500">If the day cannot take this status (leave, holiday, weekly off, or not yet evaluated), the approval is held for HR instead of changing attendance.</p></div>}
          {isPending && <div className="mt-auto flex flex-wrap justify-end gap-3 pt-2">
              <button type="button" disabled={decision.isPending} onClick={() => decision.mutate('REJECT')} className="rounded-lg border border-red-500 px-5 py-2.5 font-semibold text-red-600 transition hover:bg-red-600 hover:text-white hover:shadow-[0_0_16px_rgba(220,38,38,0.45)] disabled:opacity-50">Reject</button>
              <button type="button" onClick={() => setShowTransfer((value) => !value)} className="rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white transition hover:bg-blue-700 hover:shadow-[0_0_16px_rgba(37,99,235,0.4)]">Transfer To</button>
              <button type="button" disabled={decision.isPending || (statusCorrection && !grantedStatus)} title={statusCorrection && !grantedStatus ? 'Choose the status to grant first' : undefined} onClick={() => decision.mutate('APPROVE')} className="rounded-lg bg-emerald-600 px-5 py-2.5 font-semibold text-white transition hover:bg-emerald-700 hover:shadow-[0_0_16px_rgba(5,150,105,0.45)] disabled:opacity-50">Approve</button>
            </div>}
        </div>
      </div>
      {isPending && showTransfer && <TransferModal item={item} onCancel={() => setShowTransfer(false)} onDone={onClose} />}
    </div>,
    document.body,
  );
}

export function UnifiedReviewQueue({ scope }: { scope: 'team' | 'company' }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<UnifiedReviewItem | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<UnifiedReviewItem | null>(null);
  const [dateFilter, setDateFilter] = useState('');
  const [showCalendar, setShowCalendar] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [nameFilter, setNameFilter] = useState('');
  const [chosenType, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<UnifiedReviewItem['status'] | ''>('PENDING');
  // System alerts are company-wide; the team tab never offers them, so a
  // System Requests choice made on the company tab reads as "all" there.
  const typeFilter = scope !== 'company' && chosenType === SYSTEM_REQUESTS_FILTER ? '' : chosenType;
  // System alerts are a separate server list, fetched only when chosen.
  const origin = queueOrigin(typeFilter);
  const systemView = origin === 'system';
  const queue = useQuery({
    queryKey: ['unified-review-queue', scope, origin],
    queryFn: () => getUnifiedReviewQueue(scope, origin),
    retry: false,
  });
  const quickReview = useMutation({
    mutationFn: (item: UnifiedReviewItem) => reviewSystemAlert(item, 'MARK_REVIEWED'),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['unified-review-queue'] }),
        queryClient.invalidateQueries({ queryKey: ['unified-review-counts'] }),
      ]);
      toast.success('Alert marked reviewed');
      setMenu(null);
    },
    onError: (error: any) => toast.error(error?.response?.data?.message ?? error?.message ?? 'Action failed'),
  });
  const quickDecision = useMutation({
    mutationFn: ({ item, action }: { item: UnifiedReviewItem; action: 'APPROVE' | 'REJECT' }) => decideUnifiedRequest(item, action),
    onSuccess: async (_data, variables) => {
      // A decided correction can change official attendance: refresh every
      // view of it, the Monthly Register included.
      await refreshAttendanceViews(queryClient);
      toast.success(variables.action === 'APPROVE' ? 'Request approved' : 'Request rejected');
      setMenu(null);
    },
    onError: (error: any) => toast.error(error?.response?.data?.message ?? error?.message ?? 'Action failed'),
  });
  // The filter bar stays on screen even when the default list is empty, so
  // System Requests can still be chosen; only the first load replaces it.
  if (queue.isLoading && !systemView) return <div className="apex-card p-8 text-center apex-text-muted">Loading review requests…</div>;
  if (queue.isError && !systemView) return <div className="apex-card border-red-300 p-6 text-red-600">Could not load the review queue.</div>;
  const allItems = queue.data?.items ?? [];
  const today = dateKey(new Date());
  const activeAdditionalFilters = activeFilterCount({ date: dateFilter, name: nameFilter, type: typeFilter, status: statusFilter });
  const dateLabel = !dateFilter
    ? 'All dates'
    : dateFilter === today
      ? 'Today'
      : formatDate(`${dateFilter}T12:00:00`);
  const visibleItems = filterQueueItems(allItems, { date: dateFilter, name: nameFilter, type: typeFilter, status: statusFilter });
  const resetAdditionalFilters = () => {
    setNameFilter(DEFAULT_FILTERS.name);
    setTypeFilter(DEFAULT_FILTERS.type);
    setStatusFilter(DEFAULT_FILTERS.status);
  };
  const columnCount = systemView ? SYSTEM_COLUMNS.length + 1 : 6;
  const emptyMessage = queue.isLoading
    ? 'Loading system alerts…'
    : queue.isError
      ? 'Could not load system alerts.'
      : allItems.length === 0
        ? (systemView ? 'No system alerts.' : 'Nothing is waiting for your review.')
        : (systemView ? 'No system alerts match the selected filters.' : 'No review requests match the selected filters.');
  return (
    <>
      <div className="relative mb-3 flex items-center justify-end gap-2" aria-label="Review table filters">
        <button
          type="button"
          aria-label="Filter by request date"
          aria-expanded={showCalendar}
          onClick={() => { setShowCalendar((value) => !value); setShowFilters(false); }}
          className="flex h-10 min-w-32 items-center justify-between gap-2 rounded-lg border border-blue-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-blue-50 dark:border-blue-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-blue-950"
        >
          <span className="flex items-center gap-2"><CalendarDays size={17} className="text-blue-600" />{dateLabel}</span>
          <ChevronRight size={15} className={`text-slate-400 transition-transform ${showCalendar ? 'rotate-90' : ''}`} />
        </button>
        <button
          type="button"
          aria-label="Additional filters"
          aria-expanded={showFilters}
          onClick={() => { setShowFilters((value) => !value); setShowCalendar(false); }}
          className={`relative flex h-10 w-10 items-center justify-center rounded-lg border bg-white text-blue-700 shadow-sm hover:bg-blue-50 dark:bg-slate-900 dark:text-blue-300 ${showFilters || activeAdditionalFilters ? 'border-blue-600 ring-2 ring-blue-100 dark:border-blue-500 dark:ring-blue-950' : 'border-blue-300 dark:border-blue-800'}`}
        >
          <ListFilter size={18} />
          {activeAdditionalFilters > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-700 px-1 text-[10px] font-bold text-white">{activeAdditionalFilters}</span>}
        </button>
        {showCalendar && <CalendarPopover value={dateFilter} onChange={setDateFilter} onClose={() => setShowCalendar(false)} />}
        {showFilters && (
          <div className="absolute right-0 top-12 z-40 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-blue-200 bg-white p-4 shadow-2xl dark:border-blue-900 dark:bg-slate-900" role="dialog" aria-label="Additional review filters">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-950 dark:text-white">Filter requests</h3>
              <button type="button" aria-label="Close filters" onClick={() => setShowFilters(false)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={17} /></button>
            </div>
            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Name
              <div className="relative mt-1.5">
                <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
                <input value={nameFilter} onChange={(event) => setNameFilter(event.target.value)} placeholder={systemView ? 'Search affected employee' : 'Search employee name'} className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm font-normal normal-case tracking-normal text-slate-950 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </div>
            </label>
            <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Type
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-950 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                <option value="">All request types</option>
                {USER_REQUEST_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                {scope === 'company' && <option value={SYSTEM_REQUESTS_FILTER}>{SYSTEM_REQUESTS_LABEL}</option>}
              </select>
            </label>
            <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Status
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as UnifiedReviewItem['status'] | '')} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-950 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
                <option value="">All statuses</option>
                {statusOptions(systemView).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <div className="mt-4 flex justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
              <button type="button" onClick={resetAdditionalFilters} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Reset</button>
              <button type="button" onClick={() => setShowFilters(false)} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">Done</button>
            </div>
          </div>
        )}
      </div>
      {systemView ? (
        <div className="overflow-x-auto rounded-xl border-2 border-violet-300 bg-white shadow-sm dark:border-violet-800 dark:bg-slate-900">
        <table className="w-full min-w-[980px] table-fixed border-collapse text-left" aria-label="System alerts">
          <thead className="bg-violet-900 text-xs uppercase tracking-wide text-white">
            <tr className="border-b-2 border-violet-300 dark:border-violet-800">
              <th className="w-[110px] border-r border-white/20 px-4 py-3">{SYSTEM_COLUMNS[0]}</th>
              <th className="w-[220px] border-r border-white/20 px-4 py-3">{SYSTEM_COLUMNS[1]}</th>
              <th className="w-[34%] border-r border-white/20 px-4 py-3">{SYSTEM_COLUMNS[2]}</th>
              <th className="w-[130px] border-r border-white/20 px-4 py-3">{SYSTEM_COLUMNS[3]}</th>
              <th className="w-[140px] border-r border-white/20 px-4 py-3">{SYSTEM_COLUMNS[4]}</th>
              <th className="w-[130px] border-r border-white/20 px-4 py-3">{SYSTEM_COLUMNS[5]}</th>
              <th className="w-14 px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y-2 divide-slate-300 dark:divide-slate-700">
            {visibleItems.map((item) => {
              const count = Number(item.details.evidenceCount ?? 1);
              const labels = actionLabels(item);
              return (
                <tr key={`${item.requestType}:${item.id}`} onClick={() => setSelected(item)} className="cursor-pointer align-middle odd:bg-white even:bg-slate-50 transition hover:bg-violet-50 dark:odd:bg-slate-900 dark:even:bg-slate-900/70 dark:hover:bg-violet-950/20">
                  <td className="px-4 py-4"><SystemBadge /></td>
                  <td className="px-4 py-4"><AffectedEmployee item={item} /></td>
                  <td className="px-4 py-4">
                    <p className="line-clamp-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{item.reason}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{alertReasonsOf(item)[0]?.explanation ?? ''}</p>
                    {count > 1 && <p className="mt-1 text-xs font-semibold text-violet-700 dark:text-violet-300">{count} evidence items</p>}
                  </td>
                  <td className="px-4 py-4 text-sm font-semibold text-slate-700 dark:text-slate-300">{businessDateOf(item)}</td>
                  <td className="px-4 py-4 text-sm text-slate-700 dark:text-slate-300">{punchTypeLabel(item.details.punchType)}</td>
                  <td className="px-4 py-4"><StatusPill item={item} /></td>
                  <td className="relative px-4 py-4" onClick={(event) => event.stopPropagation()}>
                    {item.status === 'PENDING' ? <button type="button" aria-label={`Actions for alert about ${item.affectedEmployee?.name ?? item.applicationId}`} onClick={() => setMenu((value) => value === item.id ? null : item.id)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"><MoreVertical size={20} /></button> : <span className="text-slate-400">{dash}</span>}
                    {item.status === 'PENDING' && menu === item.id && <div className="absolute right-10 top-3 z-20 w-48 rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                      <button type="button" disabled={quickReview.isPending} onClick={() => quickReview.mutate(item)} className="w-full rounded px-3 py-2 text-left text-sm font-medium text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950">{labels.approve}</button>
                      <button type="button" onClick={() => { setMenu(null); setSelected(item); }} className="w-full rounded px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800">{labels.reject}</button>
                    </div>}
                  </td>
                </tr>
              );
            })}
            {visibleItems.length === 0 && <tr><td colSpan={columnCount} className="px-6 py-10 text-center text-sm text-slate-500">{emptyMessage}</td></tr>}
          </tbody>
        </table>
      </div>
      ) : (
      <div className="overflow-x-auto rounded-xl border-2 border-blue-300 bg-white shadow-sm dark:border-blue-800 dark:bg-slate-900">
        <table className="w-full min-w-[1080px] table-fixed border-collapse text-left">
          <thead className="bg-[#1f4f82] text-xs uppercase tracking-wide text-white">
            <tr className="border-b-2 border-blue-300 dark:border-blue-800"><th className="w-[120px] border-r border-white/20 px-4 py-3">Employee ID</th><th className="w-[220px] border-r border-white/20 px-4 py-3">Name</th><th className="w-[175px] border-r border-white/20 px-4 py-3">Type</th><th className="w-[48%] border-r border-white/20 px-4 py-3">Reason / Request details</th><th className="w-[110px] border-r border-white/20 px-4 py-3">Status</th><th className="w-14 px-4 py-3"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody className="divide-y-2 divide-slate-300 dark:divide-slate-700">
            {visibleItems.map((item) => (
              <tr key={`${item.requestType}:${item.id}`} onClick={() => setSelected(item)} className="cursor-pointer align-middle odd:bg-white even:bg-slate-50 transition hover:bg-blue-50 dark:odd:bg-slate-900 dark:even:bg-slate-900/70 dark:hover:bg-blue-950/20">
                <td className="px-4 py-4 text-sm font-semibold text-slate-700 dark:text-slate-300">{item.employee ? employeeId(item) : dash}</td>
                <td className="px-4 py-4"><EmployeeIdentity item={item} /></td>
                <td className="px-4 py-4"><span className="inline-flex rounded-md bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200">{item.requestTypeLabel}</span></td>
                <td className="px-4 py-4"><p className="mb-3 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{item.reason}</p><RequestDetails item={item} compact /></td>
                <td className="px-4 py-4"><StatusPill item={item} /></td>
                <td className="relative px-4 py-4" onClick={(event) => event.stopPropagation()}>
                  {item.status === 'PENDING' ? <button type="button" aria-label={`Actions for ${item.employee?.name ?? item.applicationId}`} onClick={() => setMenu((value) => value === item.id ? null : item.id)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"><MoreVertical size={20} /></button> : <span className="text-slate-400">{dash}</span>}
                  {item.status === 'PENDING' && menu === item.id && <div className="absolute right-10 top-3 z-20 w-40 rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                    <button type="button" onClick={() => { if (needsGrantedStatus(item)) { setMenu(null); setSelected(item); } else quickDecision.mutate({ item, action: 'APPROVE' }); }} className="w-full rounded px-3 py-2 text-left text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950">Approve</button>
                    <button type="button" onClick={() => quickDecision.mutate({ item, action: 'REJECT' })} className="w-full rounded px-3 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950">Reject</button>
                    <button type="button" onClick={() => { setTransfer(item); setMenu(null); }} className="w-full rounded px-3 py-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950">Transfer To</button>
                  </div>}
                </td>
              </tr>
            ))}
            {visibleItems.length === 0 && <tr><td colSpan={columnCount} className="px-6 py-10 text-center text-sm text-slate-500">{emptyMessage}</td></tr>}
          </tbody>
        </table>
      </div>
      )}
      {transfer && <TransferModal item={transfer} onCancel={() => setTransfer(null)} onDone={() => setTransfer(null)} />}
      {selected && (isSystemItem(selected)
        ? <SystemAlertModal item={selected} onClose={() => setSelected(null)} />
        : <ReviewModal item={selected} onClose={() => setSelected(null)} />)}
    </>
  );
}
