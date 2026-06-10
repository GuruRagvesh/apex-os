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

  // ── Release A.3 — login must be fully decoupled from WorkSession ────────────

  const PASSWORD = 'correct-password';

  // A valid, authenticatable user whose currentStatus mirrors whatever the last
  // workday action persisted. Login must return this unchanged and must never
  // read or write any WorkSession row.
  async function arrangeValidUser(currentStatus: string) {
    const hash = await bcrypt.hash(PASSWORD, 10);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u-login', email: 'worker@apex.local', isActive: true, password: hash,
      currentStatus, role: { name: 'EMPLOYEE' }, department: null,
    });
    mockPrisma.attendanceEvent.create.mockResolvedValue({});
    mockPrisma.user.update.mockResolvedValue({});
  }

  function expectNoWorkSessionWrites() {
    expect(mockPrisma.workSession.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.workSession.update).not.toHaveBeenCalled();
    expect(mockPrisma.workSession.create).not.toHaveBeenCalled();
  }

  it('Test 1 — login with NO WorkSession today does not create a WorkSession', async () => {
    await arrangeValidUser('OFFLINE');

    const result = await service.login({ email: 'worker@apex.local', password: PASSWORD });

    // Start Work is the only creator — login never makes a row.
    expectNoWorkSessionWrites();
    // User keeps its real (non-working) status; login does not invent LOGGED_IN.
    expect(result.user.currentStatus).toBe('OFFLINE');
    // Only auth metadata is written — never WorkSession-derived fields.
    const userUpdate = mockPrisma.user.update.mock.calls[0]?.[0];
    expect(userUpdate.data).toEqual({ lastActiveAt: expect.any(Date) });
    expect(userUpdate.data).not.toHaveProperty('currentStatus');
  });

  it('Test 2 — login with a LOGGED_OUT (ended) session does not update or create a WorkSession', async () => {
    await arrangeValidUser('LOGGED_OUT');

    const result = await service.login({ email: 'worker@apex.local', password: PASSWORD });

    expectNoWorkSessionWrites();
    // Ended stays ended — no revive, no new LOGGED_IN row in history.
    expect(result.user.currentStatus).toBe('LOGGED_OUT');
  });

  it('Test 3 — login with a WORKING session does not update or create a WorkSession', async () => {
    await arrangeValidUser('WORKING');

    const result = await service.login({ email: 'worker@apex.local', password: PASSWORD });

    expectNoWorkSessionWrites();
    expect(result.user.currentStatus).toBe('WORKING');
  });

  it('Test 4 — login with an ON_BREAK session does not update or create a WorkSession', async () => {
    await arrangeValidUser('ON_BREAK');

    const result = await service.login({ email: 'worker@apex.local', password: PASSWORD });

    expectNoWorkSessionWrites();
    expect(result.user.currentStatus).toBe('ON_BREAK');
  });

  it('records a LOGIN audit event and refreshes lastActiveAt without touching WorkSession', async () => {
    await arrangeValidUser('WORKING');

    await service.login({ email: 'worker@apex.local', password: PASSWORD });

    expect(mockPrisma.attendanceEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: 'LOGIN' }) }),
    );
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u-login' }, data: { lastActiveAt: expect.any(Date) } }),
    );
    expectNoWorkSessionWrites();
  });
});
