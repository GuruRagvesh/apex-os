'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UnifiedReviewQueue } from './UnifiedReviewQueue';
import { getUnifiedReviewCounts } from './review-queue-api';

function initialScope(): 'team' | 'company' {
  if (typeof window === 'undefined') return 'team';
  const params = new URLSearchParams(window.location.search);
  const value = params.get('scope') ?? params.get('mode');
  return value === 'company' || value === 'hr' ? 'company' : 'team';
}

/** The existing corrections surface, embedded inside Attendance Console. */
export function AttendanceReviewsPanel() {
  const [scope, setScope] = useState<'team' | 'company'>(initialScope);
  const counts = useQuery({
    queryKey: ['unified-review-counts'],
    queryFn: getUnifiedReviewCounts,
    retry: false,
  });
  const canCompany = counts.data?.canViewCompany === true;
  const effective = scope === 'company' && !canCompany ? 'team' : scope;

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="tablist" aria-label="Correction queue scope">
        <button
          type="button"
          role="tab"
          aria-selected={effective === 'team'}
          onClick={() => setScope('team')}
          className={effective === 'team' ? 'apex-btn apex-btn-primary' : 'apex-btn apex-btn-secondary'}
        >
          My team{counts.data ? ` (${counts.data.team})` : ''}
        </button>
        {canCompany && (
          <button
            type="button"
            role="tab"
            aria-selected={effective === 'company'}
            onClick={() => setScope('company')}
            className={effective === 'company' ? 'apex-btn apex-btn-primary' : 'apex-btn apex-btn-secondary'}
          >
            Company pending{counts.data?.company != null ? ` (${counts.data.company})` : ''}
          </button>
        )}
      </div>
      <UnifiedReviewQueue scope={effective} />
    </div>
  );
}
