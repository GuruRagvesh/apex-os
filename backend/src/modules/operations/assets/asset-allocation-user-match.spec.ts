import { matchAllocationUser } from './asset-allocation-user-match';

const users = [
  { id: 'u-aniket', employeeId: 'EMP-1', name: 'Aniket Phapale' },
  { id: 'u-guru', employeeId: 'EMP-2', name: 'Guru Thanumoorthy' },
  { id: 'u-sumedh', employeeId: 'EMP-3', name: 'Sumedh Sadaphal' },
  { id: 'u-sonali', employeeId: 'EMP-4', name: 'Sonali Karveer' },
];

describe('matchAllocationUser', () => {
  it('uses employee ids before names', () => {
    expect(matchAllocationUser({ employeeId: 'EMP-1', employeeName: 'Different Name' }, users)?.id).toBe('u-aniket');
  });

  it('matches full workbook names to shorter profile names', () => {
    expect(matchAllocationUser({ employeeName: 'Aniket Dattatray Phapale' }, users)?.id).toBe('u-aniket');
    expect(matchAllocationUser({ employeeName: 'Guru Ragvesh Thanu Moorthy' }, users)?.id).toBe('u-guru');
  });

  it('handles a minor surname spelling difference when the first name agrees', () => {
    expect(matchAllocationUser({ employeeName: 'Sumedh Sadapal' }, users)?.id).toBe('u-sumedh');
  });

  it('matches a unique single-name workbook entry', () => {
    expect(matchAllocationUser({ employeeName: 'Sonali' }, users)?.id).toBe('u-sonali');
  });

  it('refuses ambiguous display names', () => {
    const duplicateUsers = [...users, { id: 'u-sonali-2', employeeId: 'EMP-5', name: 'Sonali Patil' }];
    expect(matchAllocationUser({ employeeName: 'Sonali' }, duplicateUsers)).toBeNull();
  });

  it('uses a matching company email to resolve duplicate full names', () => {
    const duplicateUsers = [
      { id: 'u-hr', employeeId: 'EMP-5', name: 'Shubham Suryawanshi', email: 'hr@example.com' },
      { id: 'u-shubham', employeeId: 'EMP-6', name: 'Shubham Suryawanshi', email: 'shubham.suryawanshi@example.com' },
    ];
    expect(matchAllocationUser({ employeeName: 'Shubham Suryawanshi' }, duplicateUsers)?.id).toBe('u-shubham');
  });

  it('does not treat availability labels as employees', () => {
    expect(matchAllocationUser({ employeeName: 'Available' }, users)).toBeNull();
  });
});
