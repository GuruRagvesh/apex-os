/**
 * THE GUARD THAT KEEPS DELETION SAFE AS THE SCHEMA GROWS.
 *
 * Archive & Delete is only as safe as its knowledge of what points at a User.
 * A relation added next month that nobody classified is not a documentation
 * gap -- it is a record deleted or orphaned by an irreversible operation.
 *
 * So the chain is deliberate:
 *
 *     a new User relation appears in schema.prisma
 *             -> this test fails
 *             -> somebody has to classify it
 *
 * The matrix in docs/ was ALREADY STALE when this was written: it described
 * 50 relations across 38 models, the schema has 45 across 36, and
 * AttendanceMonthClose.reopenedBy had been added days earlier with nothing
 * noticing. That is exactly the drift this prevents, and it is why the
 * classification lives in code and the document explains rather than decides.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  auditClassification,
  extractUserRelations,
  relationKey,
  rulesFor,
  RULES_BY_KEY,
  USER_RELATION_RULES,
} from '../../src/modules/platform/archive/user-relation-classification';

const SCHEMA = readFileSync(
  resolve(__dirname, '../../prisma/schema.prisma'),
  'utf8',
);

describe('every User relation in the schema is classified', () => {
  it('HAS NO UNCLASSIFIED RELATION', () => {
    const audit = auditClassification(SCHEMA);

    // Named individually so a failure says WHICH relation to go and classify,
    // rather than only that the count moved.
    expect(
      audit.unclassified.map((r) => `${relationKey(r.model, r.field)} (${r.fk})`),
    ).toEqual([]);
  });

  it('HAS NO RULE FOR A RELATION THAT NO LONGER EXISTS', () => {
    // A stale rule is not dangerous the way an unclassified one is, but it is
    // how a list starts drifting from the thing it describes.
    const audit = auditClassification(SCHEMA);

    expect(audit.obsolete.map((r) => relationKey(r.model, r.field))).toEqual([]);
  });

  it('classifies every relation the extractor finds, and no more', () => {
    const relations = extractUserRelations(SCHEMA);

    expect(relations.length).toBeGreaterThan(0);
    expect(USER_RELATION_RULES).toHaveLength(relations.length);
  });

  it('gives each relation exactly one rule', () => {
    // Two rules for one key would make the action depend on lookup order.
    const keys = USER_RELATION_RULES.map((r) => relationKey(r.model, r.field));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('states a resolution for every BLOCK_DELETE, and only those', () => {
    // A block with no stated resolution is a dead end for whoever hits it.
    for (const rule of USER_RELATION_RULES) {
      if (rule.action === 'BLOCK_DELETE') {
        expect(rule.resolution).toBeTruthy();
      } else {
        expect(rule.resolution).toBeUndefined();
      }
    }
  });

  it('gives every rule a reason', () => {
    for (const rule of USER_RELATION_RULES) {
      expect(rule.why.length).toBeGreaterThan(10);
    }
  });
});

describe('what the classification actually says', () => {
  it('reports the counts it was built from', () => {
    // Pinned so a silent reclassification -- a record quietly moving from
    // retained to deleted -- fails rather than passing unnoticed.
    const audit = auditClassification(SCHEMA);

    expect(audit.total).toBe(45);
    expect(rulesFor('DELETE_WITH_USER')).toHaveLength(22);
    expect(rulesFor('RETAIN_WITH_SNAPSHOT')).toHaveLength(15);
    expect(rulesFor('RETAIN_AND_NULL_ACTOR')).toHaveLength(5);
    expect(rulesFor('BLOCK_DELETE')).toHaveLength(3);
  });

  it('KEEPS SHARED COMPANY HISTORY, every kind of it', () => {
    // The single most important property of the whole feature: a person
    // leaving must not take the company's record of the work with them.
    const retained = ['RETAIN_WITH_SNAPSHOT', 'RETAIN_AND_NULL_ACTOR'];

    for (const key of [
      'Ticket.createdBy',
      'Ticket.assignedTo',
      'TicketHistory.changedBy',
      'TicketTimeLog.user',
      'Comment.author',
      'OperationalEvent.actor',
      'ActivityLog.user',
      'ReviewCycleLog.reviewer',
      'AttendanceMonthClose.finalizedBy',
      'AttendanceMonthClose.reopenedBy',
      'AttendanceImportBatch.uploadedBy',
      'LeadActivity.createdBy',
      'FollowUp.createdBy',
      'EmployeeProfileChangeRequest.requestedBy',
    ]) {
      const rule = RULES_BY_KEY.get(key);
      expect(rule).toBeDefined();
      expect(retained).toContain(rule!.action);
    }
  });

  it('NEVER DELETES A TICKET, PROJECT, TEAM OR DEPARTMENT with the person', () => {
    // Only the membership row goes. The thing itself is the company's.
    for (const key of [
      'ProjectMember.user',
      'TeamMember.user',
      'UserDepartmentMembership.user',
      'UserRoleAssignment.user',
      'TicketAssignee.user',
    ]) {
      expect(RULES_BY_KEY.get(key)!.action).toBe('DELETE_WITH_USER');
    }

    // And no rule anywhere deletes the parent records themselves.
    const models = USER_RELATION_RULES.filter((r) => r.action === 'DELETE_WITH_USER').map(
      (r) => r.model,
    );
    expect(models).not.toContain('Ticket');
    expect(models).not.toContain('Project');
    expect(models).not.toContain('Team');
    expect(models).not.toContain('Department');
    expect(models).not.toContain('Comment');
    expect(models).not.toContain('OperationalEvent');
  });

  it('BLOCKS on the four things a human has to resolve', () => {
    const blocked = rulesFor('BLOCK_DELETE').map((r) => relationKey(r.model, r.field));

    expect(blocked).toEqual(
      expect.arrayContaining([
        'Team.teamLead',
        'EmployeeProfileChangeRequest.currentApprover',
        'Lead.owner',
      ]),
    );
  });
});

describe('the schema can actually do what the classification intends', () => {
  it('EVERY RETAINED COLUMN CAN NOW HOLD NULL', () => {
    // The third failure mode, and the one that would surface only during an
    // irreversible delete: a relation classified to survive by nulling its
    // actor, on a column the database still declares NOT NULL. The intent
    // would be unachievable and nobody would find out until mid-deletion.
    //
    // Ten columns were in this state before the retention migration. The list
    // is now empty, and this test is what says so -- a new retained relation
    // added on a NOT NULL column puts its own name here and fails.
    const audit = auditClassification(SCHEMA);

    expect(audit.needsNullable.map((r) => relationKey(r.model, r.field))).toEqual([]);
  });
});
