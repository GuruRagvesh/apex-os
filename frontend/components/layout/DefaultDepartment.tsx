'use client';

// Default department for Admin / Super Admin. When it is on, the server shows
// every page as if the chosen department were the whole company (see
// backend/src/common/services/view-scope.ts). Saved in the user's preferences,
// so it follows the account to every device.

import { usePathname } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth.store';
import { usersApi } from '@apex/core-users/api';
import { departmentsApi } from '@apex/core-organization-departments/api';

type ViewScope = { enabled: boolean; departmentId: string | null };

// Pages whose figures stay company-wide even with a default department.
const COMPANY_WIDE_PAGES: Record<string, string> = {
  '/attendance/payroll': 'Payroll always covers the whole company.',
  '/assets': 'Inventory is not linked to departments, so it shows the whole company.',
  '/departments': 'Departments always lists every department.',
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
    queryFn: () => departmentsApi.getAll() as Promise<any[]>,
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
    // Every list and figure depends on it, so refetch everything.
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Could not save the default department'),
  });
}

/** The department name while an admin's default department is on, else null. */
export function useActiveViewDepartmentName(): string | null {
  const isAdmin = useIsAdmin();
  const { scope, departmentName } = useViewScope(isAdmin);
  return isAdmin && scope.enabled ? departmentName ?? 'one department' : null;
}

/** Home card: pick a department and switch the narrowed view on or off. */
export function DefaultDepartmentCard() {
  const isAdmin = useIsAdmin();
  const { scope, departments, loading } = useViewScope(isAdmin);
  const save = useSaveViewScope();
  if (!isAdmin || loading) return null;

  const pending = save.isPending;
  return (
    <section className="apex-card p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3" aria-label="Default department">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Building2 size={18} style={{ color: 'var(--accent)' }} aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Default department</p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            When on, every page shows only this department. You keep full admin powers.
          </p>
        </div>
      </div>
      <select
        className="apex-input sm:w-56"
        aria-label="Department"
        value={scope.departmentId ?? ''}
        disabled={pending}
        onChange={(e) => save.mutate({ enabled: scope.enabled && !!e.target.value, departmentId: e.target.value || null })}
      >
        <option value="">Choose a department</option>
        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <button
        type="button"
        role="switch"
        aria-checked={scope.enabled}
        aria-label="Use default department"
        disabled={pending || !scope.departmentId}
        onClick={() => save.mutate({ enabled: !scope.enabled, departmentId: scope.departmentId })}
        className="relative w-10 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50"
        style={{ backgroundColor: scope.enabled ? 'var(--accent)' : 'var(--bg-tertiary)' }}
      >
        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${scope.enabled ? 'left-5' : 'left-1'}`} />
      </button>
    </section>
  );
}

/** Slim notice on every page while the default department is on. */
export function DefaultDepartmentBanner() {
  const isAdmin = useIsAdmin();
  const pathname = usePathname() ?? '';
  const { scope, departmentName } = useViewScope(isAdmin);
  const save = useSaveViewScope();
  if (!isAdmin || !scope.enabled || !scope.departmentId) return null;

  const exception = Object.entries(COMPANY_WIDE_PAGES).find(([path]) => pathname.startsWith(path))?.[1];
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 sm:px-6 py-1.5 text-xs border-b"
      style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
    >
      <span>
        Viewing <strong style={{ color: 'var(--text-primary)' }}>{departmentName ?? 'one department'}</strong> only.
        {exception ? ` ${exception}` : ''}
      </span>
      <button
        type="button"
        className="underline"
        style={{ color: 'var(--accent)' }}
        disabled={save.isPending}
        onClick={() => save.mutate({ enabled: false, departmentId: scope.departmentId })}
      >
        Show whole company
      </button>
    </div>
  );
}
