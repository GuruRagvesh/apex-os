import { ConflictException } from '@nestjs/common';
import { AuthService } from '../../src/modules/core/auth/auth.service';

function fixture(existingUser: unknown = null) {
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue(existingUser) },
  };
  const jwt = { sign: jest.fn().mockReturnValue('signed-token') };
  const config = {
    get: jest.fn((key: string) => (key === 'JWT_SECRET' ? 'test-secret' : undefined)),
  };
  const usersService = {
    create: jest.fn().mockResolvedValue({
      id: 'new-user',
      email: 'new.manager@example.test',
      name: 'New Manager',
      roleId: 'role-manager',
    }),
  };
  const service = new AuthService(
    prisma as any,
    jwt as any,
    config as any,
    {} as any,
    {} as any,
    usersService as any,
  );
  return { service, prisma, jwt, usersService };
}

describe('AuthService register attendance onboarding', () => {
  it('delegates guarded registration to the atomic UsersService boundary', async () => {
    const { service, usersService, jwt } = fixture();

    const result = await service.register(
      {
        name: 'New Manager',
        email: ' New.Manager@Example.Test ',
        password: 'secret123',
        roleId: 'role-manager',
        joiningDate: '2026-09-18',
      },
      'admin-1',
    );

    expect(usersService.create).toHaveBeenCalledWith(
      {
        name: 'New Manager',
        email: 'new.manager@example.test',
        password: 'secret123',
        roleId: 'role-manager',
        departmentId: null,
        joiningDate: '2026-09-18',
      },
      'admin-1',
    );
    expect(jwt.sign).toHaveBeenCalledWith(
      { sub: 'new-user', email: 'new.manager@example.test' },
      expect.objectContaining({ secret: 'test-secret' }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        accessToken: 'signed-token',
        user: expect.objectContaining({ id: 'new-user' }),
      }),
    );
  });

  it('does not call UsersService for a case-insensitive duplicate email', async () => {
    const { service, usersService } = fixture({ id: 'existing-user' });

    await expect(
      service.register({
        name: 'Duplicate',
        email: 'DUPLICATE@example.test',
        password: 'secret123',
        roleId: 'role-employee',
        joiningDate: '2026-09-18',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(usersService.create).not.toHaveBeenCalled();
  });
});
