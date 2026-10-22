'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RegularizationQueue } from '@/components/attendance/RegularizationQueue';
import { getRegularizationCounts } from '@/components/attendance/regularization-api';
import { HeldRegularizations } from '@/components/attendance/HeldRegularizations';
function initialScope(): 'team' | 'company' { if (typeof window === 'undefined') return 'team'; const p = new URLSearchParams(window.location.search); const value = p.get('scope') ?? p.get('mode'); return value === 'company' || value === 'hr' ? 'company' : 'team'; }
export default function AttendanceReviewsPage() {
  const [scope, setScope] = useState<'team' | 'company'>(initialScope);
  const counts = useQuery({ queryKey: ['regularization-counts'], queryFn: getRegularizationCounts, retry: false });
  const canCompany = counts.data?.canViewCompany === true;
  const effective = scope === 'company' && !canCompany ? 'team' : scope;
  return <div className="space-y-4"><div><h1 className="apex-page-title apex-text text-xl">Attendance corrections</h1><p className="apex-text-muted mt-1 text-sm">One eligible Team Lead, Manager, HR or administrator can make the final decision.</p></div><div className="flex gap-2" role="tablist" aria-label="Correction queue scope"><button type="button" role="tab" aria-selected={effective === 'team'} onClick={() => setScope('team')} className={effective === 'team' ? 'apex-btn apex-btn-primary' : 'apex-btn apex-btn-secondary'}>My team{counts.data ? ` (${counts.data.team})` : ''}</button>{canCompany && <button type="button" role="tab" aria-selected={effective === 'company'} onClick={() => setScope('company')} className={effective === 'company' ? 'apex-btn apex-btn-primary' : 'apex-btn apex-btn-secondary'}>Company pending{counts.data?.company != null ? ` (${counts.data.company})` : ''}</button>}</div>{effective === 'company' && canCompany && <HeldRegularizations />}<RegularizationQueue scope={effective} /></div>;
}
