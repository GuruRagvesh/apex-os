'use client';

// shared/remediation — the remediation dialog (Phase 1, spec §11.2).
//
// Rendered as a sibling layer: the caller's form or modal stays mounted, so
// its values survive. The dialog never talks HTTP itself; every server action
// goes through the `runAction` prop, and the content is replaced by whatever
// fresh result the server returns.

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useRouter } from 'next/navigation';
import { AlertOctagon, AlertTriangle, Copy, Info, RefreshCw, Wrench, X } from 'lucide-react';
import {
  NAVIGATE_ROUTES,
  NEW_TAB_NAVIGATION,
  RemediationAction,
  RemediationResult,
  SETTINGS_ROUTES,
  diagnosticText,
  displayableDetails,
  scopeLabel,
  severityBadge,
  visibleActions,
} from '../shared/remediation-contract';

const COMPANY_TIMEZONE = 'Asia/Kolkata';

export interface RemediationDialogProps {
  result: RemediationResult | null;
  open: boolean;
  onClose: () => void;
  /** Runs a server action (retry, safe repair) and returns the fresh server result. */
  runAction?: (action: RemediationAction, result: RemediationResult) => Promise<RemediationResult | void>;
  /** Called with each fresh result, so the caller can keep its own copy in step. */
  onResult?: (result: RemediationResult) => void;
  /** Where focus returns on close: the control that triggered the failing submit. */
  returnFocusTo?: HTMLElement | null;
}

function formatCompanyTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${new Intl.DateTimeFormat('en-IN', { timeZone: COMPANY_TIMEZONE, dateStyle: 'medium', timeStyle: 'short' }).format(d)} IST`;
}

function SeverityIcon({ icon }: { icon: 'info' | 'warning' | 'blocking' }) {
  if (icon === 'info') return <Info size={14} aria-hidden="true" />;
  if (icon === 'warning') return <AlertTriangle size={14} aria-hidden="true" />;
  return <AlertOctagon size={14} aria-hidden="true" />;
}

const DETAIL_LABELS: Record<string, string> = {
  otherBlockers: 'Also blocking',
  holdStatus: 'Hold status',
  retentionResult: 'Retention result',
  pendingItems: 'Files still pending',
  retentionCategories: 'Records covered',
  eligibleOn: 'Eligible for deletion on',
  field: 'Field to change',
  keyConfigurationIssues: 'Backend configuration needed',
  folderPath: 'Archive folder',
  privacyIssue: 'Problem found',
};

const CODE_LABELS: Record<string, string> = {
  LEGAL_HOLD_ACTIVE: 'Legal hold active',
  LEGAL_HOLD_REQUESTED: 'Awaiting hold review',
  LIFECYCLE_KEYS_MISSING: 'Deletion keys not configured',
  RETENTION_POLICY_NOT_CONFIGURED: 'Record retention',
  OPERATION_IN_PROGRESS: 'Another operation running',
  ACTIVE: 'Active',
  REQUESTED: 'Awaiting hold review',
  LEGACY_ACTIVE: 'Active (recorded before hold states)',
  LIFECYCLE_HANDLE_ENCRYPTION_KEY: 'LIFECYCLE_HANDLE_ENCRYPTION_KEY is missing or invalid',
  LIFECYCLE_HANDLE_HMAC_KEY: 'LIFECYCLE_HANDLE_HMAC_KEY is missing or invalid',
  LIFECYCLE_HANDLE_KEYS_MUST_DIFFER: 'The encryption and HMAC keys must be different',
  ATTENDANCE: 'Attendance records',
  LEAVE: 'Leave records',
  PAYROLL: 'Closed payroll months',
  RETENTION_PERIOD_ACTIVE: 'Approved retention period',
  ARCHIVE_PRIVACY_FAILED: 'Archive sharing problem',
  ARCHIVE_SNAPSHOT_MISSING: 'No verified archive',
  ARCHIVE_SNAPSHOT_STALE: 'Archive out of date',
  ROOT_MISSING_OR_INVALID: 'Archive root missing or invalid',
  ENVIRONMENT_FOLDER_MISSING: 'Environment folder not initialized',
  FOLDER_MISSING: 'Folder missing',
  DUPLICATE_FOLDER: 'Duplicate folder',
  WRONG_LABEL: 'Wrong folder label',
  TRASHED_OR_NOT_FOLDER: 'Trashed or not a folder',
  SHARED_DRIVE: 'In a Shared Drive',
  PUBLIC_LINK: 'Shared publicly or by link',
  DOMAIN_SHARE: 'Shared with a domain',
  GROUP_SHARE: 'Shared with a group',
  EXTRA_USER: 'Shared with another user',
  WRONG_OWNER: 'Not owned by the archive account',
  UPLOADED_FILE_NOT_PRIVATE: 'Uploaded file not private',
  roleId: 'Role',
  departmentId: 'Department',
};

function detailText(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => CODE_LABELS[String(v)] ?? String(v)).join(', ');
  return CODE_LABELS[String(value)] ?? String(value);
}

export function RemediationDialog({ result, open, onClose, runAction, onResult, returnFocusTo }: RemediationDialogProps) {
  const router = useRouter();
  const [current, setCurrent] = useState<RemediationResult | null>(result);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<RemediationAction | null>(null);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastSeen, setLastSeen] = useState<RemediationResult | null>(result);

  // A new payload from the caller replaces what is shown.
  if (result !== lastSeen) {
    setLastSeen(result);
    setCurrent(result);
    setConfirming(null);
    setActionError(null);
  }

  if (!current) return null;
  const r = current;
  const badge = severityBadge(r.severity);
  const actions = visibleActions(r);
  const details = displayableDetails(r);

  const run = async (action: RemediationAction) => {
    if (!runAction) return;
    setBusy(action.id);
    setActionError(null);
    try {
      const fresh = await runAction(action, r);
      if (fresh) {
        setCurrent(fresh);
        onResult?.(fresh);
        if (fresh.status === 'RESOLVED') onClose();
      }
    } catch (err: any) {
      // A server answer that is itself a remediation replaces the content.
      if (err && err.error === 'REMEDIATION' && err.remediation) {
        setCurrent(err.remediation);
        onResult?.(err.remediation);
      } else {
        setActionError('The check could not be completed. Nothing was changed.');
      }
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  };

  const onAction = async (action: RemediationAction) => {
    if (action.kind === 'NAVIGATE') {
      const path = NAVIGATE_ROUTES[action.id]?.(r);
      if (path && NEW_TAB_NAVIGATION.includes(action.id)) {
        window.open(path, '_blank', 'noopener,noreferrer');
        return;
      }
      if (path) {
        onClose();
        router.push(path);
      }
      return;
    }
    if (action.kind === 'FORM_FIX') {
      // The form that raised the error applies the fix (clear a stale choice,
      // or resubmit without a department); nothing it holds is lost.
      onClose();
      try {
        await runAction?.(action, r);
      } catch {
        /* the form reports its own errors */
      }
      return;
    }
    if (action.kind === 'OPEN_CONFIGURATION') {
      const path = SETTINGS_ROUTES[action.id];
      if (path) {
        onClose();
        router.push(path);
      }
      return;
    }
    if (action.kind === 'COPY_DIAGNOSTIC') {
      try {
        await navigator.clipboard.writeText(diagnosticText(r));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        setActionError('Copy is not available in this browser.');
      }
      return;
    }
    if (action.kind === 'SAFE_REPAIR') {
      setConfirming(action);
      return;
    }
    if (action.kind === 'OPEN_ARCHIVE_FOLDER') {
      // The runner asks the server for the folder link and opens it; the
      // dialog stays open so the person can retry verification afterwards.
      try {
        await runAction?.(action, r);
      } catch {
        setActionError('The archive folder could not be opened.');
      }
      return;
    }
    await run(action);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/40" data-testid="remediation-overlay" />
        <Dialog.Content
          data-testid="remediation-dialog"
          data-remediation-code={r.code}
          aria-describedby="remediation-problem"
          className="fixed left-1/2 top-1/2 z-[91] -translate-x-1/2 -translate-y-1/2 rounded-xl shadow-xl flex flex-col"
          style={{ width: 'min(32rem, calc(100vw - 2rem))', maxHeight: '85vh', backgroundColor: 'var(--bg-primary, #fff)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
          // Keys pressed here must not reach the caller's own modal handlers (React
          // events bubble through portals), so Escape closes only this layer.
          onKeyDown={(e) => e.stopPropagation()}
          onCloseAutoFocus={(e) => {
            if (returnFocusTo && document.contains(returnFocusTo)) {
              e.preventDefault();
              returnFocusTo.focus();
            }
          }}
        >
          <div className="flex items-start gap-3 px-5 pt-5 pb-3">
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-base font-semibold break-words">{r.title || 'Action needed'}</Dialog.Title>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span
                  data-testid="remediation-severity"
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium"
                  style={{ border: '1px solid currentColor', color: r.severity === 'BLOCKING' ? 'var(--danger, #b91c1c)' : r.severity === 'WARNING' ? 'var(--warning, #b45309)' : 'var(--text-secondary)' }}
                >
                  <SeverityIcon icon={badge.icon} />
                  {badge.text}
                </span>
                <span style={{ color: 'var(--text-secondary)' }} data-testid="remediation-scope">Affects: {scopeLabel(r.blockingScope)}</span>
              </div>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="rounded p-1" style={{ color: 'var(--text-tertiary)' }}>
                <X size={16} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <div className="px-5 pb-4 overflow-y-auto min-h-0 flex-1 space-y-4 text-sm break-words">
            <section>
              <h4 className="font-medium mb-1">What happened</h4>
              <p id="remediation-problem" style={{ color: 'var(--text-secondary)' }}>{r.problem}</p>
            </section>
            {r.whyItMatters && (
              <section>
                <h4 className="font-medium mb-1">Why it matters</h4>
                <p style={{ color: 'var(--text-secondary)' }}>{r.whyItMatters}</p>
              </section>
            )}
            {r.correctionSteps.length > 0 && (
              <section>
                <h4 className="font-medium mb-1">How to fix it</h4>
                <ol className="list-decimal pl-5 space-y-1" style={{ color: 'var(--text-secondary)' }}>
                  {r.correctionSteps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </section>
            )}
            {details.length > 0 && (
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs" data-testid="remediation-details">
                {details.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt style={{ color: 'var(--text-tertiary)' }}>{DETAIL_LABELS[k] ?? k}</dt>
                    <dd data-detail={k}>{detailText(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {confirming && (
              <div role="group" aria-label="Confirm repair" className="rounded-lg p-3 text-sm" style={{ border: '1px solid var(--border-subtle)' }} data-testid="remediation-confirm">
                <p className="mb-2">
                  {typeof confirming.previewCount === 'number'
                    ? `This will retry ${confirming.previewCount} pending item${confirming.previewCount === 1 ? '' : 's'}. Continue?`
                    : 'This will run the safe repair. Continue?'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="apex-btn-primary px-3 py-1.5 text-sm" onClick={() => run(confirming)} disabled={!!busy}>Confirm repair</button>
                  <button type="button" className="apex-btn apex-btn-secondary px-3 py-1.5 text-sm" onClick={() => setConfirming(null)}>Cancel</button>
                </div>
              </div>
            )}
            {actionError && <p role="alert" className="text-sm" style={{ color: 'var(--danger, #b91c1c)' }}>{actionError}</p>}
          </div>

          <div className="px-5 py-3 border-t flex flex-wrap items-center gap-2" style={{ borderColor: 'var(--border-subtle)' }} data-testid="remediation-actions">
            {actions.map((a) => (
              <button
                key={a.id}
                type="button"
                data-action={a.id}
                onClick={() => onAction(a)}
                disabled={!!busy}
                className={a.kind === 'RETRY_VERIFICATION' || a.kind === 'SAFE_REPAIR' ? 'apex-btn-primary px-3 py-1.5 text-sm inline-flex items-center gap-1.5' : 'apex-btn apex-btn-secondary px-3 py-1.5 text-sm inline-flex items-center gap-1.5'}
              >
                {a.kind === 'RETRY_VERIFICATION' && <RefreshCw size={14} aria-hidden="true" className={busy === a.id ? 'animate-spin' : ''} />}
                {a.kind === 'SAFE_REPAIR' && <Wrench size={14} aria-hidden="true" />}
                {a.kind === 'COPY_DIAGNOSTIC' && <Copy size={14} aria-hidden="true" />}
                {a.kind === 'COPY_DIAGNOSTIC' && copied ? 'Copied' : a.label}
              </button>
            ))}
            <Dialog.Close asChild>
              <button type="button" data-action="CLOSE" className="apex-btn apex-btn-secondary px-3 py-1.5 text-sm ml-auto">Close</button>
            </Dialog.Close>
          </div>

          <div className="px-5 pb-4 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {r.lastCheckedAt && <span data-testid="remediation-checked">Last checked {formatCompanyTime(r.lastCheckedAt)}</span>}
            {r.operationId && (
              <span className="rounded px-1.5 py-0.5 font-mono break-all" style={{ border: '1px solid var(--border-subtle)' }} data-testid="remediation-operation">
                Operation {r.operationId}
              </span>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
