'use client';

import { useMemo, useState } from 'react';
import { Building2, GraduationCap, Truck, Layers, Target, Database as DatabaseIcon } from 'lucide-react';
import { MOCK_CLIENTS, MOCK_TRAINERS, MOCK_VENDORS, MOCK_SERVICES, MOCK_LEADS_MASTER } from '@/lib/sales-crm/database-data';
import { getSchema, type CollectionType, type DatabaseRecord } from '@/lib/sales-crm/database-schema';
import { computeLinkedData } from '@/lib/sales-crm/database-utils';
import { Card } from '@/components/sales-crm/ui/Card';
import { PlainBadge } from '@/components/sales-crm/ui/Badge';
import { EmptyState } from '@/components/sales-crm/ui/EmptyState';

const TABS: { key: CollectionType; label: string; icon: typeof Building2; records: DatabaseRecord[] }[] = [
  { key: 'Clients', label: 'Clients', icon: Building2, records: MOCK_CLIENTS },
  { key: 'Trainers', label: 'Trainers', icon: GraduationCap, records: MOCK_TRAINERS },
  { key: 'Vendors', label: 'Vendors', icon: Truck, records: MOCK_VENDORS },
  { key: 'Service Lines', label: 'Service Lines', icon: Layers, records: MOCK_SERVICES },
  { key: 'Leads Master', label: 'Leads Master', icon: Target, records: MOCK_LEADS_MASTER },
];

// Columns kept per-record view compact: show the schema's required + first
// few optional fields rather than every field the intern schema defines,
// since Phase 1 mock rows only populate a handful of them.
const MAX_COLUMNS = 6;

export default function SalesCrmDatabase() {
  const [activeTab, setActiveTab] = useState<CollectionType>('Clients');

  const tab = TABS.find((t) => t.key === activeTab)!;
  const schema = useMemo(() => getSchema(activeTab), [activeTab]);
  const columns = useMemo(() => {
    const populatedFields = new Set<string>();
    tab.records.forEach((r) => Object.keys(r).forEach((k) => { if (r[k] !== undefined && r[k] !== '') populatedFields.add(k); }));
    return schema.filter((f) => populatedFields.has(f.name)).slice(0, MAX_COLUMNS);
  }, [schema, tab.records]);

  return (
    <div className="space-y-5">
      <Card className="p-2 flex flex-wrap gap-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = t.key === activeTab;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
              style={{
                backgroundColor: active ? 'var(--color-primary-soft)' : 'transparent',
                color: active ? 'var(--color-primary-text)' : 'var(--color-text-secondary)',
              }}
            >
              <Icon size={14} />
              {t.label}
              <span className="text-[10px]" style={{ color: active ? 'var(--color-primary-text)' : 'var(--color-text-muted)' }}>
                {t.records.length}
              </span>
            </button>
          );
        })}
      </Card>

      <Card>
        {tab.records.length === 0 ? (
          <EmptyState icon={DatabaseIcon} title={`No ${tab.label.toLowerCase()} yet`} description="Records added through Leads or Requirements will appear here once the backend is connected." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {columns.map((col) => (
                    <th key={col.name} className="text-left font-medium px-4 py-3" style={{ color: 'var(--color-text-muted)' }}>
                      {col.label}
                    </th>
                  ))}
                  <th className="text-left font-medium px-4 py-3" style={{ color: 'var(--color-text-muted)' }}>
                    Status
                  </th>
                  <th className="text-left font-medium px-4 py-3" style={{ color: 'var(--color-text-muted)' }}>
                    Linked Data
                  </th>
                </tr>
              </thead>
              <tbody>
                {tab.records.map((record, i) => (
                  <tr key={record.id ?? i} style={{ borderTop: i > 0 ? '1px solid var(--color-border)' : undefined }}>
                    {columns.map((col) => (
                      <td key={col.name} className="px-4 py-3" style={{ color: 'var(--color-text-secondary)' }}>
                        {String(record[col.name] ?? '—')}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      <PlainBadge tone={record.status === 'Active' ? 'success' : 'neutral'}>{String(record.status ?? 'Active')}</PlainBadge>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--color-text-muted)' }}>
                      {computeLinkedData(activeTab)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
