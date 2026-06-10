/**
 * Unit tests — AuthService OTP logic
 *
 * Tests OTP generation, email dispatch, and reset-password flow.
 * EmailService is fully mocked to isolate AuthService behavior.
 * Prisma is fully mocked.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from '../../src/modules/core/auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventLoggerService } from '../../src/common/services/event-logger.service';
import { EmailService } from '../../src/modules/platform/email/email.service';
import * as bcrypt from 'bcryptjs';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst:  jest.fn(),
    update:     jest.fn(),
    create:     jest.fn(),
    upsert:     jest.fn(),
  },
  workSession:     { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  attendanceEvent: { create: jest.fn() },
};

const mockJwt        = { sign: jest.fn().mockReturnValue('mock-token') };
const mockConfig     = { get: jest.fn().mockReturnValue('mock-secret') };
const mockEventLogger = { log: jest.fn().mockResolvedValue(undefined) };
const mockEmailService = { sendOtpEmail: jest.fn() };

describe('AuthService — OTP', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // findFirst delegates to findUnique in the mock
    mockPrisma.user.findFirst.mockImplementation(() => mockPrisma.user.findUnique());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService,      useValue: mockPrisma       },
        { provide: JwtService,         useValue: mockJwt          },
        { provide: ConfigService,      useValue: mockConfig       },
        { provide: EventLoggerService, useValue: mockEventLogger  },
        { provide: EmailService,       useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ── sendOtp — known user ────────────────────────────────────────────────────

  it('generates OTP and sends email for existing user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: '1', email: 'test@apex.local', isActive: true });
    mockEmailService.sendOtpEmail.mockResolvedValue(undefined);

    const result = await service.sendOtp('test@apex.local');

    // Generic response returned
    expect(result.message).toContain('If an account exists');
    // Email was dispatched
    expect(mockEmailService.sendOtpEmail).toHaveBeenCalledTimes(1);
    expect(mockEmailService.sendOtpEmail).toHaveBeenCalledWith(
      'test@apex.local',
      expect.stringMatching(/^\d{6}$/),
    );
  });

  it('stores OTP in memory after successful email dispatch', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: '1', email: 'test@apex.local', isActive: true });
    mockEmailService.sendOtpEmail.mockResolvedValue(undefined);

    await service.sendOtp('test@apex.local');

    const otpStore: Map<string, any> = (service as any).otpStore;
    const entry = otpStore.get('test@apex.local');
    expect(entry).toBeDefined();
    expect(entry.otp).toMatch(/^\d{6}$/);
    expect(entry.expires).toBeGreaterThan(Date.now());
  });

  // ── sendOtp — unknown user (no enumeration) ─────────────────────────────────

  it('returns generic response for unknown user without throwing', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const result = await service.sendOtp('ghost@apex.local');

    // Generic response — same shape as success
    expect(result.message).toContain('If an account exists');
    // No OTP stored for unknown email
    const otpStore: Map<string, any> = (service as any).otpStore;
    expect(otpStore.has('ghost@apex.local')).toBe(false);
    // Email service never called
    expect(mockEmailService.sendOtpEmail).not.toHaveBeenCalled();
  });

  // ── sendOtp — email provider failure ────────────────────────────────────────

  it('throws safe error when email provider fails, does not store OTP', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: '2', email: 'user@apex.local', isActive: true });
    mockEmailService.sendOtpEmail.mockRejectedValue(
      new BadRequestException('Email provider is not configured. Contact your administrator.'),
    );

    await expect(service.sendOtp('user@apex.local'))
      .rejects.toThrow(BadRequestException);

    // OTP must NOT be stored when delivery fails
    const otpStore: Map<string, any> = (service as any).otpStore;
    expect(otpStore.has('user@apex.local')).toBe(false);
  });

  it('does not leak OTP in exception message when provider fails', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: '2', email: 'user@apex.local', isActive: true });
    mockEmailService.sendOtpEmail.mockRejectedValue(
      new BadRequestException('Email provider is not configured. Contact your administrator.'),
    );

    let thrownMessage = '';
    try {
      await service.sendOtp('user@apex.local');
    } catch (err: any) {
      thrownMessage = err.message ?? '';
    }
    // Message must not contain a 6-digit sequence (i.e. no OTP exposed)
    expect(thrownMessage).not.toMatch(/\d{6}/);
  });

  // ── resetPasswordWithOtp ─────────────────────────────────────────────────────

  it('accepts correct OTP and resets password', async () => {
    const email = 'reset@apex.local';
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'uid1', email, isActive: true });
    mockPrisma.user.update.mockResolvedValue({ id: 'uid1' });
    mockEmailService.sendOtpEmail.mockResolvedValue(undefined);

    await service.sendOtp(email);
    const otpStore: Map<string, any> = (service as any).otpStore;
    const { otp } = otpStore.get(email);

    const result = await service.resetPasswordWithOtp(email, otp, 'NewPass@123');
    expect(result.message).toContain('reset successfully');
    // OTP consumed
    expect(otpStore.has(email)).toBe(false);
  });

  it('returns "Invalid or expired code" for unknown email on reset', async () => {
    await expect(
      service.resetPasswordWithOtp('nobody@apex.local', '123456', 'NewPass@123'),
    ).rejects.toThrow('Invalid or expired code');
  });

  it('returns "Invalid or expired code" for wrong OTP', async () => {
    const email = 'test@apex.local';
    mockPrisma.user.findUnique.mockResolvedValue({ id: '1', email, isActive: true });
    mockEmailService.sendOtpEmail.mockResolvedValue(undefined);
    await service.sendOtp(email);

    await expect(
      service.resetPasswordWithOtp(email, '000000', 'NewPass@123'),
    ).rejects.toThrow('Invalid or expired code');
  });

  it('returns "Invalid or expired code" for expired OTP', async () => {
    const email = 'expired@apex.local';
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'uid2', email, isActive: true });
    mockEmailService.sendOtpEmail.mockResolvedValue(undefined);
    await service.sendOtp(email);

    // Artificially expire the entry
    const otpStore: Map<string, any> = (service as any).otpStore;
    const entry = otpStore.get(email)!;
    otpStore.set(email, { otp: entry.otp, expires: Date.now() - 1000 });

    await expect(
      service.resetPasswordWithOtp(email, entry.otp, 'NewPass@123'),
    ).rejects.toThrow('Invalid or expired code');
  });

  it('rejects new password shorter than 8 characters', async () => {
    const email = 'short@apex.local';
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'uid3', email, isActive: true });
    mockEmailService.sendOtpEmail.mockResolvedValue(undefined);
    await service.sendOtp(email);
    const otpStore: Map<string, any> = (service as any).otpStore;
    const { otp } = otpStore.get(email)!;

    await expect(
      service.resetPasswordWithOtp(email, otp, 'short'),
    ).rejects.toThrow('8 characters');
  });
});

// ── AuthService — login ──────────────────────────────────────────────────────

describe('AuthService — login', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.user.findFirst.mockImplementation(() => mockPrisma.user.findUnique());
    mockConfig.get.mockImplementation((key: string) => {
      if (key === 'JWT_SECRET')     return 'test-secret-at-least-32-chars-long!!';
      if (key === 'JWT_EXPIRES_IN') return '24h';
      return null;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService,      useValue: mockPrisma       },
        { provide: JwtService,         useValue: mockJwt          },
        { provide: ConfigService,      useValue: mockConfig       },
        { provide: EventLoggerService, useValue: mockEventLogger  },
        { provide: EmailService,       useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('throws UnauthorizedException for inactive user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1', email: 'inactive@apex.local', isActive: false, password: 'hash',
      role: { name: 'EMPLOYEE' }, department: null,
    });
    await expect(
      service.login({ email: 'inactive@apex.local', password: 'any' }),
    ).rejects.toThrow('Invalid credentials');
  });

  it('throws UnauthorizedException for wrong password', async () => {
    const hash = await bcrypt.hash('correct-password', 10);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u2', email: 'user@apex.local', isActive: true, password: hash,
      role: { name: 'EMPLOYEE' }, department: null,
    });
    await expect(
      service.login({ email: 'user@apex.local', password: 'wrong-password' }),
    ).rejects.toThrow('Invalid credentials');
  });

  // ── Release A.2 — login must never auto-start / revive a workday ────────────

  const PASSWORD = 'correct-password';

  async function arrangeValidUser() {
    const hash = await bcrypt.hash(PASSWORD, 10);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u-login', email: 'worker@apex.local', isActive: true, password: hash,
      role: { name: 'EMPLOYEE' }, department: null,
    });
    mockPrisma.workSession.update.mockResolvedValue({ id: 'ws1' });
    mockPrisma.workSession.create.mockResolvedValue({ id: 'ws-new' });
    mockPrisma.attendanceEvent.create.mockResolvedValue({});
    mockPrisma.user.update.mockResolvedValue({});
  }

  function lastUpdateArg(): any {
    const calls = mockPrisma.workSession.update.mock.calls;
    return calls[calls.length - 1][0];
  }
  function lastCreateArg(): any {
    const calls = mockPrisma.workSession.create.mock.calls;
    return calls[calls.length - 1][0];
  }

  it('Scenario 1 — does NOT revive an ended (LOGGED_OUT) session; stays ended, no auto-start', async () => {
    await arrangeValidUser();
    mockPrisma.workSession.findFirst.mockResolvedValue({
      id: 'ws1', status: 'LOGGED_OUT', startWorkAt: new Date(), logoutAt: new Date(),
    });

    const result = await service.login({ email: 'worker@apex.local', password: PASSWORD });

    // Today's session is located by (userId, date) — NOT a userId_date unique key
    // — so the logic is safe when multiple same-day sessions exist.
    expect(mockPrisma.workSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u-login', date: expect.any(Date) } }),
    );
    // Ended state preserved — login did not flip it to LOGGED_IN / WORKING.
    expect(result.user.currentStatus).toBe('LOGGED_OUT');
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currentStatus: 'LOGGED_OUT' }) }),
    );
    // Existing session is updated by id; status / startWorkAt are never touched.
    const update = lastUpdateArg();
    expect(update.where).toEqual({ id: 'ws1' });
    expect(update.data).not.toHaveProperty('status');
    expect(update.data).not.toHaveProperty('startWorkAt');
    // No NEW session is created when one already exists for today.
    expect(mockPrisma.workSession.create).not.toHaveBeenCalled();
  });

  it('Scenario 3 — fresh user with no session is created as LOGGED_IN, never WORKING', async () => {
    await arrangeValidUser();
    mockPrisma.workSession.findFirst.mockResolvedValue(null);

    const result = await service.login({ email: 'worker@apex.local', password: PASSWORD });

    expect(result.user.currentStatus).toBe('LOGGED_IN');
    // New session is created idle-ready, never auto-started.
    const create = lastCreateArg();
    expect(create.data.status).toBe('LOGGED_IN');
    expect(create.data).not.toHaveProperty('startWorkAt');
    // The existing-session update path must not run.
    expect(mockPrisma.workSession.update).not.toHaveBeenCalled();
  });

  it('Scenario 4 — preserves an active WORKING session on login (refresh/restore), no auto-change', async () => {
    await arrangeValidUser();
    mockPrisma.workSession.findFirst.mockResolvedValue({
      id: 'ws1', status: 'WORKING', startWorkAt: new Date(),
    });

    const result = await service.login({ email: 'worker@apex.local', password: PASSWORD });

    expect(result.user.currentStatus).toBe('WORKING');
    const update = lastUpdateArg();
    // Status / startWorkAt untouched — login only stamps the latest loginAt by id.
    expect(update.where).toEqual({ id: 'ws1' });
    expect(update.data).not.toHaveProperty('status');
    expect(update.data).not.toHaveProperty('startWorkAt');
    expect(update.data).toHaveProperty('loginAt');
    expect(mockPrisma.workSession.create).not.toHaveBeenCalled();
  });

  it('Scenario 5 — preserves an ON_BREAK session on login (refresh/restore)', async () => {
    await arrangeValidUser();
    mockPrisma.workSession.findFirst.mockResolvedValue({
      id: 'ws1', status: 'ON_BREAK', startWorkAt: new Date(),
    });

    const result = await service.login({ email: 'worker@apex.local', password: PASSWORD });

    expect(result.user.currentStatus).toBe('ON_BREAK');
    const update = lastUpdateArg();
    expect(update.data).not.toHaveProperty('status');
    expect(mockPrisma.workSession.create).not.toHaveBeenCalled();
  });
});
