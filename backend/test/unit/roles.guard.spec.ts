/**
 * Unit tests — RolesGuard
 *
 * Verifies that the guard correctly allows/blocks requests based on the
 * required roles metadata and the user's role stored on the request object.
 * No HTTP server or database is needed.
 */
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from '../../src/shared/guards/roles.guard';
import { ROLES_KEY } from '../../src/shared/decorators/roles.decorator';

function makeContext(userRole: string | null, requiredRoles: string[] | undefined): ExecutionContext {
  const request = { user: userRole ? { role: { name: userRole } } : undefined };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows access when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = makeContext('EMPLOYEE', undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows ADMIN when ADMIN is required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const ctx = makeContext('ADMIN', ['ADMIN']);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows SUPER_ADMIN when ADMIN or SUPER_ADMIN is required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN', 'SUPER_ADMIN']);
    const ctx = makeContext('SUPER_ADMIN', ['ADMIN', 'SUPER_ADMIN']);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('blocks EMPLOYEE when ADMIN is required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const ctx = makeContext('EMPLOYEE', ['ADMIN']);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('blocks MANAGER when ADMIN or SUPER_ADMIN is required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN', 'SUPER_ADMIN']);
    const ctx = makeContext('MANAGER', ['ADMIN', 'SUPER_ADMIN']);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('blocks unauthenticated user (no user on request)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
    const ctx = makeContext(null, ['ADMIN']);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('allows MANAGER when MANAGER is in the required list', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['MANAGER', 'ADMIN', 'SUPER_ADMIN']);
    const ctx = makeContext('MANAGER', ['MANAGER', 'ADMIN', 'SUPER_ADMIN']);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('blocks INTERN from manager-level routes', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['MANAGER', 'ADMIN', 'SUPER_ADMIN']);
    const ctx = makeContext('INTERN', ['MANAGER', 'ADMIN', 'SUPER_ADMIN']);
    expect(guard.canActivate(ctx)).toBe(false);
  });
});
