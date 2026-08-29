'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, Mail } from 'lucide-react';
import {
  STATUS_LABEL,
  finalizeMonth,
  getFinanceRecipient,
  getMonthClose,
  getPayrollPreview,
  downloadPayrollWorkbook,
  previousMonth,
  sendToFinance,
  setFinanceRecipient,
} from './payroll-api';

/**
 * HR's monthly attendance close.
 *
 * Two deliberate actions, never one: finalize accepts the month as the payroll
 * input, send delivers it. Nothing here happens because a calendar month ended.
 *
 * The unresolved count is shown before finalizing and phrased as a decision
 * rather than a warning to dismiss. Company policy may legitimately accept
 * unresolved days — what must not happen is finalizing without seeing them.
 */
export function PayrollMonthClose() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(previousMonth());
  const [confirming, setConfirming] = useState<'finalize' | 'send' | null>(null);
  const [recipientDraft, setRecipientDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery({
    queryKey: ['payroll-preview', month],
    queryFn: () => getPayrollPreview(month),
    retry: false,
  });
  const close = useQuery({
    queryKey: ['payroll-close', month],
    queryFn: () => getMonthClose(month),
    retry: false,
  });
  const recipient = useQuery({
    queryKey: ['payroll-recipient'],
    queryFn: getFinanceRecipient,
    retry: false,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['payroll-preview', month] });
    queryClient.invalidateQueries({ queryKey: ['payroll-close', month] });
  };

  const act = useMutation({
    mutationFn: (what: 'finalize' | 'send') =>
      what === 'finalize' ? finalizeMonth(month) : sendToFinance(month),
    onSuccess: () => {
      setError(null);
      setConfirming(null);
      refresh();
    },
    onError: (err: any) => {
      setConfirming(null);
      setError(err?.response?.data?.message ?? 'The action could not be completed.');
    },
  });

  const saveRecipient = useMutation({
    mutationFn: () => setFinanceRecipient(recipientDraft.trim()),
    onSuccess: () => {
      setRecipientDraft('');
      queryClient.invalidateQueries({ queryKey: ['payroll-recipient'] });
    },
    onError: (err: any) => setError(err?.response?.data?.message ?? 'That address was not accepted.'),
  });

  const status = close.data?.status ?? preview.data?.status ?? 'OPEN';
  const totals = preview.data?.totals;
  const unresolved = totals?.employeesWithUnresolved ?? 0;
  const finalized = status === 'FINALIZED' || status === 'SENT';

  return (
    <div className="space-y-4">
      <div className="apex-card">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="apex-text text-base font-semibold">Monthly attendance for payroll</h2>
            <p className="apex-text-muted mt-0.5 text-xs">
              Attendance facts for Finance. No salary or deduction is calculated here.
            </p>
          </div>
          <div>
            <label className="apex-text-subtle mb-1 block text-[11px] uppercase tracking-wide">
              Month
            </label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="apex-input text-sm"
            />
          </div>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <span
            className={`rounded-md px-2 py-1 text-xs font-medium ${
              status === 'SENT'
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : status === 'FINALIZED'
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : 'apex-text-muted border border-[var(--border-secondary)]'
            }`}
          >
            {STATUS_LABEL[status]}
          </span>
          {preview.isLoading && <span className="apex-text-subtle text-xs">Preparing…</span>}
        </div>

        {totals && (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label="Employees" value={String(totals.employees)} />
            <Fact label="Unresolved days" value={String(totals.unresolvedDays)} />
            <Fact
              label="Employees affected"
              value={String(unresolved)}
              tone={unresolved > 0 ? 'warn' : 'normal'}
            />
            <Fact label="Manual recovery days" value={String(totals.manualRecoveryDays)} />
          </dl>
        )}

        {unresolved > 0 && !finalized && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            <AlertTriangle size={14} className="mt-px shrink-0" />
            <span>
              {unresolved} employee{unresolved === 1 ? '' : 's'} still {unresolved === 1 ? 'has' : 'have'}{' '}
              attendance nobody has resolved. Those rows are not a settled result. Decide how they
              are handled before finalizing — finalizing does not resolve them.
            </span>
          </p>
        )}

        {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => void downloadPayrollWorkbook(month).catch(() => setError('The workbook could not be downloaded.'))}
            className="apex-text-muted inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-secondary)] px-3 py-1.5 text-sm"
          >
            <Download size={14} /> Download XLSX
          </button>

          {!finalized && (
            <button
              onClick={() => setConfirming('finalize')}
              disabled={act.isPending || !preview.data}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--text-inverse)] disabled:opacity-50"
            >
              Finalize month
            </button>
          )}

          {finalized && status !== 'SENT' && (
            <button
              onClick={() => setConfirming('send')}
              disabled={act.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--text-inverse)] disabled:opacity-50"
            >
              <Mail size={14} /> Send to Finance
            </button>
          )}

          {close.data?.deliveryStatus === 'FAILED' && status !== 'SENT' && (
            <button
              onClick={() => setConfirming('send')}
              disabled={act.isPending}
              className="rounded-lg border border-[var(--border-secondary)] px-3 py-1.5 text-sm apex-text"
            >
              Retry send
            </button>
          )}
        </div>
      </div>

      {/* What was actually sent, kept visible after the fact. */}
      {close.data && (status === 'FINALIZED' || status === 'SENT') && (
        <div className="apex-card">
          <h3 className="apex-text mb-2 text-sm font-semibold">Close record</h3>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Fact label="Finalized by" value={close.data.finalizedBy?.name ?? '—'} />
            <Fact
              label="Finalized at"
              value={close.data.finalizedAt ? new Date(close.data.finalizedAt).toLocaleString() : '—'}
            />
            <Fact label="Employees" value={String(close.data.employeeCount ?? '—')} />
            <Fact label="Sent to" value={close.data.recipientEmail ?? 'Not sent'} />
            <Fact
              label="Sent at"
              value={close.data.sentAt ? new Date(close.data.sentAt).toLocaleString() : '—'}
            />
            <Fact
              label="Delivery"
              value={close.data.deliveryStatus ?? '—'}
              tone={close.data.deliveryStatus === 'FAILED' ? 'warn' : 'normal'}
            />
          </dl>
          {close.data.reportSha256 && (
            <p className="apex-text-subtle mt-3 break-all text-[11px]">
              Report reference: {close.data.reportSha256.slice(0, 16)}…
              {close.data.reportByteSize ? ` · ${close.data.reportByteSize} bytes` : ''}
            </p>
          )}
        </div>
      )}

      <div className="apex-card">
        <h3 className="apex-text mb-2 text-sm font-semibold">Finance recipient</h3>
        <p className="apex-text-muted mb-2 text-xs">
          The finalized report is emailed here. Changing it does not affect months already sent.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="apex-text text-sm font-medium">
            {recipient.data?.recipient ?? 'Not configured'}
          </span>
        </div>
        <div className="mt-2 flex gap-2">
          <input
            type="email"
            value={recipientDraft}
            onChange={(e) => setRecipientDraft(e.target.value)}
            placeholder="finance@company.com"
            className="apex-input flex-1 text-sm"
          />
          <button
            onClick={() => saveRecipient.mutate()}
            disabled={saveRecipient.isPending || recipientDraft.trim().length === 0}
            className="apex-text rounded-lg border border-[var(--border-secondary)] px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          kind={confirming}
          month={month}
          unresolved={unresolved}
          recipient={recipient.data?.recipient ?? null}
          pending={act.isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => act.mutate(confirming)}
        />
      )}
    </div>
  );
}

