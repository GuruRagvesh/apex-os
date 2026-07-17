import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerService } from '../../src/modules/platform/scheduler/scheduler.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventsGateway } from '../../src/modules/platform/gateway/events.gateway';
import { TicketLedgerService } from '../../src/modules/operations/tickets/ticket-ledger.service';
import { NotificationEventService } from '../../src/modules/operations/notifications/notification-event.service';
import { SettingsService } from '../../src/modules/platform/settings/settings.service';
import { shouldPolicyAutoStop, buildCompanyDateTimeUtc, resolvePolicyCutoffForUser, AUTO_CLOSE_GRACE_MINUTES } from '../../src/modules/platform/workday/workday.policy.helper';

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

  // ── Resume/active-session grace window (workday resume auto-close consent fix) ──
  // A session the user is demonstrably still in (WORKING/ON_BREAK, recent
  // lastActiveAt) must not be silently force-closed the instant the clock
  // crosses the cutoff — it gets AUTO_CLOSE_GRACE_MINUTES to respond to the
  // frontend consent prompt. Genuinely abandoned sessions still close safely.

  it('13. WORKING session with recent activity is NOT stopped just after cutoff', () => {
    const policy = { autoClose: true, autoCloseTime: '20:00', timezone: 'Asia/Kolkata' };
    const cutoff = buildCompanyDateTimeUtc('2026-06-04', '20:00', 'Asia/Kolkata');
    const now = new Date(cutoff.getTime() + 2 * 60000); // 2 min after cutoff
    const user = { role: { name: 'EMPLOYEE' }, lastActiveAt: new Date(now.getTime() - 1 * 60000) }; // active 1 min ago
    const session = { logoutAt: null, status: 'WORKING' };

    const res = shouldPolicyAutoStop(session, user, policy, now, '2026-06-04', '2026-06-04');
    expect(res.shouldStop).toBe(false);
  });

  it('14. ON_BREAK session with recent activity is NOT stopped just after cutoff', () => {
    const policy = { autoClose: true, autoCloseTime: '20:00', timezone: 'Asia/Kolkata' };
    const cutoff = buildCompanyDateTimeUtc('2026-06-04', '20:00', 'Asia/Kolkata');
    const now = new Date(cutoff.getTime() + 5 * 60000);
    const user = { role: { name: 'EMPLOYEE' }, lastActiveAt: new Date(now.getTime() - 3 * 60000) };
    const session = { logoutAt: null, status: 'ON_BREAK' };

    const res = shouldPolicyAutoStop(session, user, policy, now, '2026-06-04', '2026-06-04');
    expect(res.shouldStop).toBe(false);
  });

  it('15. WORKING session past the grace window with no activity IS stopped (abandoned-session safety net)', () => {
    const policy = { autoClose: true, autoCloseTime: '20:00', timezone: 'Asia/Kolkata' };
    const cutoff = buildCompanyDateTimeUtc('2026-06-04', '20:00', 'Asia/Kolkata');
    const now = new Date(cutoff.getTime() + (AUTO_CLOSE_GRACE_MINUTES + 5) * 60000);
    const user = { role: { name: 'EMPLOYEE' }, lastActiveAt: new Date(cutoff.getTime() - 5 * 60000) }; // last seen before cutoff
    const session = { logoutAt: null, status: 'WORKING' };

    const res = shouldPolicyAutoStop(session, user, policy, now, '2026-06-04', '2026-06-04');
    expect(res.shouldStop).toBe(true);
    expect(res.cutoffUtc).toBeDefined();
  });

  it('16. IDLE session past cutoff is stopped even with a status field present (grace only applies to WORKING/ON_BREAK)', () => {
    const policy = { autoClose: true, autoCloseTime: '20:00', timezone: 'Asia/Kolkata' };
    const cutoff = buildCompanyDateTimeUtc('2026-06-04', '20:00', 'Asia/Kolkata');
    const now = new Date(cutoff.getTime() + 2 * 60000);
    const user = { role: { name: 'EMPLOYEE' }, lastActiveAt: new Date(now.getTime() - 1 * 60000) };
    const session = { logoutAt: null, status: 'IDLE' };

    const res = shouldPolicyAutoStop(session, user, policy, now, '2026-06-04', '2026-06-04');
    expect(res.shouldStop).toBe(true);
  });

  it('17. WORKING session with no lastActiveAt at all past cutoff is stopped (fail safe, not fail open)', () => {
    const policy = { autoClose: true, autoCloseTime: '20:00', timezone: 'Asia/Kolkata' };
    const cutoff = buildCompanyDateTimeUtc('2026-06-04', '20:00', 'Asia/Kolkata');
    const now = new Date(cutoff.getTime() + 2 * 60000);
    const user = { role: { name: 'EMPLOYEE' } }; // no lastActiveAt
    const session = { logoutAt: null, status: 'WORKING' };

    const res = shouldPolicyAutoStop(session, user, policy, now, '2026-06-04', '2026-06-04');
    expect(res.shouldStop).toBe(true);
  });
});
