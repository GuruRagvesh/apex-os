'use client';

import { AlertTriangle, CheckCircle2, Clock, Info } from 'lucide-react';
import type { BannerTone } from './my-attendance-v2-api';
import { BRAND } from './status-presentation';

/**
 * The attention banner above the calendar.
 *
 * The BACKEND chooses the message. This component chooses how it looks and
 * nothing else — there is no `if (isInProgress) return "Workday still open"`
 * here, because a message assembled in React is a verdict assembled in React,
 * and the first state nobody thought about would get somebody else's sentence.
 *
 * Tone drives colour, and an icon always accompanies it.
 */
const TONE: Record<BannerTone, { color: string; tint: string; Icon: typeof Info }> = {
  INFO: { color: BRAND.blue, tint: BRAND.paleBlue, Icon: Clock },
  ATTENTION: { color: '#92400E', tint: '#FEF3C7', Icon: AlertTriangle },
  NEUTRAL: { color: '#52525B', tint: '#F4F4F5', Icon: Info },
  POSITIVE: { color: '#15803D', tint: '#DCFCE7', Icon: CheckCircle2 },
};

export function StatusBanner({
  banner,
}: {
  banner: { tone: BannerTone; title: string; detail: string } | null;
}) {
  if (!banner) return null;
  const { color, tint, Icon } = TONE[banner.tone] ?? TONE.NEUTRAL;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border p-4"
      style={{ background: tint, borderColor: `${color}33` }}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color }} aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-semibold" style={{ color }}>
          {banner.title}
        </p>
        <p className="apex-text-muted mt-0.5 text-sm">{banner.detail}</p>
      </div>
    </div>
  );
}
