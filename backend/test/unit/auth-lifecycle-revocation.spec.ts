import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../src/modules/core/auth/auth.service';
import { JwtStrategy } from '../../src/modules/core/auth/strategies/jwt.strategy';

// Archive, rehire and permanent deletion must end every earlier session and
// every earlier password-reset code. A code or token issued to the old account
// must never work for a rehired or a newly created account with the same email.

describe('JWT revocation', () => {
  const build = (user: any) => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
    const config = { get: jest.fn().mockReturnValue('secret') };
    return new JwtStrategy(config as any, prisma as any);
  };
  const revokedAt = new Date('2026-10-13T06:00:00Z');
  const sec = (d: Date) => Math.floor(d.getTime() / 1000);

  it('rejects a token issued before sessionsRevokedAt and accepts one issued after', async () => {
    const user = { id: 'u1', isActive: true, isSystemAccount: false, sessionsRevokedAt: revokedAt, password: 'h' };
    await expect(build(user).validate({ sub: 'u1', email: 'a@x', iat: sec(revokedAt) - 60 })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(build(user).validate({ sub: 'u1', email: 'a@x' })).rejects.toBeInstanceOf(UnauthorizedException);
    const ok: any = await build(user).validate({ sub: 'u1', email: 'a@x', iat: sec(revokedAt) + 5 });
    expect(ok.id).toBe('u1');
    expect(ok.password).toBeUndefined();
  });

  it('rejects the system account and a deleted user', async () => {
    await expect(build({ id: 's', isActive: true, isSystemAccount: true }).validate({ sub: 's', email: 'x', iat: 1 })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(build(null).validate({ sub: 'gone', email: 'x', iat: 1 })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('password-reset codes are bound to the account that requested them', () => {
  function build() {
    const state: { user: any } = { user: null };
    const prisma = {
      user: { findFirst: jest.fn(async () => state.user), update: jest.fn(async () => ({})) },
      attendanceEvent: { create: jest.fn() },
    };
    const email = { sendOtpEmail: jest.fn(async () => undefined) };
    const svc = new AuthService(prisma as any, { sign: jest.fn() } as any, { get: jest.fn() } as any, { log: jest.fn() } as any, email as any, {} as any);
    const sentCode = () => (email.sendOtpEmail.mock.calls as any[]).at(-1)[1] as string;
    return { svc, prisma, state, sentCode };
  }
  const PASSWORD = 'new-password-1';

  it('works once for the same active account', async () => {
    const { svc, prisma, state, sentCode } = build();
    state.user = { id: 'u1', email: 'a@example.test', isActive: true, isSystemAccount: false, sessionsRevokedAt: null };
    await svc.sendOtp('a@example.test');
    await svc.resetPasswordWithOtp('a@example.test', sentCode(), PASSWORD);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    await expect(svc.resetPasswordWithOtp('a@example.test', sentCode(), PASSWORD)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never resets a NEW account that took over the email after deletion', async () => {
    const { svc, prisma, state, sentCode } = build();
    state.user = { id: 'old', email: 'a@example.test', isActive: true, isSystemAccount: false, sessionsRevokedAt: null };
    await svc.sendOtp('a@example.test');
    state.user = { id: 'new', email: 'a@example.test', isActive: true, isSystemAccount: false, sessionsRevokedAt: null };
    await expect(svc.resetPasswordWithOtp('a@example.test', sentCode(), PASSWORD)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('never resets after the account was archived or rehired (sessions revoked after issue)', async () => {
    const { svc, prisma, state, sentCode } = build();
    state.user = { id: 'u1', email: 'a@example.test', isActive: true, isSystemAccount: false, sessionsRevokedAt: null };
    await svc.sendOtp('a@example.test');
    state.user = { ...state.user, sessionsRevokedAt: new Date(Date.now() + 1000) };
    await expect(svc.resetPasswordWithOtp('a@example.test', sentCode(), PASSWORD)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('sends no code to an inactive or system account', async () => {
    const { svc, state } = build();
    const email = (svc as any).emailService;
    state.user = { id: 'u1', email: 'a@example.test', isActive: false, isSystemAccount: false };
    await svc.sendOtp('a@example.test');
    state.user = { id: 's', email: 'deleted-account@system.invalid', isActive: true, isSystemAccount: true };
    await svc.sendOtp('deleted-account@system.invalid');
    expect(email.sendOtpEmail).not.toHaveBeenCalled();
  });
});
