'use client';

import type { ReactNode } from 'react';
import { Activity } from 'lucide-react';
import type { StatusPresentation } from '../../attendance-v2/status-presentation';
import { DASH } from './analytics-data';
import s from './analytics.module.css';

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: StatusPresentation | { glyph: string } }) {
  const chipStyle = tone && 'color' in tone ? { background: tone.tint, color: tone.color } : undefined;
  return (
    <div className={s.kpi}>
      <span className={s.kpiLabel} title={label}>{label}</span>
      <div className={s.kpiValueRow}>
        <strong className={s.kpiValue}>{value}</strong>
        {tone && <span className={s.kpiChip} style={chipStyle} aria-hidden="true">{tone.glyph}</span>}
      </div>
      <span className={s.kpiSub}>{sub}</span>
    </div>
  );
}

export function Insight({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={s.insight} role="status">
      <span className={s.insightIcon} aria-hidden="true"><Activity /></span>
      <b>{title}</b>
      <span className={s.divider} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function Card({ title, sub, right, children, table = false, className = '' }: {
  title: string; sub?: string; right?: ReactNode; children: ReactNode; table?: boolean; className?: string;
}) {
  return (
    <section className={`${table ? s.tableCard : s.card} ${className}`}>
      <header className={s.cardHead}>
        <div>
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  );
}

export function StatusBadge({ p }: { p: StatusPresentation }) {
  return (
    <span className={s.badge} style={{ background: p.tint === 'transparent' ? 'var(--bg-tertiary)' : p.tint, color: p.color }}>
      {p.glyph && <span aria-hidden="true">{p.glyph}</span>}
      {p.label}
    </span>
  );
}

export function initials(name: string | null | undefined): string {
  return (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || '?';
}

export function Person({ name, sub }: { name: string; sub?: string | null }) {
  return (
    <span className={s.person}>
      <span className={s.avatar} aria-hidden="true">{initials(name)}</span>
      <span>
        <span style={{ fontWeight: 600 }}>{name}</span>
        {sub && <span className={s.subtle}>{sub}</span>}
      </span>
    </span>
  );
}

export function Empty({ title, text }: { title: string; text?: string }) {
  return (
    <div className={s.empty}>
      <div>
        <strong>{title}</strong>
        {text}
      </div>
    </div>
  );
}

export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className={s.error} role="alert">
      <div>
        <strong>{what} could not be loaded</strong>
        No figure has been replaced with zero.{' '}
        <button type="button" className={s.linkButton} onClick={onRetry}>Retry</button>
      </div>
    </div>
  );
}

export function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className={s.legend}>
      {items.map(item => (
        <span key={item.label}><i style={{ background: item.color }} aria-hidden="true" />{item.label}</span>
      ))}
    </div>
  );
}

export function HBars({ rows, unit }: { rows: Array<{ label: string; value: number | null }>; unit: string }) {
  const max = Math.max(1, ...rows.map(r => r.value ?? 0));
  if (!rows.length) return <Empty title="Nothing to compare" text="No departments in this scope." />;
  return (
    <div role="list" aria-label={unit}>
      {rows.map(r => (
        <div role="listitem" key={r.label} className={s.hbar}>
          <span title={r.label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
          <span className={s.hbarTrack}>
            {r.value !== null && <span className={s.hbarFill} style={{ display: 'block', width: `${(r.value / max) * 100}%` }} />}
          </span>
          <b>{r.value === null ? DASH : r.value.toLocaleString('en-IN')}</b>
        </div>
      ))}
    </div>
  );
}

export function Skeleton({ height }: { height: number }) {
  return <div className={s.skeleton} style={{ height }} aria-hidden="true" />;
}
