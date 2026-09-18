import {
  assertProductionIdentity,
  maskEmail,
  parseRepairTargets,
} from '../../scripts/repair-production-attendance-six';

const targets = [
  'sherin',
  'dhruv',
  'vivek',
  'shruti',
  'tejas-goswami',
  'kanishk',
].map((caseKey, index) => ({
  caseKey,
  id: `user-${index + 1}`,
  email: `${caseKey}@example.test`,
  joiningDate: '2026-09-01',
}));

describe('targeted production attendance repair safety', () => {
  it('accepts exactly the six approved case keys', () => {
    expect(parseRepairTargets(JSON.stringify(targets))).toEqual(targets);
  });

  it('refuses a missing target', () => {
    expect(() => parseRepairTargets(JSON.stringify(targets.slice(0, 5)))).toThrow(
      'must contain exactly six targets',
    );
  });

  it('refuses a substituted target key', () => {
    const changed = targets.map((target) => ({ ...target }));
    changed[5].caseKey = 'someone-else';
    expect(() => parseRepairTargets(JSON.stringify(changed))).toThrow(
      'target case keys must be exactly',
    );
  });

  it('refuses duplicate immutable ids', () => {
    const changed = targets.map((target) => ({ ...target }));
    changed[5].id = changed[0].id;
    expect(() => parseRepairTargets(JSON.stringify(changed))).toThrow(
      'target user ids must be unique',
    );
  });

  it('refuses an impossible joining date', () => {
    const changed = targets.map((target) => ({ ...target }));
    changed[0].joiningDate = '2026-02-31';
    expect(() => parseRepairTargets(JSON.stringify(changed))).toThrow(
      'is not a real calendar date',
    );
  });

  it('requires independent production identity values', () => {
    expect(() =>
      assertProductionIdentity({
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@production.example/db',
        EXPECTED_PRODUCTION_DB_HOST: 'other.example',
        EXPECTED_PRODUCTION_DB_NAME: 'db',
      }),
    ).toThrow('database host does not match');
  });

  it('refuses local and staging targets', () => {
    expect(() =>
      assertProductionIdentity({
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@localhost/apex_os',
        EXPECTED_PRODUCTION_DB_HOST: 'localhost',
        EXPECTED_PRODUCTION_DB_NAME: 'apex_os',
      }),
    ).toThrow('target looks local or non-production');
  });

  it('masks an email in operator output', () => {
    expect(maskEmail('person@example.test')).toBe('pe***@example.test');
  });
});
