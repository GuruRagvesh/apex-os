'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { usersApi } from '@apex/core-users/api';
import { DEFAULT_TEAM_PREFERENCES, readTeamPreferences, type TeamPreferences } from '@apex/intelligence-dashboard';

export function TeamLeadershipSection() {
  const [preferences, setPreferences] = useState<TeamPreferences>(DEFAULT_TEAM_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    usersApi.getPreferences()
      .then((result: any) => { if (mounted) setPreferences(readTeamPreferences(result?.teamSettings)); })
      .catch(() => { if (mounted) toast.error('Team preferences could not be loaded'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const update = <K extends keyof TeamPreferences>(key: K, value: TeamPreferences[K]) =>
    setPreferences((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await usersApi.updatePreferences({ teamSettings: preferences });
      toast.success('Team preferences saved');
    } catch (error: any) {
      toast.error(error?.message || 'Team preferences could not be saved');
    } finally {
      setSaving(false);
    }
  };

  return <section className="apex-card space-y-5 p-6">
    <div>
      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Team preferences</h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Choose how team insights appear for you. These preferences do not change access, reporting lines or approval authority.</p>
    </div>
    <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
      <label className="flex items-center justify-between gap-5 py-4">
        <span>
          <span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Show team overview on Home</span>
          <span className="mt-0.5 block text-xs" style={{ color: 'var(--text-tertiary)' }}>Display availability, workload and team delivery signals on your dashboard.</span>
        </span>
        <input type="checkbox" checked={preferences.showTeamOverview} disabled={loading} onChange={(event) => update('showTeamOverview', event.target.checked)} />
      </label>
      <label className="flex items-center justify-between gap-5 py-4">
        <span>
          <span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Highlight approaching service targets</span>
          <span className="mt-0.5 block text-xs" style={{ color: 'var(--text-tertiary)' }}>Emphasize tickets that are approaching or have exceeded their response target.</span>
        </span>
        <input type="checkbox" checked={preferences.highlightApproachingSla} disabled={loading} onChange={(event) => update('highlightApproachingSla', event.target.checked)} />
      </label>
      <label className="flex items-center justify-between gap-5 py-4">
        <span>
          <span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Dashboard density</span>
          <span className="mt-0.5 block text-xs" style={{ color: 'var(--text-tertiary)' }}>Choose the spacing used by team dashboards and data tables.</span>
        </span>
        <select className="apex-input max-w-48" value={preferences.dashboardDensity} disabled={loading} onChange={(event) => update('dashboardDensity', event.target.value as TeamPreferences['dashboardDensity'])}>
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </label>
    </div>
    <button type="button" onClick={save} disabled={loading || saving} className="apex-btn-primary rounded-lg px-5 py-2 text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save preferences'}</button>
  </section>;
}
