'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@apex/core-identity';
import { ImportRowTable } from './ImportRowTable';
import {
  applyBatch,
  approveBatch,
  downloadErrorWorkbook,
  downloadTemplate,
  getBatch,
  getRows,
  listBatches,
  rePreviewBatch,
  resumeBatch,
  uploadImport,
  type ApplySummary,
  type ImportBatch,
} from './import-api';
import {
  BATCH_STATUS,
  MODE,
  ROW_FILTERS,
  WIZARD_STEPS,
  canApprove,
  canPrepare,
  describeError,
  filterRows,
  formatBytes,
  isAllMatch,
  isBatchBusy,
  rejectFileReason,
  resultHeadline,
  resultLines,
  serverClassificationFilter,
  stepForStatus,
  summaryCards,
  type BatchStatus,
  type ImportMode,
  type RowFilter,
  type Tone,
} from './import-presentation';

/**
 * Attendance Data Control workspace.
 *
 * Reached from the Attendance console by an explicit action rather than by a
 * third permanent tab: this is occasional, deliberate work, and the console is
 * for the two questions HR asks daily.
 *
 * The screen is a thin shell over the server. It never classifies a row, never
 * decides whether a batch may be approved, and never resets a row locally —
 * those are the server's, and duplicating any of them here would create a
 * second implementation that eventually disagrees with the one that writes.
 *
 * Every control that could change attendance says whether attendance has been
 * changed yet. That sentence is the point of the whole screen.
 */

const TONE_TEXT: Record<Tone, string> = {
  positive: 'text-emerald-700 dark:text-emerald-300',
  info: 'text-sky-700 dark:text-sky-300',
  neutral: 'apex-text',
  warn: 'text-amber-800 dark:text-amber-300',
  danger: 'text-red-700 dark:text-red-400',
  muted: 'apex-text-muted',
};

type Section = 'HOME' | 'BULK' | 'RECOVERY' | 'HISTORY';

