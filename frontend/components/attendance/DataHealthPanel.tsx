'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  badgeText,
  displayCount,
  getDataHealth,
  HISTORICAL_RECOVERY_UNAVAILABLE,
  HISTORICAL_RECOVERY_UPLOAD_PENDING,
  vaultStatusLine,
  statusText,
  type DataHealth,
  type HealthTone,
} from './data-health';

/**
 * Attendance Data Health — Phase 2A. READ-ONLY.
 *
 * Shows only what GET /attendance/data-manager/health reports. There is no
 * action here that recovers, reconciles, mirrors or syncs anything: those
 * controls appear disabled, labelled for the phase that will enable them.
 * Visibility is a convenience; the server refuses anyone without company-wide
 * attendance authority.
 */

const TONE: Record<HealthTone, string> = {
  positive: 'text-emerald-700 dark:text-emerald-300',
  info: 'text-sky-700 dark:text-sky-300',
  warn: 'text-amber-800 dark:text-amber-300',
  danger: 'text-red-700 dark:text-red-400',
  muted: 'apex-text-muted',
};
const DOT: Record<HealthTone, string> = {
  positive: 'bg-emerald-500',
  info: 'bg-sky-500',
  warn: 'bg-amber-500',
  danger: 'bg-red-500',
  muted: 'bg-[var(--border-secondary)]',
};

function useDataHealth(enabled: boolean) {
  return useQuery({
    queryKey: ['attendance-data-health'],
    queryFn: getDataHealth,
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

/** Beside "Import / Update Data". Renders nothing unless the server answered. */
export function DataHealthBadge({ enabled }: { enabled: boolean }) {
  const { data } = useDataHealth(enabled);
  if (!enabled || !data) return null;
  const tone = statusText(data.overall).tone;
  return (
    <Link
      href="/attendance/import?view=health"
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-secondary)] px-2.5 py-1 text-xs"
      aria-label={`Data health: ${badgeText(data)}`}
    >
      <span className="apex-text-subtle text-[10px] font-semibold uppercase tracking-wide">Data health</span>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />
      <span className={TONE[tone]}>{badgeText(data)}</span>
    </Link>
  );
}

function Row({ name, status, detail }: { name: string; status: string; detail?: string }) {
  const s = statusText(status);
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border-secondary)] py-2 last:border-b-0">
      <span className="apex-text text-sm">{name}</span>
      <span className="text-right">
        <span className={`text-sm font-medium ${TONE[s.tone]}`}>{s.label}</span>
        {detail && <span className="apex-text-muted block text-xs">{detail}</span>}
      </span>
    </div>
  );
}

function Panel({ data }: { data: DataHealth }) {
  return (
    <div className="space-y-3">
      <div className="apex-card">
        <p className="apex-text text-sm font-semibold">Attendance Data Health</p>
        <p className="apex-text-muted mt-1 text-xs">
          What Apex OS can verify right now. Recovery tooling is being introduced in stages, so
          most of it is switched off.
        </p>
        <div className="mt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border-secondary)] py-2">
            <span className="apex-text text-sm">Operational database</span>
            <span className={`text-sm font-medium ${data.operationalAttendance === 'AVAILABLE' ? TONE.positive : TONE.danger}`}>
              {data.operationalAttendance === 'AVAILABLE' ? 'Available' : 'Unavailable'}
            </span>
          </div>
          <Row name="Attendance recovery" status={data.recovery.status} />
          <Row name="Recovery vault" status={data.recoveryVault.status} detail={data.recoveryVault.note} />
          <Row name="Mirror to recovery vault" status={data.mirror.status} />
          <Row name="Reconciliation" status={data.reconciliation.status} detail={data.reconciliation.lastRunAt ? undefined : 'Has never run'} />
          <Row name="Auto repair" status={data.autoRepair.status} />
          <div className="flex flex-wrap items-baseline justify-between gap-2 py-2">
            <span className="apex-text text-sm">Existing database backup</span>
            <span className="apex-text-muted text-right text-xs">{data.existingDatabaseBackup.note}</span>
          </div>
        </div>
      </div>

      <div className="apex-card">
        <p className="apex-text text-sm font-semibold">Counts</p>
        <p className="apex-text-muted mt-1 text-xs">A dash means nothing has measured it yet — not zero.</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
          {[
            ['Only in database', data.counts.productionOnly],
            ['Only in recovery', data.counts.recoveryOnly],
            ['Conflicts', data.counts.conflicts],
            ['Missing references', data.counts.missingReferences],
            ['Failed imports', data.counts.failedImports],
          ].map(([label, value]) => (
            <div key={label as string}>
              <dt className="apex-text-subtle text-[11px] uppercase tracking-wide">{label}</dt>
              <dd className="apex-text font-medium tabular-nums">{displayCount(value as number | null)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled className="apex-btn-secondary cursor-not-allowed opacity-60" title="Available once reconciliation is enabled">
          Run reconciliation — not available yet
        </button>
        <button type="button" disabled className="apex-btn-secondary cursor-not-allowed opacity-60" title="Available once reconciliation is enabled">
          View issues — not available yet
        </button>
      </div>
    </div>
  );
}

export function DataHealthSection() {
  const { data, isLoading, isError } = useDataHealth(true);
  if (isLoading) return <p className="apex-text-muted text-sm">Checking data health…</p>;
  if (isError || !data) {
    return (
      <div role="alert" className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
        <p className="text-xs text-amber-800 dark:text-amber-300">
          Data health could not be loaded. Attendance itself is unaffected.
        </p>
      </div>
    );
  }
  return <Panel data={data} />;
}

/**
 * Visible so HR knows it is coming. The status line follows the vault's real
 * state; the upload button stays disabled in every state until the recovery
 * upload phase -- a ready vault is not, by itself, permission to upload.
 */
export function HistoricalRecoverySection() {
  const { data } = useDataHealth(true);
  const vaultStatus = data?.recoveryVault.status;
  return (
    <div className="apex-card">
      <p className="apex-text text-sm font-semibold">Apex Historical Recovery</p>
      <p className="apex-text-muted mt-1 text-sm">
        Restores attendance that is missing from Apex OS from a verified Apex recovery file. Only
        days that are missing are ever proposed; existing attendance is never overwritten.
      </p>
      <p className="apex-text mt-3 text-sm">
        Status: <span className="apex-text-muted">{vaultStatusLine(vaultStatus)}</span>
      </p>
      <button type="button" disabled className="apex-btn-secondary mt-3 cursor-not-allowed opacity-60" aria-describedby="historical-recovery-help">
        Upload recovery file
      </button>
      <p id="historical-recovery-help" className="apex-text-muted mt-2 text-xs">
        {vaultStatus === 'HEALTHY' || vaultStatus === 'DISABLED' ? HISTORICAL_RECOVERY_UPLOAD_PENDING : HISTORICAL_RECOVERY_UNAVAILABLE}
      </p>
    </div>
  );
}
