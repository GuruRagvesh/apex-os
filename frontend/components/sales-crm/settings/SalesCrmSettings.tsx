'use client';

import { Check, X, Users, ShieldCheck, Workflow } from 'lucide-react';
import { MOCK_USERS, ROLE_LABELS } from '@/lib/sales-crm/constants';
import { Role } from '@/lib/sales-crm/types';
import * as permissions from '@/lib/sales-crm/permissions';
import { Card } from '@/components/sales-crm/ui/Card';
import { PlainBadge } from '@/components/sales-crm/ui/Badge';

const ALL_ROLES = [Role.SUPERADMIN, Role.ADMIN, Role.MANAGER, Role.TL, Role.EMPLOYEE];

// Only role-only permission checks are shown here (no record/owner context
// available in a static settings view) — computed live from the real
// permissions module, not hardcoded.
const PERMISSION_CHECKS: { label: string; check: (role: Role) => boolean }[] = [
  { label: 'Import records', check: permissions.canImport },
  { label: 'Export records', check: permissions.canExport },
  { label: 'Add records', check: permissions.canAddRecord },
  { label: 'Delete records', check: permissions.canDeleteRecord },
  { label: 'Add deals', check: permissions.canAddDeal },
  { label: 'Delete deals', check: permissions.canDeleteDeal },
  { label: 'Export deals', check: permissions.canExportDeals },
  { label: 'Manage custom activity tabs', check: permissions.canManageActivityTabs },
];

const PIPELINE_STAGES = ['Created', 'Cold', 'Level 0', 'Level 0(A)', 'Level 1', 'Level 1(A)', 'Level 2', 'Level 3', 'Level 4', 'Level 4(A)', 'Level 5', 'Level 6', 'Closed', 'Invalid', 'Hold'];

export default function SalesCrmSettings() {
  return (
    <div className="space-y-5">
      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
          <Users size={14} style={{ color: 'var(--color-text-muted)' }} />
          Team
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>
          Reference reps used to attribute demo leads and deals. User management will connect to Apex OS's real user
          directory once the backend is wired up.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th className="text-left font-medium px-3 py-2" style={{ color: 'var(--color-text-muted)' }}>Name</th>
                <th className="text-left font-medium px-3 py-2" style={{ color: 'var(--color-text-muted)' }}>Email</th>
                <th className="text-left font-medium px-3 py-2" style={{ color: 'var(--color-text-muted)' }}>Role</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_USERS.map((u, i) => (
                <tr key={u.id} style={{ borderTop: i > 0 ? '1px solid var(--color-border)' : undefined }}>
                  <td className="px-3 py-2.5" style={{ color: 'var(--color-text-primary)' }}>{u.name}</td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--color-text-secondary)' }}>{u.email}</td>
                  <td className="px-3 py-2.5">
                    <PlainBadge tone="primary">{ROLE_LABELS[u.role]}</PlainBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
          <ShieldCheck size={14} style={{ color: 'var(--color-text-muted)' }} />
          Role Permissions
        </h2>
        <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>
          Computed live from the Sales CRM permission engine — not a static table.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th className="text-left font-medium px-3 py-2" style={{ color: 'var(--color-text-muted)' }}>Action</th>
                {ALL_ROLES.map((role) => (
                  <th key={role} className="text-center font-medium px-3 py-2" style={{ color: 'var(--color-text-muted)' }}>
                    {ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_CHECKS.map((p, i) => (
                <tr key={p.label} style={{ borderTop: i > 0 ? '1px solid var(--color-border)' : undefined }}>
                  <td className="px-3 py-2.5" style={{ color: 'var(--color-text-primary)' }}>{p.label}</td>
                  {ALL_ROLES.map((role) => (
                    <td key={role} className="text-center px-3 py-2.5">
                      {p.check(role) ? (
                        <Check size={14} className="inline" style={{ color: 'var(--color-success)' }} />
                      ) : (
                        <X size={14} className="inline" style={{ color: 'var(--color-text-muted)' }} />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
          <Workflow size={14} style={{ color: 'var(--color-text-muted)' }} />
          Pipeline Stages
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {PIPELINE_STAGES.map((stage) => (
            <PlainBadge key={stage} tone="neutral">{stage}</PlainBadge>
          ))}
        </div>
      </Card>
    </div>
  );
}