export function ImportWorkspace() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [section, setSection] = useState<Section>('HOME');
  const [batchId, setBatchId] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>('CURRENT_CORRECTION');
  const [file, setFile] = useState<File | null>(null);
  const [filter, setFilter] = useState<RowFilter>('ALL');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplySummary | null>(null);
  const [confirming, setConfirming] = useState<'APPROVE' | 'APPLY' | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Convenience only. The server authorises every call regardless of what is
  // rendered, and a hidden button has never been a permission check.
  const mayPrepare = canPrepare(user as any);
  const mayApprove = canApprove(user as any);

  const { data: batch } = useQuery({
    queryKey: ['import-batch', batchId],
    queryFn: () => getBatch(batchId!),
    enabled: !!batchId,
    // A batch that is mid-apply is doing work on the server; ask again until
    // it stops. No fabricated percentage -- just "still going".
    refetchInterval: (q) => (isBatchBusy((q.state.data as ImportBatch)?.status ?? '') ? 2000 : false),
  });

  const serverFilter = serverClassificationFilter(filter);
  const { data: rows = [] } = useQuery({
    queryKey: ['import-rows', batchId, serverFilter ?? 'ALL'],
    queryFn: () => getRows(batchId!, serverFilter),
    enabled: !!batchId && section === 'BULK',
  });

  const { data: history = [] } = useQuery({
    queryKey: ['import-history'],
    queryFn: () => listBatches(50),
    enabled: section === 'HISTORY',
  });

  const visibleRows = useMemo(() => filterRows(rows, filter), [rows, filter]);
  const step = stepForStatus(batch?.status);
  const status = batch ? BATCH_STATUS[batch.status as BatchStatus] : null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['import-batch'] });
    queryClient.invalidateQueries({ queryKey: ['import-rows'] });
    queryClient.invalidateQueries({ queryKey: ['import-history'] });
  };

  const run = <T,>(fn: () => Promise<T>, after?: (value: T) => void) => {
    setError(null);
    return fn()
      .then((value) => {
        after?.(value);
        refresh();
      })
      .catch((e) => setError(describeError(e)));
  };

  const upload = useMutation({
    mutationFn: () => uploadImport(file!, mode),
    onSuccess: (b) => {
      setBatchId(b.id);
      setResult(null);
      setFilter('ALL');
      refresh();
    },
    onError: (e) => setError(describeError(e)),
  });

  const approve = useMutation({
    mutationFn: () => approveBatch(batchId!),
    onSuccess: () => {
      setConfirming(null);
      refresh();
    },
    onError: (e) => {
      setConfirming(null);
      setError(describeError(e));
    },
  });

  const apply = useMutation({
    mutationFn: () => applyBatch(batchId!),
    onSuccess: (summary) => {
      setConfirming(null);
      setResult(summary);
      refresh();
    },
    onError: (e) => {
      setConfirming(null);
      setError(describeError(e));
    },
  });

  const rePreview = useMutation({
    mutationFn: () => rePreviewBatch(batchId!),
    onSuccess: () => {
      // The whole batch is re-read from the server. Nothing is reset locally:
      // a local reset would put a new signature on an old comparison.
      setResult(null);
      setFilter('ALL');
      refresh();
    },
    onError: (e) => setError(describeError(e)),
  });

  const resume = useMutation({
    mutationFn: () => resumeBatch(batchId!),
    onSuccess: (summary) => {
      setResult(summary);
      refresh();
    },
    onError: (e) => setError(describeError(e)),
  });

  if (!mayPrepare) {
    return (
      <div className="apex-card">
        <p className="apex-text text-sm font-semibold">Not available</p>
        <p className="apex-text-muted mt-1 text-sm">
          Importing attendance is limited to HR, administrators, and the attendance data
          operator.
        </p>
      </div>
    );
  }

  const chooseFile = (chosen: File | null) => {
    setResult(null);
    if (!chosen) {
      setFile(null);
      return;
    }
    const reason = rejectFileReason(chosen);
    if (reason) {
      setError(reason);
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setError(null);
    setFile(chosen);
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="apex-text text-xl font-semibold">Import / Update Data</h1>
          <p className="apex-text-muted mt-1 text-sm">
            Correct or recover attendance when normal capture did not work.
          </p>
        </div>
        {section !== 'HOME' && (
          <button
            type="button"
            onClick={() => {
              setSection('HOME');
              setError(null);
            }}
            className="apex-text-muted text-sm underline underline-offset-2"
          >
            ← All options
          </button>
        )}
      </header>

      {error && (
        <div role="alert" className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
          <p className="text-xs text-amber-800 dark:text-amber-300">{error}</p>
        </div>
      )}

      {section === 'HOME' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Choice
            title="Manual recovery"
            body="Fix one employee's day when a punch could not be captured."
            onClick={() => setSection('RECOVERY')}
          />
          <Choice
            title="Bulk import"
            body="Upload a spreadsheet to correct or bring in many days at once."
            onClick={() => setSection('BULK')}
          />
          <Choice
            title="Import history"
            body="Everything that has been uploaded, and what happened to it."
            onClick={() => setSection('HISTORY')}
          />
        </div>
      )}

      {section === 'RECOVERY' && <Recovery />}

      {section === 'HISTORY' && <History rows={history} onOpen={(id) => { setBatchId(id); setSection('BULK'); }} />}

      {section === 'BULK' && (
        <>
          <Steps current={batch ? step : 'UPLOAD'} />

          {!batch && (
            <>
              <div className="apex-card">
                <p className="apex-text text-sm font-semibold">1. Start from the template</p>
                <p className="apex-text-muted mt-1 text-sm">
                  Use Employee ID as the identity — a name cannot identify somebody. Do not
                  rename the columns, and keep dates and times in the format shown.
                </p>
                <button
                  type="button"
                  onClick={() => run(downloadTemplate)}
                  className="apex-btn-secondary mt-3"
                >
                  Download attendance template
                </button>
              </div>

              <div className="apex-card">
                <p className="apex-text text-sm font-semibold">2. Upload the file</p>

                <fieldset className="mt-3">
                  <legend className="apex-text-subtle text-[11px] uppercase tracking-wide">
                    What is this file for?
                  </legend>
                  <div className="mt-2 space-y-2">
                    {(Object.keys(MODE) as ImportMode[]).map((m) => (
                      <label key={m} className="flex cursor-pointer gap-2.5">
                        <input
                          type="radio"
                          name="import-mode"
                          value={m}
                          checked={mode === m}
                          onChange={() => setMode(m)}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="apex-text block text-sm font-medium">
                            {MODE[m].label}
                          </span>
                          <span className="apex-text-muted block text-xs">{MODE[m].help}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="mt-4">
                  <label
                    htmlFor="import-file"
                    className="apex-text-subtle text-[11px] uppercase tracking-wide"
                  >
                    File
                  </label>
                  <input
                    id="import-file"
                    ref={fileInput}
                    type="file"
                    accept=".xlsx,.csv"
                    onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
                    className="apex-input mt-1 block w-full text-sm"
                  />
                  <p className="apex-text-muted mt-1 text-xs">
                    .xlsx or .csv, up to 5 MB.
                  </p>
                </div>

                {file && (
                  <p className="apex-text-muted mt-2 text-xs">
                    {file.name} · {formatBytes(file.size)} · {MODE[mode].label}
                  </p>
                )}

                <button
                  type="button"
                  disabled={!file || upload.isPending}
                  onClick={() => upload.mutate()}
                  className="apex-btn-primary mt-3 disabled:opacity-50"
                >
                  {upload.isPending ? 'Checking…' : 'Upload and check'}
                </button>
                <p className="apex-text-muted mt-2 text-xs">
                  Uploading only compares the file with Apex OS. No attendance is changed.
                </p>
              </div>
            </>
          )}

          {batch && status && (
            <>
              <div className="apex-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="apex-text text-sm font-semibold">
                      {batch.reference} · {batch.fileName}
                    </p>
                    <p className="apex-text-muted mt-0.5 text-xs">
                      {MODE[batch.mode].label} · uploaded by{' '}
                      {batch.uploadedBy?.name ?? 'somebody else'} ·{' '}
                      {formatBytes(batch.fileByteSize)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${TONE_TEXT[status.tone]}`}>
                      {status.label}
                    </p>
                  </div>
                </div>
                <p className="apex-text-muted mt-2 text-xs">{status.detail}</p>
                {batch.failureReason && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {batch.failureReason}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setBatchId(null);
                    setFile(null);
                    setResult(null);
                    if (fileInput.current) fileInput.current.value = '';
                  }}
                  className="apex-text-muted mt-3 text-xs underline underline-offset-2"
                >
                  Start another import
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                {summaryCards(batch).map((card) => (
                  <div key={card.label} className="apex-card py-3">
                    <p className="apex-text-subtle text-[11px] uppercase tracking-wide">
                      {card.label}
                    </p>
                    <p className={`mt-1 text-xl font-semibold tabular-nums ${TONE_TEXT[card.tone]}`}>
                      {card.value}
                    </p>
                  </div>
                ))}
              </div>

              {isAllMatch(batch) && (
                <div className="apex-card border-emerald-200 dark:border-emerald-900">
                  <p className="apex-text text-sm font-semibold">
                    Attendance already matches this file.
                  </p>
                  <p className="apex-text-muted mt-1 text-sm">
                    Every one of the {batch.totalRows} rows agrees with what Apex OS records.
                    Nothing needs changing — this is a clean reconciliation, not a failed import.
                  </p>
                </div>
              )}

              {(batch.conflictRows > 0 || batch.invalidRows > 0) && (
                <div className="apex-card">
                  <p className="apex-text text-sm font-semibold">Some rows need fixing</p>
                  <p className="apex-text-muted mt-1 text-sm">
                    This batch cannot be approved while any row cannot be applied or cannot be
                    read. Download the list, fix those rows in the file, and upload it again.
                  </p>
                  <button
                    type="button"
                    onClick={() => run(() => downloadErrorWorkbook(batch.id, batch.reference))}
                    className="apex-btn-secondary mt-3"
                  >
                    Download rows to fix
                  </button>
                </div>
              )}

              {result && (
                <div className="apex-card">
                  <p className="apex-text text-sm font-semibold">{resultHeadline(result)}</p>
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
                    {resultLines(result).map((line) => (
                      <div key={line.label}>
                        <p className="apex-text-subtle text-[11px] uppercase tracking-wide">
                          {line.label}
                        </p>
                        <p className={`text-lg font-semibold tabular-nums ${TONE_TEXT[line.tone]}`}>
                          {line.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="apex-card">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {ROW_FILTERS.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => setFilter(f.value)}
                      aria-pressed={filter === f.value}
                      className={`rounded-lg px-2.5 py-1 text-xs ${
                        filter === f.value
                          ? 'bg-[var(--accent)] text-[var(--text-inverse)]'
                          : 'apex-text-muted bg-[var(--surface-2)]'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <ImportRowTable rows={visibleRows} />
              </div>

              <Actions
                batch={batch}
                mayApprove={mayApprove}
                busy={approve.isPending || apply.isPending || rePreview.isPending || resume.isPending}
                confirming={confirming}
                onConfirm={setConfirming}
                onApprove={() => approve.mutate()}
                onApply={() => apply.mutate()}
                onRePreview={() => rePreview.mutate()}
                onResume={() => resume.mutate()}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Manual recovery, reached where the context already exists.
 *
 * The recovery form needs the employee, the day, AND what is currently
 * recorded for them, which is exactly a Daily Review row. Building a second
 * employee picker here would duplicate that lookup and hand HR a name with no
 * context beside it -- so this sends them to the day instead, using the deep
 * link Daily Review already understands.
 */
function Recovery() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  return (
    <div className="apex-card">
      <p className="apex-text text-sm font-semibold">Manual recovery</p>
      <p className="apex-text-muted mt-1 text-sm">
        One employee, one day — for when a punch could not be captured at all. Apex OS records
        that the entry was made by hand, and never invents location or photo evidence for a day
        nobody captured.
      </p>
      <p className="apex-text-muted mt-2 text-sm">
        Pick the day and recover it from that day&apos;s review, where you can see what is
        already recorded for each person.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="recovery-date" className="apex-text-subtle text-[11px] uppercase tracking-wide">
            Date
          </label>
          <input
            id="recovery-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="apex-input mt-1"
          />
        </div>
        <Link href={`/attendance/admin?businessDate=${date}`} className="apex-btn-primary">
          Open that day
        </Link>
      </div>
    </div>
  );
}

function Choice({ title, body, onClick }: { title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="apex-card text-left hover:border-[var(--accent)]">
      <p className="apex-text text-sm font-semibold">{title}</p>
      <p className="apex-text-muted mt-1 text-sm">{body}</p>
    </button>
  );
}

function Steps({ current }: { current: string }) {
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Import progress">
      {WIZARD_STEPS.map((s) => {
        const active = s.key === current;
        return (
          <li
            key={s.key}
            aria-current={active ? 'step' : undefined}
            className={`rounded-lg px-2.5 py-1 text-xs ${
              active
                ? 'bg-[var(--accent)] text-[var(--text-inverse)]'
                : 'apex-text-muted bg-[var(--surface-2)]'
            }`}
          >
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Approve and apply are two buttons, never one.
 *
 * Merging them would remove the only moment at which somebody can look at the
 * comparison, and the only moment at which Apex OS can notice that the world
 * moved between the review and the write.
 */
function Actions({
  batch, mayApprove, busy, confirming, onConfirm, onApprove, onApply, onRePreview, onResume,
}: {
  batch: ImportBatch;
  mayApprove: boolean;
  busy: boolean;
  confirming: 'APPROVE' | 'APPLY' | null;
  onConfirm: (v: 'APPROVE' | 'APPLY' | null) => void;
  onApprove: () => void;
  onApply: () => void;
  onRePreview: () => void;
  onResume: () => void;
}) {
  const action = BATCH_STATUS[batch.status as BatchStatus]?.action;
  const approvable = batch.conflictRows === 0 && batch.invalidRows === 0;

  if (!mayApprove) {
    return (
      <div className="apex-card">
        <p className="apex-text-muted text-sm">
          Approving and applying an import is done by HR or an administrator. You can prepare,
          check and re-upload the file.
        </p>
      </div>
    );
  }

  if (action === 'RE_PREVIEW') {
    return (
      <div className="apex-card">
        <p className="apex-text text-sm font-semibold">Refresh the comparison</p>
        <p className="apex-text-muted mt-1 text-sm">
          Attendance changed after this batch was approved. Reviewing the refreshed comparison
          is the only way forward — the earlier approval described attendance that has since
          moved, and it has been cleared.
        </p>
        <button type="button" onClick={onRePreview} disabled={busy} className="apex-btn-primary mt-3 disabled:opacity-50">
          {busy ? 'Refreshing…' : 'Refresh comparison'}
        </button>
      </div>
    );
  }

  if (batch.status === 'APPLYING') {
    return (
      <div className="apex-card">
        <p className="apex-text text-sm font-semibold">Applying…</p>
        <p className="apex-text-muted mt-1 text-sm">
          Attendance is being updated. This page will follow along.
        </p>
        <button type="button" onClick={onResume} disabled={busy} className="apex-btn-secondary mt-3 disabled:opacity-50">
          Resume a run that has stopped
        </button>
        <p className="apex-text-muted mt-1.5 text-xs">
          Only possible once Apex OS is satisfied the previous run really has died.
        </p>
      </div>
    );
  }

  if (action === 'REVIEW' && batch.status === 'READY_FOR_REVIEW') {
    if (confirming === 'APPROVE') {
      return (
        <div className="apex-card">
          <p className="apex-text text-sm font-semibold">Approve this batch?</p>
          <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
            <Row k="Batch" v={batch.reference} />
            <Row k="File" v={batch.fileName} />
            <Row k="Uploaded by" v={batch.uploadedBy?.name ?? '—'} />
            <Row k="Rows" v={String(batch.totalRows)} />
            <Row k="Changes" v={String(batch.changeRows)} />
            <Row k="New records" v={String(batch.newRows)} />
            <Row k="No change needed" v={String(batch.matchRows)} />
            <Row k="Warnings" v={String(batch.warningRows)} />
          </dl>
          <p className="apex-text-muted mt-3 text-sm">
            Approving records that you have looked at this comparison and accepted it.{' '}
            <strong className="apex-text">It does not change attendance yet.</strong>
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={onApprove} disabled={busy} className="apex-btn-primary disabled:opacity-50">
              {busy ? 'Approving…' : 'Approve batch'}
            </button>
            <button type="button" onClick={() => onConfirm(null)} className="apex-btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="apex-card">
        <button
          type="button"
          onClick={() => onConfirm('APPROVE')}
          disabled={!approvable || busy}
          className="apex-btn-primary disabled:opacity-50"
        >
          Approve batch
        </button>
        <p className="apex-text-muted mt-2 text-xs">
          {approvable
            ? 'You will see a summary before anything is recorded. Approval does not change attendance.'
            : 'Rows that cannot be applied or cannot be read have to be fixed in the file first.'}
        </p>
      </div>
    );
  }

  if (action === 'APPLY') {
    if (confirming === 'APPLY') {
      return (
        <div className="apex-card">
          <p className="apex-text text-sm font-semibold">Apply attendance changes?</p>
          <p className="apex-text-muted mt-2 text-sm">
            This updates official attendance for the approved rows. It is recorded against your
            name, and it cannot overwrite attendance that has changed since the review — any row
            whose day has moved is left for you to look at again.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={onApply} disabled={busy} className="apex-btn-primary disabled:opacity-50">
              {busy ? 'Applying…' : 'Apply changes'}
            </button>
            <button type="button" onClick={() => onConfirm(null)} className="apex-btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="apex-card">
        <p className="apex-text-muted mb-3 text-sm">
          Approved by {batch.approvedBy?.name ?? 'HR'}. Attendance has not been changed yet.
        </p>
        <button type="button" onClick={() => onConfirm('APPLY')} disabled={busy} className="apex-btn-primary disabled:opacity-50">
          Apply attendance changes
        </button>
      </div>
    );
  }

  return null;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 sm:block">
      <dt className="apex-text-subtle">{k}</dt>
      <dd className="apex-text font-medium">{v}</dd>
    </div>
  );
}

function History({ rows, onOpen }: { rows: ImportBatch[]; onOpen: (id: string) => void }) {
  if (rows.length === 0) {
    return (
      <div className="apex-card">
        <p className="apex-text-muted text-sm">Nothing has been imported yet.</p>
      </div>
    );
  }
  return (
    <div className="apex-card overflow-x-auto">
      <table className="w-full min-w-[42rem] text-left text-sm">
        <thead>
          <tr className="apex-text-subtle border-b border-[var(--border)] text-[11px] uppercase tracking-wide">
            <th className="py-2 pr-3 font-medium">Reference</th>
            <th className="py-2 pr-3 font-medium">File</th>
            <th className="py-2 pr-3 font-medium">Purpose</th>
            <th className="py-2 pr-3 font-medium">Uploaded</th>
            <th className="py-2 pr-3 font-medium text-right">Rows</th>
            <th className="py-2 pr-3 font-medium text-right">Changes</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const s = BATCH_STATUS[b.status as BatchStatus];
            return (
              <tr key={b.id} className="border-b border-[var(--border)] last:border-0">
                <td className="py-2.5 pr-3">
                  <button
                    type="button"
                    onClick={() => onOpen(b.id)}
                    className="apex-text font-medium underline underline-offset-2"
                  >
                    {b.reference}
                  </button>
                </td>
                <td className="apex-text-muted py-2.5 pr-3 text-xs">{b.fileName}</td>
                <td className="apex-text-muted py-2.5 pr-3 text-xs">{MODE[b.mode]?.label ?? b.mode}</td>
                <td className="apex-text-muted py-2.5 pr-3 text-xs">
                  {b.uploadedBy?.name ?? '—'}
                  <span className="apex-text-subtle block">{b.uploadedAt?.slice(0, 10)}</span>
                </td>
                <td className="apex-text-muted py-2.5 pr-3 text-right text-xs tabular-nums">{b.totalRows}</td>
                <td className="apex-text-muted py-2.5 pr-3 text-right text-xs tabular-nums">{b.changeRows}</td>
                <td className={`py-2.5 text-xs font-medium ${TONE_TEXT[s?.tone ?? 'muted']}`}>
                  {s?.label ?? b.status}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
