import { SetMetadata } from '@nestjs/common';
import { RoleName } from '../constants/roles';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route to one or more named roles.
 * Only accepts values from the canonical ROLES constant — compile-time typo protection.
 *
 * Usage:
 *   @Roles(ROLES.ADMIN, ROLES.SUPER_ADMIN)
 */
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);
