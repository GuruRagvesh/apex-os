import { readFileSync } from 'fs';
import { join } from 'path';
import {
  HANDLERS,
  JSON_SCRUB_COLUMNS,
  NARRATIVE_TEXT_COLUMNS,
  NOT_USER_REFERENCES,
  handlerWhere,
  scrubJson,
  workbookSheets,
} from '../../src/modules/core/users/lifecycle/dependency-matrix';

// The dependency matrix must classify every place a person can be referenced.
// These tests parse schema.prisma, so a new User relation or user-like column
// fails here until someone decides what archive and deletion do with it.

const SCHEMA = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');

interface Column { model: string; field: string; type: string; userFk: boolean }

function columns(): Column[] {
  const out: Column[] = [];
  for (const [, model, body] of SCHEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const fkFields = new Set<string>();
    for (const line of body.split('\n')) {
      const rel = line.match(/^\s+\w+\s+User\??\s+@relation\([^)]*fields:\s*\[([^\]]*)\]/);
      if (rel) rel[1].split(',').forEach((f) => fkFields.add(f.trim()));
    }
    for (const line of body.split('\n')) {
      const m = line.match(/^\s+(\w+)\s+(String\??|String\[\])\s/) ?? line.match(/^\s+(\w+)\s+(String\??|String\[\])$/);
      if (m) out.push({ model, field: m[1], type: m[2], userFk: fkFields.has(m[1]) });
    }
  }
  return out;
}

const USER_LIKE = /(user|actor|By$|ById$|manager|approver|owner|employee|assignee|reviewer|recipient|author|createdBy|updatedBy|teamLeadName|reportingManager|verifiedBy|lead$|LeadId|member)/i;

describe('lifecycle dependency matrix covers the schema', () => {
  const cols = columns();
  const handled = new Set(HANDLERS.map((h) => `${h.model}.${h.field}`));
  const excluded = new Set(Object.keys(NOT_USER_REFERENCES));

  it('classifies every foreign key to User', () => {
    const fks = cols.filter((c) => c.userFk).map((c) => `${c.model}.${c.field}`);
    expect(fks.length).toBeGreaterThanOrEqual(48);
    const missing = fks.filter((k) => !handled.has(k) && !excluded.has(k));
    expect(missing).toEqual([]);
  });

  it('classifies every user-like column without a foreign key', () => {
    const like = cols
      .filter((c) => !c.userFk && c.field !== 'id' && USER_LIKE.test(c.field))
      .map((c) => `${c.model}.${c.field}`);
    const missing = like.filter((k) => !handled.has(k) && !excluded.has(k));
    expect(missing).toEqual([]);
  });

  it('every handler names a real model and column', () => {
    const real = new Set(cols.map((c) => `${c.model}.${c.field}`));
    const bogus = HANDLERS.filter((h) => !real.has(`${h.model}.${h.field}`)).map((h) => h.key);
    expect(bogus).toEqual([]);
    for (const c of [...JSON_SCRUB_COLUMNS.map((j) => ({ model: j.model, field: j.column })), ...NARRATIVE_TEXT_COLUMNS]) {
      expect([c.model, c.field, new RegExp(`^model ${c.model} \\{[\\s\\S]*?^\\s+${c.field}\\s`, 'm').test(SCHEMA)]).toEqual([c.model, c.field, true]);
    }
  });

  it('has unique handler keys and a workbook sheet for every handler', () => {
    const keys = HANDLERS.map((h) => h.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(HANDLERS.every((h) => typeof h.sheet === 'string' && h.sheet.length > 0 && h.sheet.length <= 31)).toBe(true);
    expect(workbookSheets().length).toBeGreaterThan(20);
  });

  it('deletes append-only rows and session children before work sessions', () => {
    const at = (k: string) => HANDLERS.findIndex((h) => h.key === k);
    for (const k of ['AttendancePunchEvidence.userId', 'WorkdayNote.userId', 'BreakLog.userId', 'TicketTimeLog.userId', 'AttendanceEvent.userId', 'CompOffCredit.employeeId']) {
      expect([k, at(k) < at('WorkSession.userId')]).toEqual([k, true]);
    }
    expect(HANDLERS.filter((h) => h.appendOnly).map((h) => h.model).sort()).toEqual(['AttendancePunchEvidence', 'WorkdayNote']);
  });

  it('never reassigns to a real person and never scrubs by name', () => {
    expect(HANDLERS.filter((h) => h.action === 'NAME').every((h) => !!h.where)).toBe(true);
    const nameRule = HANDLERS.find((h) => h.action === 'NAME')!;
    const where = JSON.stringify(nameRule.where!({ id: 'u1', email: 'a@x.test', employeeId: 'E1' }, { systemUserId: 's', operationId: null, now: new Date() }));
    expect(where).not.toMatch(/rawName/);
    expect(where).toMatch(/userId|rawEmployeeId/);
  });

  it('handler where clauses use the subject, and skip employee-code columns when there is no code', () => {
    const ctx = { systemUserId: 's', operationId: 'op', now: new Date() };
    const scrub = HANDLERS.find((h) => h.key === 'AttendanceImportRow.rawEmployeeId')!;
    expect(handlerWhere(scrub, { id: 'u1', email: 'a@x.test', employeeId: null }, ctx)).toEqual({ id: { in: [] } });
    const ops = HANDLERS.find((h) => h.key === 'UserLifecycleOperation.userId')!;
    expect(handlerWhere(ops, { id: 'u1', email: 'a@x.test', employeeId: null }, ctx)).toEqual({ userId: 'u1', id: { not: 'op' } });
  });
});

describe('JSON identity scrub', () => {
  const alice = { id: 'cuid-alice-0001', email: 'Alice.Rao@Example.test', employeeId: 'EMP1001' };

  it('replaces exact id, email and employee code, and only counts mentions', () => {
    const r = scrubJson(
      { by: 'cuid-alice-0001', mail: 'alice.rao@example.test', code: 'emp1001', note: 'handed over by alice.rao@example.test', other: 'cuid-bob-0002' },
      alice,
    );
    expect(r.value).toEqual({ by: '[deleted-user]', mail: '[deleted-user]', code: '[deleted-user]', note: 'handed over by alice.rao@example.test', other: 'cuid-bob-0002' });
    expect(r.replaced).toBe(3);
    expect(r.residualMentions).toBe(1);
  });

  it('never touches another person with the same name', () => {
    const r = scrubJson({ targetName: 'Alice Rao', targetEmail: 'alice.rao2@example.test', targetId: 'cuid-alice-0002' }, alice);
    expect(r.value).toEqual({ targetName: 'Alice Rao', targetEmail: 'alice.rao2@example.test', targetId: 'cuid-alice-0002' });
    expect(r.replaced).toBe(0);
  });
});