/**
 * The checkpoint before either irreversible-ish action.
 *
 * Finalizing decides what Finance is told; sending puts it in somebody's inbox.
 * Neither should be one click away from a month selector.
 */
function ConfirmDialog({
  kind,
  month,
  unresolved,
  recipient,
  pending,
  onCancel,
  onConfirm,
}: {
  kind: 'finalize' | 'send';
  month: string;
  unresolved: number;
  recipient: string | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const blockedSend = kind === 'send' && !recipient;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900">
        <h3 className="apex-text text-base font-semibold">
          {kind === 'finalize' ? 'Finalize this month?' : 'Send to Finance?'}
        </h3>

        <dl className="mt-3 grid grid-cols-2 gap-3">
          <Fact label="Month" value={month} />
          {kind === 'send' && <Fact label="Recipient" value={recipient ?? 'Not configured'} />}
          {kind === 'finalize' && <Fact label="Unresolved employees" value={String(unresolved)} />}
        </dl>

        <p className="apex-text-muted mt-3 text-xs">
          {kind === 'finalize'
            ? 'This accepts the month as the payroll input. Reopening a finalized month is not supported, so resolve anything outstanding first.'
            : 'This emails the finalized report as an attachment. It cannot be unsent.'}
        </p>

        {blockedSend && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">
            Configure a Finance recipient before sending.
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={pending}
            className="apex-text-muted rounded-lg border border-[var(--border-secondary)] px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={pending || blockedSend}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--text-inverse)] disabled:opacity-50"
          >
            {pending ? 'Working…' : kind === 'finalize' ? 'Finalize' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  tone = 'normal',
}: {
  label: string;
  value: string;
  tone?: 'normal' | 'warn';
}) {
  return (
    <div>
      <dt className="apex-text-subtle text-[11px] uppercase tracking-wide">{label}</dt>
      <dd
        className={`mt-0.5 text-sm font-medium ${
          tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'apex-text'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
