'use client';

// The top-bar department filter (Admin / Super Admin), readable from any page.
//
// While a department is selected the server narrows every company-data list to
// it (backend/src/common/services/view-scope.ts). Pages use this hook to keep
// their own controls in step: a page-level department filter locks to it, and a
// person picker that defaults to one person starts with that department's first
// person. Shares the `view-scope` cache with the switcher in the top bar, so a
// change there updates every page at once.

import { useQuery } from '@tanstack/react-query';
import { api, unwrap as r } from '@apex/shared-auth';
import { departmentsApi } from './departments-api';

export interface TopBarDepartment {
  id: string;
  name: string;
}

/**
 * The department selected in the top bar, or null for the whole company.
 * Pass `enabled: false` for people who cannot use the filter (non-admins);
 * the server refuses to store a selection for them anyway.
 */
export function useTopBarDepartment(enabled = true): TopBarDepartment | null {
  const prefs = useQuery({
    queryKey: ['view-scope'],
    queryFn: () => r(api.get('/users/me/preferences')) as Promise<any>,
    enabled,
    staleTime: 60_000,
  });
  const scope = prefs.data?.viewScope;
  const departmentId: string | null = enabled && scope?.enabled === true && typeof scope.departmentId === 'string'
    ? scope.departmentId
    : null;
  const departments = useQuery({
    queryKey: ['view-scope-departments'],
    queryFn: () => departmentsApi.getAllCompany() as Promise<any[]>,
    enabled: Boolean(departmentId),
    staleTime: 300_000,
  });
  if (!departmentId) return null;
  const list: { id: string; name: string }[] = Array.isArray(departments.data) ? departments.data : [];
  return { id: departmentId, name: list.find((d) => d.id === departmentId)?.name ?? 'the selected department' };
}

/** Tooltip for a page filter the top-bar department has locked. */
export function lockedByTopBarHint(name: string): string {
  return `Set by the department filter in the top bar (${name}). Choose "All departments" there to change it.`;
}
