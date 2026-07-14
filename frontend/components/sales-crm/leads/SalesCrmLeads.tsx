'use client';

import { useMemo, useState } from 'react';
import { Search, ChevronDown, ChevronUp, Phone, Mail, MapPin } from 'lucide-react';
import { MOCK_LEADS } from '@/lib/sales-crm/mock-data';
import { getLeadsStats, filterAndSearchLeads, type LeadFilterState } from '@/lib/sales-crm/lead-calculations';
import type { Lead } from '@/lib/sales-crm/types';
import { Card, StatCard } from '@/components/sales-crm/ui/Card';
import { StageBadge, PriorityBadge, PlainBadge } from '@/components/sales-crm/ui/Badge';
import { EmptyState } from '@/components/sales-crm/ui/EmptyState';
import { Target, Users, Clock, CheckCircle2 } from 'lucide-react';

const OWNER_NAMES: Record<string, string> = {
  'u-superadmin-1': 'Priya Sharma',
  'u-admin-1': 'Rahul Mehta',
  'u-employee-1': 'Sneha Patil',
};

const EMPTY_FILTERS: LeadFilterState = { owner: '', stage: '', source: '' };

export default function SalesCrmLeads() {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<LeadFilterState>(EMPTY_FILTERS);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const stats = useMemo(() => getLeadsStats(MOCK_LEADS), []);
  const filtered = useMemo(() => filterAndSearchLeads(MOCK_LEADS, search, filters), [search, filters]);

  const stages = useMemo(() => Array.from(new Set(MOCK_LEADS.map((l) => l.leadStage))).sort(), []);
  const sources = useMemo(() => Array.from(new Set(MOCK_LEADS.map((l) => l.leadSource))).sort(), []);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Total Leads" value={stats.totalLeads} icon={<Target size={14} style={{ color: 'var(--color-primary-text)' }} />} />
        <StatCard label="Active Leads" value={stats.activeLeads} icon={<Users size={14} style={{ color: 'var(--color-primary-text)' }} />} />
        <StatCard label="Pending Follow-ups" value={stats.pendingFollowups} icon={<Clock size={14} style={{ color: 'var(--color-primary-text)' }} />} />
        <StatCard label="Qualified" value={stats.qualifiedLeads} icon={<CheckCircle2 size={14} style={{ color: 'var(--color-primary-text)' }} />} />
      </div>

      <Card className="p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads, companies, contacts..."
              className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none"
              style={{ backgroundColor: 'var(--color-surface-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
            />
          </div>
          <select
            value={filters.stage}
            onChange={(e) => setFilters((f) => ({ ...f, stage: e.target.value }))}
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ backgroundColor: 'var(--color-surface-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
          >
            <option value="">All Stages</option>
            {stages.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={filters.source}
            onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ backgroundColor: 'var(--color-surface-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
          >
            <option value="">All Sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={filters.owner}
            onChange={(e) => setFilters((f) => ({ ...f, owner: e.target.value }))}
            className="px-3 py-2 rounded-lg text-sm outline-none"
            style={{ backgroundColor: 'var(--color-surface-hover)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
          >
            <option value="">All Owners</option>
            {Object.entries(OWNER_NAMES).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card>
        {filtered.length === 0 ? (
          <EmptyState icon={Target} title="No leads match your filters" description="Try adjusting your search or filters to see more results." />
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {filtered.map((lead) => (
              <LeadRow key={lead.id} lead={lead} expanded={expandedId === lead.id} onToggle={() => setExpandedId((id) => (id === lead.id ? null : lead.id))} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function LeadRow({ lead, expanded, onToggle }: { lead: Lead; expanded: boolean; onToggle: () => void }) {
  const ownerName = OWNER_NAMES[lead.leadOwner] ?? lead.leadOwner;

  return (
    <div>
      <button onClick={onToggle} className="w-full text-left p-4 flex items-center gap-3 hover:bg-white/[0.02] transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>
              {lead.company}
            </span>
            <StageBadge stage={lead.leadStage} />
            <PriorityBadge priority={lead.priority} />
          </div>
          <div className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
            {lead.poc} · {lead.designation} · {lead.location}
          </div>
        </div>
        <div className="hidden sm:block text-xs text-right flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
          <div>{ownerName}</div>
          <div style={{ color: 'var(--color-text-muted)' }}>{lead.leadSource}</div>
        </div>
        {expanded ? <ChevronUp size={16} style={{ color: 'var(--color-text-muted)' }} /> : <ChevronDown size={16} style={{ color: 'var(--color-text-muted)' }} />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3" style={{ backgroundColor: 'var(--color-surface-muted)' }}>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs pt-3" style={{ color: 'var(--color-text-secondary)' }}>
            <span className="flex items-center gap-1.5">
              <Mail size={12} style={{ color: 'var(--color-text-muted)' }} /> {lead.email}
            </span>
            <span className="flex items-center gap-1.5">
              <Phone size={12} style={{ color: 'var(--color-text-muted)' }} /> {lead.phone}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin size={12} style={{ color: 'var(--color-text-muted)' }} /> {lead.location}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DetailList title={`Activities (${lead.activities.length})`}>
              {lead.activities.map((a) => (
                <li key={a.id} className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {a.activityType}
                  </span>{' '}
                  — {a.comment}
                </li>
              ))}
            </DetailList>
            <DetailList title={`Follow-ups (${lead.followups.length})`}>
              {lead.followups.map((f) => (
                <li key={f.id} className="text-xs flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                  <PlainBadge tone={f.status === 'Overdue' ? 'danger' : f.status === 'Completed' ? 'success' : 'warning'}>{f.status}</PlainBadge>
                  {f.followupType} on {f.followupDate}
                </li>
              ))}
            </DetailList>
            <DetailList title={`Requirements (${lead.requirements.length})`}>
              {lead.requirements.map((r) => (
                <li key={r.id} className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    {r.title}
                  </span>{' '}
                  — {r.status}
                </li>
              ))}
            </DetailList>
            <DetailList title={`Deals (${lead.deals.length})`}>
              {lead.deals.map((d) => (
                <li key={d.id} className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                    ${d.value.toLocaleString()}
                  </span>{' '}
                  — {d.stage}
                </li>
              ))}
            </DetailList>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailList({ title, children }: { title: string; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
        {title}
      </div>
      {hasChildren ? <ul className="space-y-1">{children}</ul> : <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>None yet.</p>}
    </div>
  );
}
