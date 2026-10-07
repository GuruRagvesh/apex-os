'use client';

// Workforce Teams — the retired team page.
//
// QC: a team no longer has its own page; it is managed in the Teams container
// of its department (name, lead, members, delete). /teams/:id survives only for
// old links: it opens the team's department, or Departments if the team cannot
// be read. Reading the team is a GET; nothing is changed.

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@apex/core-identity';
import { teamsApi } from '../api';

export default function TeamDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasHydrated } = useAuthStore();

  const { data: team, isError, isSuccess } = useQuery({
    queryKey: ['team', id],
    queryFn: () => teamsApi.getOne(id) as Promise<any>,
    enabled: hasHydrated && !!id,
    retry: false,
  });

  useEffect(() => {
    if (isSuccess && team?.departmentId) router.replace(`/departments/${team.departmentId}`);
    else if (isError || (isSuccess && !team?.departmentId)) router.replace('/departments');
  }, [isSuccess, isError, team, router]);

  return (
    <div className="flex items-center justify-center h-64" role="status" aria-label="Opening the team's department">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--accent)' }} />
    </div>
  );
}
