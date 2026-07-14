const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  High: { bg: 'rgba(239,68,68,0.15)', text: '#f87171' },
  Medium: { bg: 'rgba(245,158,11,0.15)', text: '#fbbf24' },
  Low: { bg: 'rgba(16,185,129,0.15)', text: '#34d399' },
};

export function PriorityBadge({ priority }: { priority: string }) {
  const c = PRIORITY_COLORS[priority] ?? { bg: 'rgba(100,116,139,0.15)', text: '#94a3b8' };
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {priority}
    </span>
  );
}

const STAGE_COLOR_BUCKETS: { test: (s: string) => boolean; bg: string; text: string }[] = [
  { test: (s) => s === 'Closed' || s === 'Invalid', bg: 'rgba(100,116,139,0.15)', text: '#94a3b8' },
  { test: (s) => s === 'Hold' || s === 'Cold', bg: 'rgba(100,116,139,0.15)', text: '#64748b' },
  { test: (s) => s.startsWith('Level 5') || s.startsWith('Level 6'), bg: 'rgba(16,185,129,0.15)', text: '#34d399' },
  { test: (s) => s.startsWith('Level 3') || s.startsWith('Level 4'), bg: 'rgba(245,158,11,0.15)', text: '#fbbf24' },
  { test: () => true, bg: 'rgba(139,92,246,0.15)', text: '#a78bfa' },
];

export function StageBadge({ stage }: { stage: string }) {
  const c = STAGE_COLOR_BUCKETS.find((b) => b.test(stage))!;
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {stage}
    </span>
  );
}

export function PlainBadge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' }) {
  const toneMap: Record<string, { bg: string; text: string }> = {
    neutral: { bg: 'rgba(100,116,139,0.15)', text: '#94a3b8' },
    primary: { bg: 'rgba(139,92,246,0.15)', text: '#a78bfa' },
    success: { bg: 'rgba(16,185,129,0.15)', text: '#34d399' },
    warning: { bg: 'rgba(245,158,11,0.15)', text: '#fbbf24' },
    danger: { bg: 'rgba(239,68,68,0.15)', text: '#f87171' },
  };
  const c = toneMap[tone];
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {children}
    </span>
  );
}
