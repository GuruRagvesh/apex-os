import React from 'react';
import { cn } from '@apex/shared-utilities';

// Base shimmer skeleton — uses CSS variable colours so it adapts to all themes
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={cn('apex-skeleton', className)}
      style={{ minHeight: '1rem', ...style }}
    />
  );
}

export function SkeletonTicketRow() {
  return (
    <div
      className="flex items-center gap-4 px-4 py-3.5"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-14 rounded" />
        </div>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-7 w-7 rounded-full" />
      </div>
    </div>
  );
}

export function SkeletonTicketRows({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonTicketRow key={i} />
      ))}
    </>
  );
}

export function SkeletonStatCard() {
  return (
    <div
      className="rounded-xl p-5 space-y-3"
      style={{
        backgroundColor: 'var(--surface-card)',
        border: '1px solid var(--border-primary)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <Skeleton className="h-3.5 w-16" />
      </div>
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-3.5 w-24" />
    </div>
  );
}

export function SkeletonStatCards({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonStatCard key={i} />
      ))}
    </>
  );
}

export function SkeletonKanbanCard() {
  return (
    <div
      className="rounded-lg p-3 space-y-2.5"
      style={{
        backgroundColor: 'var(--surface-card)',
        border: '1px solid var(--border-primary)',
      }}
    >
      <div className="flex items-start justify-between">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-3 rounded-full" />
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-3.5 w-2/3" />
      <div className="flex gap-1.5">
        <Skeleton className="h-4 w-12 rounded" />
        <Skeleton className="h-4 w-12 rounded" />
      </div>
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-6 w-6 rounded-full" />
      </div>
    </div>
  );
}

export function SkeletonKanbanColumn({ cards = 3 }: { cards?: number }) {
  return (
    <div
      className="rounded-xl p-3 space-y-2.5"
      style={{
        backgroundColor: 'var(--bg-tertiary)',
        border: '1px solid var(--border-primary)',
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-6 rounded-full" />
      </div>
      {Array.from({ length: cards }).map((_, i) => (
        <SkeletonKanbanCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonTicketDetail() {
  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-start gap-3">
        <Skeleton className="h-9 w-9 rounded-lg flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="flex gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-14 rounded" />
            <Skeleton className="h-4 w-12 rounded" />
          </div>
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-3.5 w-40" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          <div
            className="rounded-xl p-5 space-y-3"
            style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-5/6" />
            <Skeleton className="h-3.5 w-4/6" />
          </div>
          <div
            className="rounded-xl p-5 space-y-3"
            style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <Skeleton className="h-4 w-24" />
            {[1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-6 w-6 rounded-full" />
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-3.5 w-4/5 ml-8" />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          <div
            className="rounded-xl p-4 space-y-2"
            style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <Skeleton className="h-4 w-12" />
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}
          </div>
          <div
            className="rounded-xl p-4 space-y-3"
            style={{
              backgroundColor: 'var(--surface-card)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-full rounded-lg" />
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-3.5 w-3.5 rounded" />
                <Skeleton className="h-3.5 w-32" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Generic card skeleton
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div
      className="rounded-xl p-5 space-y-3"
      style={{
        backgroundColor: 'var(--surface-card)',
        border: '1px solid var(--border-primary)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div className="flex items-center justify-between mb-1">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: `${75 + (i % 3) * 10}%` }} />
      ))}
    </div>
  );
}

// Table row skeleton
export function TableRowSkeleton({ cols = 5 }: { cols?: number }) {
  const widths = ['60%', '15%', '10%', '10%', '8%'];
  return (
    <div
      className="flex items-center gap-4 px-4 py-3"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} style={{ width: widths[i] ?? '12%', height: '14px' }} />
      ))}
    </div>
  );
}

export function TableRowSkeletons({ count = 5, cols = 5 }: { count?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <TableRowSkeleton key={i} cols={cols} />
      ))}
    </>
  );
}
