'use client';

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, ArrowRightLeft, CheckCircle2, Clock3, UsersRound } from 'lucide-react';
import { usersApi } from '@apex/core-users/api';
import { DEFAULT_TEAM_PREFERENCES, readTeamPreferences, type TeamPreferences } from '@apex/intelligence-dashboard';

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange}
    className="relative h-6 w-11 flex-none rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
    style={{ backgroundColor: checked ? 'var(--accent)' : 'var(--bg-tertiary)', border: '1px solid var(--border-primary)' }}>
    <span className="absolute top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow transition-transform" style={{ left: checked ? 'calc(100% - 1.25rem)' : '0.2rem' }} />
  </button>;
}

function Rule({ title, description, checked, disabled, onChange }: { title: string; description: string; checked: boolean; disabled: boolean; onChange: () => void }) {
  return <div className="flex items-start justify-between gap-5 py-4">
    <div>
      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{title}</p>
      <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-tertiary)' }}>{description}</p>
    </div>
    <Toggle checked={checked} disabled={disabled} onChange={onChange} label={title} />
  </div>;
}

export function TeamLeadershipSection() {
  const [preferences, setPreferences] = useState<TeamPreferences>(DEFAULT_TEAM_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    usersApi.getPreferences()
      .then((result: any) => { if (mounted) setPreferences(readTeamPreferences(result?.teamSettings)); })
      .catch(() => { if (mounted) toast.error('Team operations could not be loaded'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const update = <K extends keyof TeamPreferences>(key: K, value: TeamPreferences[K]) =>
    setPreferences((current) => ({ ...current, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await usersApi.updatePreferences({ teamSettings: preferences });
      toast.success('Team operations saved');
    } catch (error: any) {
      toast.error(error?.message || 'Team operations could not be saved');
    } finally {
      setSaving(false);
    }
  };

  const disabled = loading || saving;
  return <section className="apex-card p-5 sm:p-7">
    <div className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-start sm:justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }}><UsersRound size={18} /></span>
        <div><h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Team operations</h2><p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>Set working rules for the team you manage.</p></div>
      </div>
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}><CheckCircle2 size={14} /> Your managed team</span>
    </div>

    <div className="mt-6 grid gap-5 xl:grid-cols-2">
      <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-card)' }}>
        <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }}><CheckCircle2 size={16} /></span><h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Work assignment</h3></div>
        <div className="mt-3 divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          <Rule title="Require an owner" description="Do not let work enter the team queue without one accountable owner." checked={preferences.requireAssignee} disabled={disabled} onChange={() => update('requireAssignee', !preferences.requireAssignee)} />
          <Rule title="Require a due date" description="Require a delivery date so the team can sequence work and identify delay." checked={preferences.requireDueDate} disabled={disabled} onChange={() => update('requireDueDate', !preferences.requireDueDate)} />
          <Rule title="Require a reassignment reason" description="Keep a record of why ownership changed when work is handed over." checked={preferences.reassignRequiresReason} disabled={disabled} onChange={() => update('reassignRequiresReason', !preferences.reassignRequiresReason)} />
        </div>
      </section>

      <section className="rounded-2xl border p-4" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-card)' }}>
        <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }}><AlertTriangle size={16} /></span><h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Capacity & escalation</h3></div>
        <div className="mt-4 space-y-4">
          <label className="block"><span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>When a teammate is at capacity</span><span className="mt-1 block text-xs leading-5" style={{ color: 'var(--text-tertiary)' }}>Choose whether assignment is warned about or stopped for review.</span><select className="apex-input mt-2 w-full" value={preferences.workloadGuardrail} disabled={disabled} onChange={(event) => update('workloadGuardrail', event.target.value as TeamPreferences['workloadGuardrail'])}><option value="warn">Warn the assigner</option><option value="block">Block until reviewed</option></select></label>
          <label className="block"><span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Escalate unattended work after</span><span className="mt-1 block text-xs leading-5" style={{ color: 'var(--text-tertiary)' }}>Escalation reminders surface work that remains unassigned or unaddressed.</span><select className="apex-input mt-2 w-full" value={preferences.escalationWindowHours} disabled={disabled} onChange={(event) => update('escalationWindowHours', Number(event.target.value) as TeamPreferences['escalationWindowHours'])}><option value={4}>4 hours</option><option value={8}>8 hours</option><option value={24}>24 hours</option></select></label>
          <Rule title="Notify me about unassigned work" description="Receive an alert when team work has no owner." checked={preferences.notifyOnUnassigned} disabled={disabled} onChange={() => update('notifyOnUnassigned', !preferences.notifyOnUnassigned)} />
        </div>
      </section>

      <section className="rounded-2xl border p-4 xl:col-span-2" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-card)' }}>
        <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }}><ArrowRightLeft size={16} /></span><h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Approval routing</h3></div>
        <div className="mt-4 max-w-xl"><label className="block"><span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>First operational approver</span><span className="mt-1 block text-xs leading-5" style={{ color: 'var(--text-tertiary)' }}>Sets the team’s preferred route. HR and organization approval authority stays unchanged.</span><select className="apex-input mt-2 w-full" value={preferences.approvalRoute} disabled={disabled} onChange={(event) => update('approvalRoute', event.target.value as TeamPreferences['approvalRoute'])}><option value="reporting_manager">Reporting manager</option><option value="team_lead">Team lead</option></select></label></div>
      </section>
    </div>

    <div className="mt-6 flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
      <p className="flex items-start gap-2 text-xs leading-5" style={{ color: 'var(--text-tertiary)' }}><Clock3 className="mt-0.5 flex-none" size={14} /> Team operations do not change company policies, roles, reporting lines, or HR approval authority.</p>
      <button type="button" onClick={save} disabled={disabled} className="apex-btn-primary rounded-lg px-5 py-2 text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save team operations'}</button>
    </div>
  </section>;
}
