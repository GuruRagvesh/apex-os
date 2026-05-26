/**
 * Unit tests — AuthService OTP logic
 *
 * Tests the in-memory OTP store behavior: generation, expiry, wrong code,
 * and successful reset.  Prisma is fully mocked.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from '../../src/modules/core/auth/auth.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventLoggerService } from '../../src/common/services/event-logger.service';
import * as bcrypt from 'bcryptjs';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
  },
  workSession: { upsert: jest.fn() },
  attendanceEvent: { create: jest.fn() },
};

const mockJwt = { sign: jest.fn().mockReturnValue('mock-token') };
const mockConfig = { get: jest.fn().mockReturnValue('mock-secret') };
const mockEventLogger = { log: jest.fn().mockResolvedValue(undefined) };

describe('AuthService — OTP', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService,      useValue: mockPrisma      },
        { provide: JwtService,         useValue: mockJwt         },
        { provide: ConfigService,      useValue: mockConfig      },
        { provide: EventLoggerService, useValue: mockEventLogger },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('generates OTP for existing user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: '1', email: 'test@apex.local', isActive: true });
    const result = await service.sendOtp('test@apex.local');
    expect(result.message).toContain('OTP sent');
  });

  it('throws NotFoundException for non-existent user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.sendOtp('ghost@apex.local')).rejects.toThrow('User not found');
  });

  it('rejects reset with wrong OTP', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: '1', email: 'test@apex.local' });
    await service.sendOtp('test@apex.local');
    await expect(
      service.resetPasswordWithOtp('test@apex.local', '000000', 'NewPass@123'),
    ).rejects.toThrow('Invalid OTP');
  });

  it('rejects reset when no OTP was requested', async () => {
    await expect(
      service.resetPasswordWithOtp('nonotp@apex.local', '123456', 'NewPass@123'),
    ).rejects.toThrow('No OTP requested');
  });

  it('accepts correct OTP and resets password', async () => {
    const email = 'reset@apex.local';
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'uid1', email, isActive: true });
    mockPrisma.user.update.mockResolvedValue({ id: 'uid1' });

    // Trigger OTP generation
    await service.sendOtp(email);

    // Reach into the private store to read the generated OTP
    const otpStore: Map<string, { otp: string; expires: number }> =
      (service as any).otpStore;
    const entry = otpStore.get(email);
    expect(entry).toBeDefined();

    const result = await service.resetPasswordWithOtp(email, entry!.otp, 'NewPass@123');
    expect(result.message).toContain('reset successfully');
    // OTP should be consumed
    expect(otpStore.has(email)).toBe(false);
  });

  it('rejects expired OTP', async () => {
    const email = 'expired@apex.local';
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'uid2', email, isActive: true });

    await service.sendOtp(email);
    // Artificially expire the entry
    const otpStore: Map<string, { otp: string; expires: number }> =
      (service as any).otpStore;
    const entry = otpStore.get(email)!;
    otpStore.set(email, { otp: entry.otp, expires: Date.now() - 1000 });

    await expect(
      service.resetPasswordWithOtp(email, entry.otp, 'NewPass@123'),
    ).rejects.toThrow('expired');
  });

  it('rejects new password shorter than 8 characters', async () => {
    const email = 'short@apex.local';
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'uid3', email, isActive: true });
    await service.sendOtp(email);
    const otpStore: Map<string, { otp: string; expires: number }> =
      (service as any).otpStore;
    const { otp } = otpStore.get(email)!;

    await expect(
      service.resetPasswordWithOtp(email, otp, 'short'),
    ).rejects.toThrow('8 characters');
  });
});

describe('AuthService — login', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockConfig.get.mockImplementation((key: string) => {
      if (key === 'JWT_SECRET') return 'test-secret-at-least-32-chars-long!!';
      if (key === 'JWT_EXPIRES_IN') return '24h';
      return null;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService,      useValue: mockPrisma      },
        { provide: JwtService,         useValue: mockJwt         },
        { provide: ConfigService,      useValue: mockConfig      },
        { provide: EventLoggerService, useValue: mockEventLogger },
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
});
