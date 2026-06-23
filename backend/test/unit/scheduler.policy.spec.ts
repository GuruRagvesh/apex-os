import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerService } from '../../src/modules/platform/scheduler/scheduler.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventsGateway } from '../../src/modules/platform/gateway/events.gateway';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { NotificationEventService } from '../../src/modules/operations/notifications/notification-event.service';
import { SettingsService } from '../../src/modules/platform/settings/settings.service';
import { shouldPolicyAutoStop, buildCompanyDateTimeUtc, resolvePolicyCutoffForUser } from '../../src/modules/platform/workday/workday.policy.helper';

describe('FP-18E Policy Auto Stop Helper', () => {
  it('1. resolvePolicyCutoffForUser returns employee end time', () => {
    const user = { role: { name: 'EMPLOYEE' } };
    const policy = { employeeTiming: { end: '18:30' } };
    expect(resolvePolicyCutoffForUser(user, policy)).toBe('18:30');
  });

  it('2. resolvePolicyCutoffForUser returns intern end time', () => {
    const user = { role: { name: 'INTERN' } };
    const policy = { employeeTiming: { end: '18:30' } };
    expect(resolvePolicyCutoffForUser(user, policy)).toBe('18:30');
  });

  it('3. resolvePolicyCutoffForUser returns team lead exit end time', () => {
    const user = { role: { name: 'TEAM_LEAD' } };
    const policy = { tlTiming: { exitEnd: '19:30' } };
    expect(resolvePolicyCutoffForUser(user, policy)).toBe('19:30');
  });

  it('4. resolvePolicyCutoffForUser returns null for flexible managers', () => {
    const user = { role: { name: 'MANAGER' } };
    const policy = { managerTiming: { flexible: true } };
    expect(resolvePolicyCutoffForUser(user, policy)).toBeNull();
  });

  it('5. shouldPolicyAutoStop returns false if autoClose is off', () => {
    const policy = { autoClose: false };
    expect(shouldPolicyAutoStop({}, {}, policy, new Date(), '2026-06-04', '2026-06-04').shouldStop).toBe(false);
  });

  it('6. shouldPolicyAutoStop returns true if past global autoCloseTime in same day', () => {
    const policy = { autoClose: true, autoCloseTime: '18:30', employeeTiming: { end: '18:30' }, timezone: 'Asia/Kolkata' };
    const user = { role: { name: 'EMPLOYEE' } };
    const session = { logoutAt: null };

    // Simulate current company time 19:00, which is definitely past 18:30
    const now = buildCompanyDateTimeUtc('2026-06-04', '19:00', 'Asia/Kolkata');

    const res = shouldPolicyAutoStop(session, user, policy, now, '2026-06-04', '2026-06-04');
    expect(res.shouldStop).toBe(true);
    expect(res.cutoffUtc).toBeDefined();
  });

  it('7. shouldPolicyAutoStop returns false if before global autoCloseTime', () => {
    const policy = { autoClose: true, autoCloseTime: '18:30', employeeTiming: { end: '18:30' }, timezone: 'Asia/Kolkata' };
    const user = { role: { name: 'EMPLOYEE' } };
    const session = { logoutAt: null };

    const now = buildCompanyDateTimeUtc('2026-06-04', '18:00', 'Asia/Kolkata');

    const res = shouldPolicyAutoStop(session, user, policy, now, '2026-06-04', '2026-06-04');
    expect(res.shouldStop).toBe(false);
  });

  // ── Global Auto Close business rule: autoCloseTime is the final company
  // cutoff for every role, regardless of role timing windows. ──────────────

  it('8. employee current-day session closes after global autoCloseTime', () => {
    const policy = { autoClose: true, autoCloseTime: '14:34', employeeTiming: { end: '18:30' }, timezone: 'Asia/Kolkata' };
    const user = { role: { name: 'EMPLOYEE' } };
    const session = { logoutAt: null };
    const now = buildCompanyDateTimeUtc('2026-06-04', '14:40', 'Asia/Kolkata'); // 6 min after cutoff

    const res = shouldPolicyAutoStop(session, user, policy, now, '2026-06-04', '2026-06-04');
    expect(res.shouldStop).toBe(true);
  });

  it('9. team lead current-day session closes after global autoCloseTime even though tlTiming.exitEnd is later', () => {
    const policy = { autoClose: true, autoCloseTime: '14:34', tlTiming: { exitEnd: '19:30' }, timezone: 'Asia/Kolkata' };
    const user = { role: { name: 'TEAM_LEAD' } };
    const session = { logoutAt: null };
    const now = buildCompanyDateTimeUtc('2026-06-04', '14:40', 'Asia/Kolkata');

    const res = shouldPolicyAutoStop(session, user, policy, now, '2026-06-04', '2026-06-04');
    expect(res.shouldStop).toBe(true);
  });

  it.each(['MANAGER', 'ADMIN', 'SUPER_ADMIN'])(
    '10. %s current-day session closes after global autoCloseTime even with flexible timing',
    (roleName) => {
      const policy = { autoClose: true, autoCloseTime: '14:34', managerTiming: { flexible: true }, timezone: 'Asia/Kolkata' };
      const user = { role: { name: roleName } };
      const session = { logoutAt: null };
      const now = buildCompanyDateTimeUtc('2026-06-04', '14:40', 'Asia/Kolkata');

      const res = shouldPolicyAutoStop(session, user, policy, now, '2026-06-04', '2026-06-04');
      expect(res.shouldStop).toBe(true);
    },
  );

  it('11. current-day session does not close before global autoCloseTime', () => {
    const policy = { autoClose: true, autoCloseTime: '14:34', timezone: 'Asia/Kolkata' };
    const user = { role: { name: 'EMPLOYEE' } };
    const session = { logoutAt: null };
    const now = buildCompanyDateTimeUtc('2026-06-04', '14:30', 'Asia/Kolkata'); // 4 min before cutoff

    const res = shouldPolicyAutoStop(session, user, policy, now, '2026-06-04', '2026-06-04');
    expect(res.shouldStop).toBe(false);
  });

  it('12. autoClose disabled means no global auto-close even past configured autoCloseTime', () => {
    const policy = { autoClose: false, autoCloseTime: '14:34', timezone: 'Asia/Kolkata' };
    const user = { role: { name: 'EMPLOYEE' } };
    const session = { logoutAt: null };
    const now = buildCompanyDateTimeUtc('2026-06-04', '23:00', 'Asia/Kolkata');

    const res = shouldPolicyAutoStop(session, user, policy, now, '2026-06-04', '2026-06-04');
    expect(res.shouldStop).toBe(false);
  });
});
