/**
 * Phase 6E: authentication and session stability.
 *
 * C1  A wrong current password on Change Password is a bad request, not an
 *     expired session. The browser client treats every 401 as "session over"
 *     (clears the token, goes to /login?expired=true), so answering 401 here
 *     logged people out for a typo.
 * C2  The signed-in user changing (logout, login, another person) clears the
 *     browser query cache, so the next user never sees the last user's data.
 * C3  Another tab signing in as someone else, or out, never leaves this tab
 *     acting with a token that is not the one it shows.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { AuthService } from '../../src/modules/core/auth/auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventLoggerService } from '../../src/common/services/event-logger.service';
import { EmailService } from '../../src/modules/platform/email/email.service';
import { UsersService } from '../../src/modules/core/users/users.service';
import {
  createUserChangeTracker,
  tokenStorageAction,
  AUTH_TOKEN_KEY,
} from '../../../apps/web/components/session-boundary';

const mockPrisma = {
  user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  attendanceEvent: { create: jest.fn() },
};

describe('C1: wrong current password does not end the session', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: { sign: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('secret') } },
        { provide: EventLoggerService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
        { provide: EmailService, useValue: {} },
        { provide: UsersService, useValue: {} },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('answers 400 with a clear message, never 401', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', password: await bcrypt.hash('right-password', 4) });
    let caught: unknown;
    try {
      await service.changePassword('u1', 'wrong-password', 'new-password-1');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as HttpException).getStatus()).toBe(400);
    expect((caught as HttpException).message).toBe('Current password is incorrect');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('still changes the password when the current one is right', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', password: await bcrypt.hash('right-password', 4) });
    await expect(service.changePassword('u1', 'right-password', 'new-password-1')).resolves.toEqual({ message: 'Password changed successfully' });
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('invalid credentials at login stay 401 (the login page handles those itself)', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1', isActive: true, password: await bcrypt.hash('right-password', 4) });
    await expect(service.login({ email: 'a@b.c', password: 'nope' } as any)).rejects.toMatchObject({ status: 401 });
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'u2', isActive: false, password: await bcrypt.hash('right-password', 4) });
    // An inactive account gets the same safe message as a wrong password.
    await expect(service.login({ email: 'a@b.c', password: 'right-password' } as any)).rejects.toThrow('Invalid credentials');
  });
});

describe('C2: the query cache follows the signed-in user', () => {
  it('the first value seen after hydration is the baseline, not a change', () => {
    const changed = createUserChangeTracker();
    expect(changed('user-a')).toBe(false);
    expect(changed('user-a')).toBe(false);
  });

  it('logout, login and a different user each count as a change', () => {
    const changed = createUserChangeTracker();
    changed('user-a');
    expect(changed(null)).toBe(true);        // logout
    expect(changed(null)).toBe(false);
    expect(changed('user-b')).toBe(true);    // next person signs in
    expect(changed('user-a')).toBe(true);    // switch without logging out
  });

  it('undefined and null are the same signed-out state', () => {
    const changed = createUserChangeTracker();
    changed(undefined);
    expect(changed(null)).toBe(false);
  });
});

describe('C3: another tab changing the token', () => {
  const ev = (key: string | null, newValue: string | null) => ({ key, newValue });

  it('ignores keys that are not the token, and writes of the same token', () => {
    expect(tokenStorageAction(ev('apex-theme', 'dark'), 'tok-a')).toBe('ignore');
    expect(tokenStorageAction(ev('apex-auth', '{}'), 'tok-a')).toBe('ignore');
    expect(tokenStorageAction(ev(AUTH_TOKEN_KEY, 'tok-a'), 'tok-a')).toBe('ignore');
  });

  it('signs this tab out when the other tab signed out', () => {
    expect(tokenStorageAction(ev(AUTH_TOKEN_KEY, null), 'tok-a')).toBe('sign-out');
    // localStorage.clear() in another tab arrives with key null
    expect(tokenStorageAction(ev(null, null), 'tok-a')).toBe('sign-out');
  });

  it('reloads this tab when another tab signed in as someone (or anew)', () => {
    expect(tokenStorageAction(ev(AUTH_TOKEN_KEY, 'tok-b'), 'tok-a')).toBe('reload');
    expect(tokenStorageAction(ev(AUTH_TOKEN_KEY, 'tok-b'), null)).toBe('reload');
  });

  it('a signed-out tab ignores another tab signing out', () => {
    expect(tokenStorageAction(ev(AUTH_TOKEN_KEY, null), null)).toBe('ignore');
  });
});
