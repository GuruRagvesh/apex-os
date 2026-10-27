'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@apex/core-identity';
import { api, unwrap as r } from '@apex/shared-auth';
import { ExitTab } from './ExitPanel';
import { TransfersTab } from './TransferHistory';
import { TransferImpactModal } from './TransferImpactModal';
import { transitionsApi } from './transitions-api';

/**
 * Composed under the user detail screen at the ROUTE, because platforms/**
 * may not import frontend/**. HR and Admin get Transfers and Exit tabs; the
 * server still decides what each caller may read or do.
 */
export function UserTransitionsSection() {
  const { id } = useParams<{ id: string }>();
  const { user: me } = useAuthStore();
  const roleName = (me?.role as any)?.name ?? me?.role ?? '';
  const isAdmin = roleName === 'ADMIN' || roleName === 'SUPER_ADMIN';
  const isHR = Boolean((me as any)?.isHR);
  const [tab, setTab] = useState<'transfers' | 'exit'>(() => {
    if (typeof window === 'undefined') return 'exit';
    const t = new URLSearchParams(window.location.search).get('tab');
    return t === 'transfers' ? 'transfers' : 'exit';
  });
  const [transferring, setTransferring] = useState(false);
  const target = useQuery({ queryKey: ['user', id, 'transfer-target'], queryFn: () => r<any>(api.get(`/users/${id}`)), enabled: !!id && (isAdmin || isHR), retry: false });
  const restriction = useQuery({ queryKey: ['restriction', id], queryFn: () => transitionsApi.restriction(id), enabled: !!id && (isAdmin || isHR), retry: false });
  const caps = useQuery({ queryKey: ['transition-capabilities'], queryFn: transitionsApi.capabilities, enabled: isAdmin || isHR, retry: false, staleTime: 60_000 });

  if (!me || !(isAdmin || isHR) || !id) return null;
  const viewer = { id: me.id, isHR, isAdmin };
  const exitOn = caps.data?.exit.enabled === true;
  return (
    <section aria-label="Transfers and exit" className="apex-card mx-auto mt-6 w-full max-w-5xl space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Transfers and exit</h2>
        {restriction.data?.deletionRestricted && (
          <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: 'rgba(217,119,6,.15)' }}>Deletion is legally restricted</span>
        )}
      </div>
      <div role="tablist" aria-label="Transfers and exit" className="flex gap-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        {([['transfers', 'Transfers'], ['exit', 'Exit']] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} id={`tx-tab-${k}`} aria-controls={`tx-panel-${k}`} onClick={() => setTab(k)}
            className="px-3 pb-2 text-sm font-medium" style={{ borderBottom: tab === k ? '2px solid var(--accent)' : '2px solid transparent', color: tab === k ? 'var(--accent)' : 'var(--text-secondary)' }}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`tx-panel-${tab}`} aria-labelledby={`tx-tab-${tab}`}>
        {tab === 'transfers' && <TransfersTab userId={id} isAdmin={isAdmin} onTransfer={target.data ? () => setTransferring(true) : undefined} />}
        {tab === 'exit' && (exitOn || caps.isLoading
          ? <ExitTab userId={id} viewer={viewer} />
          : <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Resignation and exit are not enabled on this server yet.</p>)}
      </div>
      {transferring && target.data && (
        <TransferImpactModal user={{ id, name: target.data.name, departmentId: target.data.departmentId, roleId: target.data.roleId }} onClose={() => setTransferring(false)} />
      )}
    </section>
  );
}
