'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Clock3, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { usersApi } from '@apex/core-users/api';
import { useAuthStore } from '@apex/core-identity';

export type AvailabilityStatus = 'AUTO' | 'AVAILABLE' | 'BUSY' | 'DO_NOT_DISTURB' | 'BE_RIGHT_BACK' | 'AWAY' | 'APPEAR_OFFLINE';
type Availability = {
  selectedStatus: AvailabilityStatus;
  effectiveStatus: Exclude<AvailabilityStatus, 'AUTO'>;
  expiresAt: string | null;
  workdayStatus: string;
};

const OPTIONS: { value: Exclude<AvailabilityStatus, 'AUTO'>; label: string; color: string; symbol: string }[] = [
  { value: 'AVAILABLE', label: 'Available', color: '#16a34a', symbol: '✓' },
  { value: 'BUSY', label: 'Busy', color: '#dc2626', symbol: '●' },
  { value: 'DO_NOT_DISTURB', label: 'Do not disturb', color: '#dc2626', symbol: '−' },
  { value: 'BE_RIGHT_BACK', label: 'Be right back', color: '#eab308', symbol: '◷' },
  { value: 'AWAY', label: 'Appear away', color: '#eab308', symbol: '◷' },
  { value: 'APPEAR_OFFLINE', label: 'Appear offline', color: '#64748b', symbol: '×' },
];

export function AvailabilityControl({ compact = false, align = 'right' }: { compact?: boolean; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState<number | null>(60);
  const root = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const userId = useAuthStore((state) => state.user?.id);
  const queryKey = ['my-availability', userId];
  const { data, isError, isLoading, refetch } = useQuery({
    queryKey,
    queryFn: () => usersApi.getAvailability() as Promise<Availability>,
    refetchInterval: 60_000,
    enabled: !!userId,
  });
  const update = useMutation({
    mutationFn: ({ status, duration }: { status: AvailabilityStatus; duration: number | null }) =>
      usersApi.setAvailability(status, duration) as Promise<Availability>,
    onSuccess: (result) => {
      qc.setQueryData(queryKey, result);
      toast.success(result.selectedStatus === 'AUTO' ? 'Availability reset to workday status' : 'Availability updated');
      setOpen(false);
    },
    onError: () => toast.error('Availability could not be updated'),
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const current = OPTIONS.find((option) => option.value === data?.effectiveStatus) ?? OPTIONS[5];
  const selected = data?.selectedStatus ?? 'AUTO';
  const until = data?.expiresAt ? new Date(data.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;

  return <div className="relative" ref={root}>
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={isLoading ? 'Loading availability' : `Availability: ${current.label}. Change availability`}
      className={`inline-flex max-w-full items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors hover:opacity-80 ${compact ? 'border-transparent px-2' : ''}`}
      style={{ borderColor: compact ? 'transparent' : 'var(--border-primary)', color: 'var(--text-primary)', backgroundColor: compact ? 'transparent' : 'var(--surface-card)' }}
    >
      <span className="grid h-4 w-4 flex-shrink-0 place-items-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: current.color }}>{current.symbol}</span>
      <span className={compact ? 'hidden sm:inline' : ''}>{isLoading ? 'Loading…' : current.label}</span>
      <ChevronDown size={13} aria-hidden="true" />
    </button>
    {open && <div
      role="dialog"
      aria-label="Set availability"
      className={`absolute top-full z-50 mt-2 w-72 max-w-[calc(100vw-1.5rem)] rounded-2xl border p-2 shadow-xl ${align === 'left' ? 'left-0' : 'right-0'}`}
      style={{ backgroundColor: 'var(--surface-elevated)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
    >
      <div className="px-2 pb-2 pt-1">
        <p className="text-sm font-semibold">Set availability</p>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>Shown to teammates. Attendance and notification delivery do not change.</p>
      </div>
      {isError && <button type="button" onClick={() => refetch()} className="w-full rounded-lg px-2 py-2 text-left text-xs" style={{ color: 'var(--color-danger)' }}>Could not load availability. Retry</button>}
      {OPTIONS.map((option) => <button
        key={option.value}
        type="button"
        aria-pressed={selected === option.value}
        disabled={update.isPending}
        onClick={() => update.mutate({ status: option.value, duration: durationMinutes })}
        className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
      >
        <span className="grid h-5 w-5 place-items-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: option.color }}>{option.symbol}</span>
        <span className="flex-1">{option.label}</span>
        {selected === option.value && <Check size={15} aria-hidden="true" style={{ color: 'var(--accent)' }} />}
      </button>)}
      <div className="mt-1 border-t px-2 pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
        <label htmlFor={`availability-duration-${compact ? 'top' : 'profile'}`} className="mb-1.5 flex items-center gap-2 text-xs font-medium"><Clock3 size={14} /> Reset after</label>
        <select
          id={`availability-duration-${compact ? 'top' : 'profile'}`}
          value={durationMinutes ?? 'never'}
          onChange={(event) => setDurationMinutes(event.target.value === 'never' ? null : Number(event.target.value))}
          className="apex-input w-full text-sm"
        >
          <option value={60}>1 hour</option>
          <option value={240}>4 hours</option>
          <option value={480}>8 hours</option>
          <option value="never">Until I reset it</option>
        </select>
        {selected !== 'AUTO' && <>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>{until ? `Current choice resets at ${until}.` : 'Current choice stays until you reset it.'}</p>
          <button type="button" disabled={update.isPending} onClick={() => update.mutate({ status: selected, duration: durationMinutes })} className="mt-2 rounded-lg px-2 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-text)' }}>Apply duration</button>
        </>}
      </div>
      <button type="button" disabled={update.isPending} onClick={() => update.mutate({ status: 'AUTO', duration: null })} className="mt-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-[var(--bg-tertiary)] disabled:opacity-50"><RotateCcw size={15} /> Reset to workday status</button>
    </div>}
  </div>;
}
