import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  BATCH_STATUS,
  BATCH_STATUSES,
  CLASSIFICATION,
  CLASSIFICATIONS,
  EMPTY,
  MODE,
  ROW_CODE,
  ROW_FILTERS,
  canApprove,
  canPrepare,
  describeError,
  diffFields,
  displayStatus,
  displayTime,
  explainCode,
  filterRows,
  formatBytes,
  isAllMatch,
  isBatchBusy,
  isConcurrentApply,
  rejectFileReason,
  resultHeadline,
  resultLines,
  serverClassificationFilter,
  stepForStatus,
  summaryCards,
  IMPORT_TEMPLATE_FILENAME as FRONTEND_TEMPLATE_NAME,
  errorWorkbookFileName,
  type BatchCounts,
} from '../../../frontend/components/attendance/import-presentation';
import { IMPORT_TEMPLATE_FILENAME } from '../../src/modules/platform/attendance/import/import-template';

/**
 * The HR-facing wording of Attendance Data Control.
 *
 * The frontend has no test runner, so this pure module is exercised from here.
 * Nothing in it decides anything -- the server settles classification,
 * approvability, staleness and outcome -- so what is tested is whether the
 * screen tells the truth about what the server decided, and whether it can be
 * surprised by a verdict the server is entitled to produce.
 */

const counts = (over: Partial<BatchCounts> = {}): BatchCounts => ({
  totalRows: 0, newRows: 0, matchRows: 0, changeRows: 0,
  conflictRows: 0, invalidRows: 0, warningRows: 0, ...over,
});

