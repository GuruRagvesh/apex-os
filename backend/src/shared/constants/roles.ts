export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN:       'ADMIN',
  MANAGER:     'MANAGER',
  TEAM_LEAD:   'TEAM_LEAD',
  EMPLOYEE:    'EMPLOYEE',
  INTERN:      'INTERN',
} as const;

export type RoleName = typeof ROLES[keyof typeof ROLES];
