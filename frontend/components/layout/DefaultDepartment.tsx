'use client';

// Department filter for Admin / Super Admin (top bar). When a department is picked, the server shows
// every page as if the chosen department were the whole company (see
// backend/src/common/services/view-scope.ts). Saved in the user's preferences,
// so it follows the account to every device.

import { usePathname } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@apex/core-identity';
import { usersApi } from '@apex/core-users/api';
import { departmentsApi, useTopBarDepartment, type TopBarDepartment } from '@apex/core-organization-departments/api';

type ViewScope = { enabled: boolean; departmentId: string | null };

// Pages whose figures stay company-wide even with a department selected.
// Inventory (by assigned employee) and Departments now follow the filter.
const COMPANY_WIDE_PAGES: Record<string, string> = {
  '/attendance/payroll': 'Payroll always covers the whole company.',
};

function useIsAdmin(): boolean {
  const { user } = useAuthStore();
  const role = (user?.role as any)?.name ?? user?.role ?? '';
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

function useViewScope(enabled: boolean) {
  const prefs = useQuery({
    queryKey: ['view-scope'],
    queryFn: () => usersApi.getPreferences() as Promise<any>,
    enabled,
    staleTime: 60_000,
  });
  const departments = useQuery({
    queryKey: ['view-scope-departments'],
    // The switcher must always offer every department.
    queryFn: () => departmentsApi.getAllCompany() as Promise<any[]>,
    enabled,
    staleTime: 300_000,
  });
  const scope: ViewScope = {
    enabled: prefs.data?.viewScope?.enabled === true,
    departmentId: prefs.data?.viewScope?.departmentId ?? null,
  };
  const list: { id: string; name: string }[] = Array.isArray(departments.data) ? departments.data : [];
  const departmentName = list.find((d) => d.id === scope.departmentId)?.name ?? null;
  return { scope, departments: list, departmentName, loading: prefs.isLoading };
}

function useSaveViewScope() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (viewScope: ViewScope) => usersApi.updatePreferences({ viewScope }),
    // Every list and figure depends on it, so refetch everything except a
    // single person's productivity timeline: it does not depend on the
    // department, and refetching it before the new people list arrives would
    // ask for a person outside the new department (403). It reloads when the
    // panel moves to the new department's first person.
    onSuccess: () => queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] !== 'productivity-timeline',
    }),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save the default department'),
  });
}

/** The department name while an admin's default department is on, else null. */
export function useActiveViewDepartmentName(): string | null {
  return useActiveViewDepartment()?.name ?? null;
}

/**
 * The top-bar department while an admin has one selected, else null.
 * Page-level department filters lock to it and people pickers list only its
 * people; the server applies the same narrowing (view-scope.ts).
 */
export function useActiveViewDepartment(): TopBarDepartment | null {
  return useTopBarDepartment(useIsAdmin());
}

/**
 * Top-bar filter: "All departments" shows the whole company; picking one
 * narrows every page to that department. Admins and Super Admins only.
 */
export function DepartmentFilter() {
  const isAdmin = useIsAdmin();
  const pathname = usePathname() ?? '';
  const { scope, departments, loading } = useViewScope(isAdmin);
  const save = useSaveViewScope();
  if (!isAdmin || loading) return null;

  const value = scope.enabled && scope.departmentId ? scope.departmentId : '';
  const exception = value ? Object.entries(COMPANY_WIDE_PAGES).find(([path]) => pathname.startsWith(path))?.[1] : undefined;
  return (
    <label
      className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 border"
      style={{
        borderColor: value ? 'var(--accent)' : 'var(--border-subtle)',
        color: value ? 'var(--accent)' : 'var(--text-secondary)',
      }}
      title={exception ?? (value ? 'Every page shows only this department. You keep full admin powers.' : 'Showing the whole company')}
    >
      <Building2 size={14} aria-hidden className="flex-shrink-0" />
      <select
        aria-label="Department filter"
        className="bg-transparent text-xs font-medium outline-none cursor-pointer max-w-[7rem] sm:max-w-[10rem] truncate"
        style={{ color: 'inherit' }}
        value={value}
        disabled={save.isPending}
        onChange={(e) => save.mutate(e.target.value
          ? { enabled: true, departmentId: e.target.value }
          : { enabled: false, departmentId: scope.departmentId })}
      >
        <option value="">All departments</option>
        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </label>
  );
}