/** Union members straight out of the server's source, so drift is a failure. */
function unionMembers(file: string, typeName: string): string[] {
  const source = readFileSync(resolve(__dirname, '../../src/modules/platform/attendance/import', file), 'utf8');
  const start = source.indexOf(`export type ${typeName} =`);
  if (start === -1) throw new Error(`${typeName} not found in ${file}`);
  const end = source.indexOf(';', start);
  return [...source.slice(start, end).matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
}

// ════════════════════════════════════════════════════════════════════════════
describe('every verdict the server can reach has words', () => {
  it('1. every row problem code has a sentence and a fix', () => {
    // The one that matters. A code the server emits and this map lacks would
    // put DUPLICATE_CONFLICTING_EMPLOYEE_DAY on screen in front of HR.
    const codes = unionMembers('import-normalize.ts', 'RowProblemCode');
    expect(codes.length).toBeGreaterThan(15);
    const missing = codes.filter((c) => !ROW_CODE[c]);
    expect(missing).toEqual([]);
  });

  it('2. every warning code has a sentence', () => {
    const codes = unionMembers('import-normalize.ts', 'RowWarningCode');
    expect(codes.filter((c) => !ROW_CODE[c])).toEqual([]);
  });

  it('3. every conflict code has a sentence and tells HR what to do', () => {
    const codes = unionMembers('import-classify.ts', 'ConflictCode');
    expect(codes).toContain('MISSING_AUTHORITATIVE_LEAVE');
    for (const code of codes) {
      expect(ROW_CODE[code]).toBeDefined();
      expect(ROW_CODE[code].fix.length).toBeGreaterThan(10);
    }
  });

  it('4. an unknown code still produces a sentence, never the raw code', () => {
    const explained = explainCode('SOMETHING_ADDED_NEXT_YEAR');
    expect(explained.message).not.toContain('SOMETHING_ADDED_NEXT_YEAR');
    expect(explained.message).not.toMatch(/[A-Z]{2,}_[A-Z]/);
  });

  it('5. leave conflicts send HR to the leave workflow, never to a fix here', () => {
    // The importer must not become a way to create leave.
    expect(ROW_CODE.MISSING_AUTHORITATIVE_LEAVE.fix).toMatch(/leave workflow/i);
    expect(ROW_CODE.MISSING_AUTHORITATIVE_LEAVE.fix).toMatch(/cannot create leave/i);
  });

  it('6. every batch status the server can store is presentable', () => {
    const enumBlock = readFileSync(
      resolve(__dirname, '../../prisma/schema.prisma'), 'utf8',
    );
    const start = enumBlock.indexOf('enum AttendanceImportStatus');
    const body = enumBlock.slice(start, enumBlock.indexOf('}', start));
    const values = [...body.matchAll(/^\s+([A-Z_]+)\s*$/gm)].map((m) => m[1]);
    expect(values.length).toBeGreaterThan(8);
    for (const value of values) {
      expect(BATCH_STATUS[value as any]).toBeDefined();
    }
    expect(BATCH_STATUSES.length).toBe(values.length);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the screen says whether attendance has been changed', () => {
  it('7. every pre-apply status says nothing has changed yet', () => {
    for (const status of ['READY_FOR_REVIEW', 'APPROVED', 'HAS_ERRORS', 'UPLOADING', 'VALIDATING'] as const) {
      expect(BATCH_STATUS[status].detail).toMatch(/nothing has been changed|no attendance has been changed/i);
    }
  });

  it('8. APPROVED does not claim anything was applied', () => {
    expect(BATCH_STATUS.APPROVED.detail).toMatch(/has been changed yet/i);
    // And approval leads to apply -- they are never one action.
    expect(BATCH_STATUS.APPROVED.action).toBe('APPLY');
  });

  it('9. REVIEW_REQUIRED explains itself and points at re-preview', () => {
    expect(BATCH_STATUS.REVIEW_REQUIRED.label).toBe('Needs re-review');
    expect(BATCH_STATUS.REVIEW_REQUIRED.label).not.toContain('_');
    expect(BATCH_STATUS.REVIEW_REQUIRED.detail).toMatch(/changed after this batch was approved/i);
    expect(BATCH_STATUS.REVIEW_REQUIRED.action).toBe('RE_PREVIEW');
  });

  it('10. PARTIALLY_APPLIED is not presented as a failure', () => {
    expect(BATCH_STATUS.PARTIALLY_APPLIED.tone).not.toBe('danger');
    expect(BATCH_STATUS.PARTIALLY_APPLIED.detail).toMatch(/some rows were applied/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('MATCH is good news', () => {
  it('11. a match reads as "no change needed", positively', () => {
    expect(CLASSIFICATION.MATCH.tone).toBe('positive');
    expect(CLASSIFICATION.MATCH.label).toMatch(/no change/i);
  });

  it('12. a large reconciliation shows matches positively, not as a problem', () => {
    const cards = summaryCards(counts({ totalRows: 3900, matchRows: 3500, changeRows: 400 }));
    const match = cards.find((c) => c.label === 'No change needed')!;
    expect(match.value).toBe(3500);
    expect(match.tone).toBe('positive');
    // Nothing is red just because it is large.
    expect(cards.filter((c) => c.tone === 'danger')).toEqual([]);
  });

  it('13. an all-MATCH file is a success, and says so', () => {
    const all = counts({ totalRows: 120, matchRows: 120 });
    expect(isAllMatch(all)).toBe(true);
    expect(
      resultHeadline({ status: 'APPLIED', attempted: 0, applied: 0, stale: 0, failed: 0, noOps: 120 }),
    ).toMatch(/already matches this file/i);
  });

  it('14. an EMPTY batch is not an all-match success', () => {
    // Zero rows is "there was never anything here", which is the opposite of
    // "everything agreed". The server calls it FAILED; the screen must not
    // congratulate anyone.
    expect(isAllMatch(counts({ totalRows: 0, matchRows: 0 }))).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('current versus proposed', () => {
  const row = {
    currentStatus: 'PRESENT',
    currentPunchIn: '2026-08-14T10:52:00.000Z',
    currentPunchOut: '2026-08-14T18:10:00.000Z',
    proposedStatus: 'PRESENT',
    proposedPunchIn: '2026-08-14T09:48:00.000Z',
    proposedPunchOut: '2026-08-14T18:32:00.000Z',
  };

  it('15. shows exactly the three facts a reviewer is deciding about', () => {
    expect(diffFields(row).map((f) => f.label)).toEqual(['Status', 'Punch in', 'Punch out']);
  });

  it('16. marks only the fields that moved', () => {
    const fields = diffFields(row);
    expect(fields.find((f) => f.label === 'Status')!.changed).toBe(false);
    expect(fields.find((f) => f.label === 'Punch in')!.changed).toBe(true);
    expect(fields.find((f) => f.label === 'Punch out')!.changed).toBe(true);
  });

  it('17. never invents a time for a day that has none', () => {
    // A historical PRESENT day genuinely has no punches. 09:30 on this screen
    // would be the frontend fabricating evidence.
    const historical = {
      currentStatus: null, currentPunchIn: null, currentPunchOut: null,
      proposedStatus: 'PRESENT', proposedPunchIn: null, proposedPunchOut: null,
    };
    const fields = diffFields(historical);
    expect(fields.find((f) => f.label === 'Punch in')!.proposed).toBe(EMPTY);
    expect(fields.find((f) => f.label === 'Punch out')!.proposed).toBe(EMPTY);
    expect(fields.find((f) => f.label === 'Status')!.proposed).toBe('Present');
    const rendered = JSON.stringify(fields);
    expect(rendered).not.toContain('09:30');
    expect(rendered).not.toContain('18:30');
    expect(rendered).not.toContain('00:00');
  });

  it('18. renders null as a dash and never as zero', () => {
    expect(displayTime(null)).toBe(EMPTY);
    expect(displayTime(undefined)).toBe(EMPTY);
    expect(displayTime('not a date')).toBe(EMPTY);
    expect(displayStatus(null)).toBe(EMPTY);
  });

  it('19. never shows a raw enum to a person', () => {
    expect(displayStatus('MISSING_PUNCH')).toBe('Missing Punch');
    expect(displayStatus('HALF_DAY')).toBe('Half Day');
    for (const c of CLASSIFICATIONS) {
      expect(CLASSIFICATION[c].label).not.toContain('_');
    }
    expect(MODE.CURRENT_CORRECTION.label).not.toContain('_');
    expect(MODE.HISTORICAL_MIGRATION.label).not.toContain('_');
  });

  it('20. the row type carries no private evidence to render', () => {
    // Enforced at the type, so it cannot be rendered by accident: these exist
    // on the server row and are deliberately absent from the client one.
    const apiSource = readFileSync(
      resolve(__dirname, '../../../frontend/components/attendance/import-api.ts'), 'utf8',
    );
    const rowType = apiSource.slice(
      apiSource.indexOf('export interface ImportRow {'),
      apiSource.indexOf('export interface ApplySummary'),
    );
    for (const field of ['currentFingerprint', 'EvidenceId', 'photoObjectKey', 'ipAddress', 'deviceMetadata']) {
      expect(rowType).not.toContain(`${field}:`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('who sees which controls', () => {
  const operator = { role: { name: 'MANAGER' }, isAttendanceDataOperator: true };
  const hr = { role: { name: 'MANAGER' }, isHR: true };
  const admin = { role: { name: 'ADMIN' } };
  const superAdmin = { role: { name: 'SUPER_ADMIN' } };
  const manager = { role: { name: 'MANAGER' } };
  const lead = { role: { name: 'TEAM_LEAD' } };
  const employee = { role: { name: 'EMPLOYEE' } };
  const intern = { role: { name: 'INTERN' } };

  it('21. a data operator may prepare but never approve', () => {
    expect(canPrepare(operator)).toBe(true);
    expect(canApprove(operator)).toBe(false);
  });

  it('22. HR, admin and super admin may do both', () => {
    for (const actor of [hr, admin, superAdmin]) {
      expect(canPrepare(actor)).toBe(true);
      expect(canApprove(actor)).toBe(true);
    }
  });

  it('23. an ordinary manager or team lead reaches none of it', () => {
    // Managing a team is not authority over the company's attendance file.
    for (const actor of [manager, lead]) {
      expect(canPrepare(actor)).toBe(false);
      expect(canApprove(actor)).toBe(false);
    }
  });

  it('24. employees and interns reach none of it', () => {
    for (const actor of [employee, intern, null, undefined, {}]) {
      expect(canPrepare(actor as any)).toBe(false);
      expect(canApprove(actor as any)).toBe(false);
    }
  });

  it('25. isHR is a flag, not a role name', () => {
    // A user whose ROLE is literally "HR" but without the flag is not HR here.
    expect(canApprove({ role: { name: 'HR' } })).toBe(false);
    expect(canApprove({ role: { name: 'EMPLOYEE' }, isHR: true })).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('choosing a file', () => {
  it('26. accepts xlsx and csv', () => {
    expect(rejectFileReason({ name: 'august.xlsx', size: 2048 })).toBeNull();
    expect(rejectFileReason({ name: 'AUGUST.CSV', size: 2048 })).toBeNull();
  });

  it('27. explains .xls and .xlsm rather than calling them unsupported', () => {
    // They look close enough to right that a flat refusal reads as a bug.
    const xls = rejectFileReason({ name: 'old.xls', size: 2048 });
    expect(xls).toMatch(/save this as \.xlsx/i);
    expect(rejectFileReason({ name: 'macro.xlsm', size: 2048 })).toMatch(/\.xlsx/i);
  });

  it('28. refuses an empty or oversized file before spending a round trip', () => {
    expect(rejectFileReason({ name: 'a.csv', size: 0 })).toMatch(/empty/i);
    expect(rejectFileReason({ name: 'a.xlsx', size: 6 * 1024 * 1024 })).toMatch(/5 MB/);
    expect(rejectFileReason({ name: 'a.pdf', size: 100 })).toMatch(/\.xlsx or \.csv/i);
  });

  it('29. sizes read as sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('filters', () => {
  const rows = [
    { classification: 'MATCH', warnings: [] },
    { classification: 'CHANGE', warnings: ['NON_WORKING_DAY'] },
    { classification: 'CONFLICT', warnings: [] },
    { classification: 'INVALID', warnings: [] },
  ];

  it('30. offers every classification plus warnings', () => {
    const values = ROW_FILTERS.map((f) => f.value);
    for (const c of CLASSIFICATIONS) expect(values).toContain(c);
    expect(values).toContain('WARNINGS');
    expect(values).toContain('ALL');
  });

  it('31. warnings filter locally; classifications go to the server', () => {
    // WARNINGS is not a classification and must never be sent as one.
    expect(serverClassificationFilter('WARNINGS')).toBeUndefined();
    expect(serverClassificationFilter('ALL')).toBeUndefined();
    expect(serverClassificationFilter('CHANGE')).toBe('CHANGE');
    expect(filterRows(rows, 'WARNINGS')).toHaveLength(1);
    expect(filterRows(rows, 'ALL')).toHaveLength(4);
    expect(filterRows(rows, 'CONFLICT')).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('the result of an apply', () => {
  it('32. a partial run is honest about what did not apply', () => {
    const headline = resultHeadline({
      status: 'PARTIALLY_APPLIED', attempted: 400, applied: 382, stale: 12, failed: 6, noOps: 0,
    });
    expect(headline).toContain('382');
    expect(headline).toContain('400');
    expect(headline).not.toMatch(/all|every/i);
  });

  it('33. lists applied, already-matched, needing review and failed', () => {
    const lines = resultLines({
      status: 'PARTIALLY_APPLIED', attempted: 400, applied: 382, stale: 12, failed: 6, noOps: 6,
    });
    expect(lines.map((l) => l.label)).toEqual(['Applied', 'Already matched', 'Need re-review', 'Failed']);
    expect(lines.find((l) => l.label === 'Need re-review')!.tone).toBe('warn');
  });

  it('34. a clean run shows nothing it does not have', () => {
    const lines = resultLines({
      status: 'APPLIED', attempted: 10, applied: 10, stale: 0, failed: 0, noOps: 0,
    });
    expect(lines.map((l) => l.label)).toEqual(['Applied']);
  });

  it('35. a fully stale run says nothing changed', () => {
    const headline = resultHeadline({
      status: 'REVIEW_REQUIRED', attempted: 40, applied: 0, stale: 40, failed: 0, noOps: 0,
    });
    expect(headline).toMatch(/nothing was changed/i);
    expect(headline).toMatch(/moved after this batch was approved/i);
  });

  it('36. a superseded run does not claim it did the work', () => {
    const headline = resultHeadline({
      status: 'SUPERSEDED', attempted: 40, applied: 0, stale: 0, failed: 0, noOps: 0,
    });
    expect(headline).toMatch(/another run/i);
    expect(headline).toMatch(/nothing was changed/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('where the wizard thinks it is', () => {
  it('37. the step comes from the SERVER status, not from the last click', () => {
    // So a reload lands in the right place, and two people looking at one
    // batch see the same step.
    expect(stepForStatus('READY_FOR_REVIEW')).toBe('REVIEW');
    expect(stepForStatus('HAS_ERRORS')).toBe('REVIEW');
    expect(stepForStatus('APPROVED')).toBe('APPLY');
    expect(stepForStatus('APPLYING')).toBe('APPLY');
    expect(stepForStatus('REVIEW_REQUIRED')).toBe('RESULT');
    expect(stepForStatus('PARTIALLY_APPLIED')).toBe('RESULT');
    expect(stepForStatus(null)).toBe('UPLOAD');
  });

  it('38. only genuinely-working states are treated as busy', () => {
    expect(isBatchBusy('APPLYING')).toBe(true);
    expect(isBatchBusy('VALIDATING')).toBe(true);
    // Waiting for a human is not the server being busy; polling it would be
    // a request every two seconds for as long as the tab is open.
    expect(isBatchBusy('READY_FOR_REVIEW')).toBe(false);
    expect(isBatchBusy('APPROVED')).toBe(false);
    expect(isBatchBusy('REVIEW_REQUIRED')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('errors', () => {
  const err = (status: number, message?: string | string[]) => ({
    response: { status, data: message ? { message } : undefined },
  });

  it('39. a 409 during apply names the real problem', () => {
    expect(isConcurrentApply(err(409))).toBe(true);
    expect(describeError(err(409))).toMatch(/already being applied|already in progress/i);
  });

  it("40. the server's own message wins, because it knows more", () => {
    const detailed = err(403, 'This batch changes your own attendance on 2 day(s).');
    expect(describeError(detailed)).toContain('your own attendance on 2 day(s)');
  });

  it('41. validation arrays become one sentence', () => {
    expect(describeError(err(400, ['Choose a mode.', 'No file was uploaded.']))).toBe(
      'Choose a mode. No file was uploaded.',
    );
  });

  it('42. a 401 tells the user to sign in again', () => {
    expect(describeError(err(401))).toMatch(/session has expired/i);
  });

  it('43. a server error promises nothing was changed', () => {
    expect(describeError(err(500))).toMatch(/nothing was changed/i);
  });

  it('44. an unrecognised failure never shows a stack or an empty string', () => {
    expect(describeError(null)).toMatch(/something went wrong/i);
    expect(describeError({ message: 'Network Error' })).toBe('Network Error');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('downloads use the names the server sends', () => {
  it('45. the template filename matches the server constant exactly', () => {
    // The response interceptor returns response.data, so Content-Disposition
    // never reaches the client and the name has to be mirrored. Pinned here so
    // renaming one side fails rather than saving a mystery file.
    expect(FRONTEND_TEMPLATE_NAME).toBe(IMPORT_TEMPLATE_FILENAME);
  });

  it('46. the error workbook filename matches the server pattern', () => {
    const source = readFileSync(
      resolve(__dirname, '../../src/modules/platform/attendance/import/attendance-import.service.ts'),
      'utf8',
    );
    expect(source).toContain('`Attendance_Import_Errors_${batch.reference}.xlsx`');
    expect(errorWorkbookFileName('ATI-2026-ABC123')).toBe('Attendance_Import_Errors_ATI-2026-ABC123.xlsx');
  });
});
