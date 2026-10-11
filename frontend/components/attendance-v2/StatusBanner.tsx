'use client';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { BannerTone } from './my-attendance-v2-api';
import s from './visual-fidelity.module.css';
const TONE: Record<BannerTone, { color: string; tint: string; Icon: typeof Info }> = {
  INFO: { color: '#F05A00', tint: '#FFF5ED', Icon: AlertCircle },
  ATTENTION: { color: '#92400E', tint: '#FEF3C7', Icon: AlertTriangle },
  NEUTRAL: { color: '#52525B', tint: '#F4F4F5', Icon: Info },
  POSITIVE: { color: '#15803D', tint: '#DCFCE7', Icon: CheckCircle2 },
};
export function StatusBanner({ banner }: { banner: { tone: BannerTone; title: string; detail: string } | null }) {
  if (!banner) return null;
  const { color, tint, Icon } = TONE[banner.tone] ?? TONE.NEUTRAL;
  return <div role="status" className={s.banner} style={{ background: tint }}><Icon style={{ color }} aria-hidden="true" /><strong style={{ color }}>{banner.title}</strong><p>{banner.detail}</p></div>;
}
