'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { usersApi } from '@apex/core-users/api';
import { DEFAULT_TEAM_PREFERENCES, readTeamPreferences, type TeamPreferences } from '@apex/intelligence-dashboard';

const SECTIONS = [
  { id: 'dashboard', title: 'Dashboard Preferences' },
  { id: 'projects', title: 'Projects' },
  { id: 'availability', title: 'Team Availability' },
  { id: 'leave', title: 'Leave Approvals' },
  { id: 'reports', title: 'Reports & Digest' },
] as const;
type SectionId = typeof SECTIONS[number]['id'];

export function TeamLeadershipSection() {
  const [expanded, setExpanded] = useState<SectionId[]>(['dashboard']);
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
  const toggle = (id: SectionId) => setExpanded((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]);
  const save = async () => {
    setSaving(true);
    try {
      await usersApi.updatePreferences({ teamSettings: preferences });
      toast.success('Team display preferences saved');
    } catch (error: any) {
      toast.error(error?.message || 'Team preferences could not be saved');
    } finally {
      setSaving(false);
    }
  };

  return <div className="space-y-4">
    <div>
      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Team & Leadership</h2>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>These choices change your display only. They do not change team access or approval authority.</p>
    </div>
    <div className="flex gap-3 text-sm">
      <button type="button" onClick={() => setExpanded(SECTIONS.map((section) => section.id))} style={{ color: 'var(--accent)' }}>Expand all</button>
      <button type="button" onClick={() => setExpanded([])} style={{ color: 'var(--accent)' }}>Collapse all</button>
    </div>
    {SECTIONS.map((section) => <section key={section.id} className="apex-card overflow-hidden">
      <h3><button type="button" onClick={() => toggle(section.id)} aria-expanded={expanded.includes(section.id)}
        className="flex w-full items-center justify-between p-5 text-left text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        {section.title}<span aria-hidden="true">{expanded.includes(section.id) ? '−' : '+'}</span>
      </button></h3>
      {expanded.includes(section.id) && <div className="space-y-4 border-t px-5 py-5 text-sm" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
        {section.id === 'dashboard' ? <>
          <label className="flex items-center justify-between gap-4"><span>Show Team Overview on Home</span><input type="checkbox" checked={preferences.showTeamOverview} disabled={loading} onChange={(event) => update('showTeamOverview', event.target.checked)} /></label>
          <label className="flex items-center justify-between gap-4"><span>Highlight breached SLAs</span><input type="checkbox" checked={preferences.highlightApproachingSla} disabled={loading} onChange={(event) => update('highlightApproachingSla', event.target.checked)} /></label>
          <label className="flex items-center justify-between gap-4"><span>Dashboard density</span><select className="apex-input max-w-48" value={preferences.dashboardDensity} disabled={loading} onChange={(event) => update('dashboardDensity', event.target.value as TeamPreferences['dashboardDensity'])}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
        </> : <p>These display options are proposed. The current {section.title.toLowerCase()} screen has no verified preference integration yet, so no save control is enabled here.</p>}
      </div>}
    </section>)}
    <button type="button" onClick={save} disabled={loading || saving} className="apex-btn-primary rounded-lg px-5 py-2 text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save Team Preferences'}</button>
  </div>;
}
