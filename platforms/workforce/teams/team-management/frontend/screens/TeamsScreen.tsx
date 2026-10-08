'use client';

// Workforce Teams — the retired Manage Teams page.
//
// QC (Sonali 3, Shama 2): there is no standalone Teams page any more. Teams are
// created and managed inside their department (Departments → New Team, and the
// Teams container on each department). The /teams route survives only so old
// links and bookmarks land somewhere useful; it sends the person to Departments.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function TeamsScreen() {
  const router = useRouter();
  useEffect(() => { router.replace('/departments'); }, [router]);
  return (
    <div className="flex items-center justify-center h-64" role="status" aria-label="Opening Departments">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--accent)' }} />
    </div>
  );
}
