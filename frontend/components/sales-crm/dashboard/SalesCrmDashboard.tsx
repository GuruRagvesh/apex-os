'use client';

import { useMemo } from 'react';
import { Users, Activity, Handshake, DollarSign, AlertTriangle, Clock } from 'lucide-react';
import { getDashboardData } from '@/lib/sales-crm/dashboard-calculations';
import { MOCK_LEADS } from '@/lib/sales-crm/mock-data';
import { Role } from '@/lib/sales-crm/types';
import { Card, StatCard } from '@/components/sales-crm/ui/Card';
import { PlainBadge } from '@/components/sales-crm/ui/Badge';

const currency = (n: number) => `$${n.toLocaleString('en-US')}`;

export default function SalesCrmDashboard() {
  const data = useMemo(() => getDashboardData(MOCK_LEADS, Role.SUPERADMIN, '', 'team', 'all'), []);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Total Leads" value={data.totalLeads} sub={`${data.activeLeads} active`} icon={<Users size={14} style={{ color: 'var(--color-primary-text)' }} />} />
        <StatCard label="Active Deals" value={data.activeDeals.count} sub={currency(data.activeDeals.value)} icon={<Handshake size={14} style={{ color: 'var(--color-primary-text)' }} />} />
        <StatCard label="Conversion Rate" value={`${data.conversionRate}%`} sub={`${data.newLeads} new leads`} icon={<Activity size={14} style={{ color: 'var(--color-primary-text)' }} />} />
        <StatCard label="Revenue (Won)" value={currency(data.revenue)} sub={`${data.requirementsCaptured.total} requirements`} icon={<DollarSign size={14} style={{ color: 'var(--color-primary-text)' }} />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4 sm:p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--color-text-primary)' }}>
            Lead Funnel
          </h2>
          <div className="space-y-2.5">
            {data.leadFunnel.map((group) => {
              const max = Math.max(...data.leadFunnel.map((g) => g.count), 1);
              const pct = Math.round((group.count / max) * 100);
              return (
                <div key={group.groupName}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                      {group.groupName}
                      {group.isBottleneck && <PlainBadge tone="warning">Bottleneck</PlainBadge>}
                    </span>
                    <span style={{ color: 'var(--color-text-muted)' }}>{group.count}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: group.color.startsWith('var') ? 'var(--color-primary)' : group.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
            <Clock size={14} style={{ color: 'var(--color-text-muted)' }} />
            Today&apos;s Action Board
          </h2>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <MiniStat label="Calls due" value={data.todayActionBoard.summary.callsDue} />
            <MiniStat label="Follow-ups" value={data.todayActionBoard.summary.followupsDue} />
            <MiniStat label="Meetings" value={data.todayActionBoard.summary.meetingsToday} />
            <MiniStat label="Requirements" value={data.todayActionBoard.summary.requirementsPending} />
          </div>
          {data.todayActionBoard.workList.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Nothing due today.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.todayActionBoard.workList.slice(0, 5).map((item) => (
                <li key={item.id} className="text-xs flex items-center justify-between gap-2" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="truncate">
                    {item.type} · {item.leadCompany}
                  </span>
                  <span className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                    {item.time}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>
            Owner Performance
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--color-text-muted)' }}>
                  <th className="text-left font-medium pb-2">Owner</th>
                  <th className="text-right font-medium pb-2">Leads</th>
                  <th className="text-right font-medium pb-2">Deals</th>
                  <th className="text-right font-medium pb-2">Risk</th>
                </tr>
              </thead>
              <tbody>
                {data.ownerPerformance.map((o) => (
                  <tr key={o.ownerId} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td className="py-2" style={{ color: 'var(--color-text-primary)' }}>
                      {o.ownerName}
                    </td>
                    <td className="text-right" style={{ color: 'var(--color-text-secondary)' }}>
                      {o.leads}
                    </td>
                    <td className="text-right" style={{ color: 'var(--color-text-secondary)' }}>
                      {o.deals}
                    </td>
                    <td className="text-right">{o.risk > 0 ? <PlainBadge tone="danger">{o.risk}</PlainBadge> : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
            <AlertTriangle size={14} style={{ color: 'var(--color-warning)' }} />
            Needs Attention
          </h2>
          {data.needsAttention.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Nothing needs attention right now.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {data.needsAttention.map((item) => (
                <li key={item.id} className="flex items-start gap-2">
                  <PlainBadge tone={item.type === 'error' ? 'danger' : 'warning'}>{item.title}</PlainBadge>
                  <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {item.instruction}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg p-2.5" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
      <div className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
        {value}
      </div>
      <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
        {label}
      </div>
    </div>
  );
}
