'use client';

import { useMemo } from 'react';
import { TrendingUp, PieChart } from 'lucide-react';
import { MOCK_LEADS } from '@/lib/sales-crm/mock-data';
import { Card, StatCard } from '@/components/sales-crm/ui/Card';

const currency = (n: number) => `$${n.toLocaleString('en-US')}`;

function groupCount<T>(items: T[], keyFn: (item: T) => string): { key: string; count: number }[] {
  const map = new Map<string, number>();
  items.forEach((item) => {
    const key = keyFn(item);
    map.set(key, (map.get(key) ?? 0) + 1);
  });
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

export default function SalesCrmAnalytics() {
  const bySource = useMemo(() => groupCount(MOCK_LEADS, (l) => l.leadSource), []);
  const byPriority = useMemo(() => groupCount(MOCK_LEADS, (l) => l.priority), []);
  const byStage = useMemo(() => groupCount(MOCK_LEADS, (l) => l.leadStage), []);

  const allDeals = useMemo(() => MOCK_LEADS.flatMap((l) => l.deals), []);
  const wonDeals = allDeals.filter((d) => d.stage === 'Won');
  const totalPipelineValue = allDeals.filter((d) => !['Won', 'Lost', 'Closed', 'Cancelled'].includes(d.stage)).reduce((sum, d) => sum + d.value, 0);
  const wonValue = wonDeals.reduce((sum, d) => sum + d.value, 0);
  const avgDealSize = allDeals.length ? Math.round(allDeals.reduce((sum, d) => sum + d.value, 0) / allDeals.length) : 0;
  const winRate = allDeals.length ? Math.round((wonDeals.length / allDeals.length) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Pipeline Value" value={currency(totalPipelineValue)} icon={<TrendingUp size={14} style={{ color: 'var(--color-primary-text)' }} />} />
        <StatCard label="Won Value" value={currency(wonValue)} sub={`${wonDeals.length} won deals`} icon={<TrendingUp size={14} style={{ color: 'var(--color-primary-text)' }} />} />
        <StatCard label="Avg Deal Size" value={currency(avgDealSize)} icon={<PieChart size={14} style={{ color: 'var(--color-primary-text)' }} />} />
        <StatCard label="Win Rate" value={`${winRate}%`} sub={`of ${allDeals.length} deals`} icon={<PieChart size={14} style={{ color: 'var(--color-primary-text)' }} />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <BreakdownCard title="Leads by Source" data={bySource} />
        <BreakdownCard title="Leads by Priority" data={byPriority} />
        <BreakdownCard title="Leads by Stage" data={byStage} />
      </div>

      <Card className="p-4 sm:p-5">
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Analytics are computed from the same local demo dataset used across Sales CRM Phase 1. Figures will reflect
          real pipeline data once the backend is connected.
        </p>
      </Card>
    </div>
  );
}

function BreakdownCard({ title, data }: { title: string; data: { key: string; count: number }[] }) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
        {title}
      </h2>
      <div className="space-y-2.5">
        {data.map((d) => (
          <div key={d.key}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium truncate" style={{ color: 'var(--color-text-secondary)' }}>
                {d.key}
              </span>
              <span style={{ color: 'var(--color-text-muted)' }}>{d.count}</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
              <div className="h-full rounded-full" style={{ width: `${(d.count / max) * 100}%`, backgroundColor: 'var(--color-primary)' }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
