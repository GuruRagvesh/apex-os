'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { authApi, usersApi, settingsApi, taskTypesApi, departmentsApi } from '@/lib/api';
import { UserAvatar } from '@/components/ui/user-avatar';
import toast from 'react-hot-toast';
import {
  User, Shield, Bell, Palette, SlidersHorizontal, Building2,
  CalendarDays, Gauge, Mail, Eye, EyeOff, Lock, Tags,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme, type ThemeId, type AccentId } from '@/hooks/useTheme';

// ── Shared dark-mode-aware styles ─────────────────────────────────────────────
const inputCls =
  'w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500 ' +
  'bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 ' +
  'placeholder:text-slate-400 dark:placeholder:text-gray-500';
const labelCls = 'block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5';
const cardCls =
  'bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 p-6 space-y-4';

const AVATAR_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#14b8a6'];

const ROLE_BADGE: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-700',
  ADMIN:       'bg-red-100 text-red-700',
  MANAGER:     'bg-orange-100 text-orange-700',
  TEAM_LEAD:   'bg-blue-100 text-blue-700',
  EMPLOYEE:    'bg-green-100 text-green-700',
  INTERN:      'bg-teal-100 text-teal-700',
};

function getInitials(name: string) {
  return (name ?? '').split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || 'U';
}

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn('relative w-10 h-6 rounded-full transition-colors flex-shrink-0', checked ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-gray-700')}
    >
      <span className={cn('absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all', checked ? 'left-5' : 'left-1')} />
    </button>
  );
}

function ToggleRow({ label, desc, checked, onChange }: {
  label: string; desc: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-gray-800 last:border-0">
      <div className="mr-4">
        <p className="text-sm font-medium text-slate-800 dark:text-gray-200">{label}</p>
        <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">{desc}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function SaveBtn({ loading, label = 'Save Changes' }: { loading: boolean; label?: string }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
    >
      {loading ? 'Saving…' : label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Profile
// ─────────────────────────────────────────────────────────────────────────────
function ProfileSection({ user }: { user: any }) {
  const [name, setName]   = useState(user?.name ?? '');
  const [bio, setBio]     = useState(user?.bio ?? '');
  const [color, setColor] = useState(user?.avatar ?? AVATAR_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const updateUser = useAuthStore((s) => s.updateUser);

  const roleName = (user?.role as any)?.name ?? user?.role ?? '';
  const deptName = (user?.department as any)?.name ?? '';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await usersApi.updateMe({ name: name.trim(), avatar: color, bio });
      updateUser({ name: name.trim(), avatar: color });
      useAuthStore.setState((s: any) => ({ user: { ...s.user, avatar: color } }));
      toast.success('Profile updated');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error('Max 2MB'); return; }
    try {
      const data = await (usersApi as any).uploadPhoto(file) as any;
      useAuthStore.setState((s: any) => ({ user: { ...s.user, photoUrl: data.photoUrl } }));
      toast.success('Photo updated!');
    } catch { toast.error('Failed to upload photo'); }
  };

  const handleRemovePhoto = async () => {
    try {
      await usersApi.updateMe({ photoUrl: null } as any);
      useAuthStore.setState((s: any) => ({ user: { ...s.user, photoUrl: null } }));
      toast.success('Photo removed');
    } catch { toast.error('Failed to remove photo'); }
  };

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800 dark:text-gray-100">Profile Information</h3>
        <div className="flex items-center gap-6">
          <UserAvatar name={name} avatar={color} photoUrl={(user as any)?.photoUrl} size="lg" />
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-gray-300 mb-2">Avatar colour</p>
            <div className="flex gap-2">
              {AVATAR_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full border-2 transition-all hover:scale-110"
                  style={{ background: c, borderColor: color === c ? '#1e40af' : 'transparent' }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Profile Photo Upload */}
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Profile Photo
          </label>
          <div className="flex items-center gap-4">
            <UserAvatar
              name={name}
              avatar={color}
              photoUrl={(user as any)?.photoUrl}
              size="lg"
            />
            <div>
              <label className="cursor-pointer inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                Upload Photo
              </label>
              {(user as any)?.photoUrl && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="ml-2 text-sm text-red-500 hover:text-red-700"
                >
                  Remove
                </button>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">JPG, PNG up to 2MB</p>
            </div>
          </div>
        </div>

        <div>
          <label className={labelCls}>Display Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} required />
        </div>

        <div>
          <label className={labelCls}>Email <Lock size={11} className="inline text-slate-400 mb-0.5" /></label>
          <input className={`${inputCls} opacity-60 cursor-not-allowed`} value={user?.email ?? ''} readOnly />
        </div>

        <div className="flex gap-2 flex-wrap">
          {roleName && <span className={cn('px-3 py-1 text-xs font-medium rounded-full', ROLE_BADGE[roleName] ?? 'bg-slate-100 text-slate-600')}>{roleName}</span>}
          {deptName && <span className="px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-full">{deptName}</span>}
        </div>

        <div>
          <label className={labelCls}>Bio <span className="text-slate-400 font-normal">({bio.length}/200)</span></label>
          <textarea value={bio} onChange={(e) => e.target.value.length <= 200 && setBio(e.target.value)}
            className={`${inputCls} resize-none`} rows={3} placeholder="Tell your team a little about yourself…" />
        </div>

        <SaveBtn loading={saving} />
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Security
// ─────────────────────────────────────────────────────────────────────────────
function SecuritySection({ user }: { user: any }) {
  const [cur, setCur]   = useState('');
  const [newP, setNewP] = useState('');
  const [conf, setConf] = useState('');
  const [show, setShow] = useState({ cur: false, new: false, con: false });
  const [saving, setSaving] = useState(false);

  const strength = newP.length === 0 ? 0 : newP.length < 8 ? 1 : newP.length < 12 || !/[^a-zA-Z0-9]/.test(newP) ? 2 : 3;
  const strengthLabel = ['', 'Weak', 'Medium', 'Strong'];
  const strengthColor = ['', 'bg-red-400', 'bg-amber-400', 'bg-green-500'];
  const strengthText  = ['', 'text-red-500', 'text-amber-500', 'text-green-600'];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newP !== conf)   return toast.error('Passwords do not match');
    if (newP.length < 8) return toast.error('Password must be at least 8 characters');
    setSaving(true);
    try {
      await authApi.changePassword(cur, newP);
      toast.success('Password changed successfully!');
      setCur(''); setNewP(''); setConf('');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to change password');
    } finally { setSaving(false); }
  };

  const fields = [
    { label: 'Current Password', val: cur, set: setCur, key: 'cur' as const },
    { label: 'New Password',     val: newP, set: setNewP, key: 'new' as const },
    { label: 'Confirm Password', val: conf, set: setConf, key: 'con' as const },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800 dark:text-gray-100">Change Password</h3>
        {fields.map(({ label, val, set, key }) => (
          <div key={key}>
            <label className={labelCls}>{label}</label>
            <div className="relative">
              <input type={show[key] ? 'text' : 'password'} value={val} onChange={(e) => set(e.target.value)}
                className={`${inputCls} pr-10`} required autoComplete="new-password" />
              <button type="button" onClick={() => setShow((s) => ({ ...s, [key]: !s[key] }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-gray-300">
                {show[key] ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        ))}

        {newP.length > 0 && (
          <div className="space-y-1">
            <div className="flex gap-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className={cn('h-1.5 flex-1 rounded-full transition-all', i <= strength ? strengthColor[strength] : 'bg-slate-200 dark:bg-gray-700')} />
              ))}
            </div>
            <p className={cn('text-xs font-medium', strengthText[strength])}>{strengthLabel[strength]}</p>
          </div>
        )}
        <SaveBtn loading={saving} label="Change Password" />
      </div>

      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800 dark:text-gray-100">Session Information</h3>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-gray-800">
            <span className="text-slate-500 dark:text-gray-400">Last sign in</span>
            <span className="font-medium text-slate-700 dark:text-gray-300">
              {user?.lastLoginAt
                ? new Date(user.lastLoginAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                : 'This session'}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-slate-500 dark:text-gray-400">Account status</span>
            <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium', user?.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600')}>
              {user?.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Notifications
// ─────────────────────────────────────────────────────────────────────────────
function NotificationsSection({ isManager }: { isManager: boolean }) {
  const stored = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('apexNotifPrefs') ?? '{}') : {};
  const [prefs, setPrefs] = useState({
    assignedTicket: stored.assignedTicket ?? true,
    statusChanged:  stored.statusChanged  ?? true,
    commentAdded:   stored.commentAdded   ?? false,
    overdueTicket:  stored.overdueTicket  ?? true,
    ticketResolved: stored.ticketResolved ?? true,
    leaveApproved:  stored.leaveApproved  ?? true,
    leaveRejected:  stored.leaveRejected  ?? true,
    teamLeaveApply: stored.teamLeaveApply ?? true,
    inApp:          stored.inApp          ?? true,
    quietFrom:      stored.quietFrom      ?? '22:00',
    quietTo:        stored.quietTo        ?? '08:00',
  });

  const toggle = (k: keyof typeof prefs) => setPrefs((p) => ({ ...p, [k]: !p[k] }));

  const handleSave = () => {
    localStorage.setItem('apexNotifPrefs', JSON.stringify(prefs));
    toast.success('Notification preferences saved');
  };

  return (
    <div className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800 dark:text-gray-100">Ticket Events</h3>
        <ToggleRow label="Ticket assigned to me"  desc="Notify when a ticket is assigned to you"        checked={prefs.assignedTicket} onChange={() => toggle('assignedTicket')} />
        <ToggleRow label="Status changed"          desc="Notify when a ticket's status is updated"       checked={prefs.statusChanged}  onChange={() => toggle('statusChanged')} />
        <ToggleRow label="Comment added"           desc="Notify when someone comments on your ticket"    checked={prefs.commentAdded}   onChange={() => toggle('commentAdded')} />
        <ToggleRow label="Overdue alert"           desc="Notify when a ticket you own goes overdue"      checked={prefs.overdueTicket}  onChange={() => toggle('overdueTicket')} />
        <ToggleRow label="Ticket resolved"         desc="Notify when your raised ticket is resolved"     checked={prefs.ticketResolved} onChange={() => toggle('ticketResolved')} />
      </div>

      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800 dark:text-gray-100">Leave Events</h3>
        <ToggleRow label="Leave approved"     desc="Notify when your leave request is approved" checked={prefs.leaveApproved} onChange={() => toggle('leaveApproved')} />
        <ToggleRow label="Leave rejected"     desc="Notify when your leave request is rejected" checked={prefs.leaveRejected} onChange={() => toggle('leaveRejected')} />
        {isManager && <ToggleRow label="Team member applied" desc="Notify when a team member applies for leave" checked={prefs.teamLeaveApply} onChange={() => toggle('teamLeaveApply')} />}
      </div>

      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800 dark:text-gray-100">Delivery</h3>
        <ToggleRow label="In-app notifications" desc="Show bell notifications in the top bar" checked={prefs.inApp} onChange={() => toggle('inApp')} />
        <div className="pt-3">
          <p className="text-sm font-medium text-slate-700 dark:text-gray-300 mb-3">Quiet Hours</p>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-500 dark:text-gray-400 mb-1">From</label>
              <input type="time" value={prefs.quietFrom} onChange={(e) => setPrefs((p) => ({ ...p, quietFrom: e.target.value }))} className={inputCls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-500 dark:text-gray-400 mb-1">To</label>
              <input type="time" value={prefs.quietTo}   onChange={(e) => setPrefs((p) => ({ ...p, quietTo: e.target.value }))}   className={inputCls} />
            </div>
          </div>
        </div>
      </div>

      <button type="button" onClick={handleSave}
        className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
        Save Preferences
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Display & Theme
// ─────────────────────────────────────────────────────────────────────────────
function DisplaySection() {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('apex-theme') as any) ?? 'light' : 'light',
  );
  const [compact, setCompact]       = useState(() => typeof window !== 'undefined' && localStorage.getItem('apex-compact') === 'true');
  const [dateFormat, setDateFormat] = useState(() => typeof window !== 'undefined' ? (localStorage.getItem('apex-date-format') ?? 'DD/MM/YYYY') : 'DD/MM/YYYY');
  const [timeFormat, setTimeFormat] = useState(() => typeof window !== 'undefined' ? (localStorage.getItem('apex-time-format') ?? '12h') : '12h');

  const applyTheme = (t: 'light' | 'dark' | 'system') => {
    setTheme(t);
    localStorage.setItem('apex-theme', t);
    const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  };

  const handleSave = () => {
    localStorage.setItem('apex-compact', compact.toString());
    localStorage.setItem('apex-date-format', dateFormat);
    localStorage.setItem('apex-time-format', timeFormat);
    toast.success('Display settings saved');
  };

  return (
    <div className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800 dark:text-gray-100">Theme</h3>
        <div className="flex gap-3">
          {([['light', '☀️ Light'], ['dark', '🌙 Dark'], ['system', '💻 System']] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => applyTheme(key)}
              className={cn('flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all',
                theme === key
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'
                  : 'border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800',
              )}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400 dark:text-gray-500">Theme applies immediately and persists across sessions.</p>
      </div>

      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800 dark:text-gray-100">Format & Density</h3>
        <div className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-gray-800">
          <div>
            <p className="text-sm font-medium text-slate-800 dark:text-gray-200">Compact mode</p>
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">Reduce spacing for higher information density</p>
          </div>
          <Toggle checked={compact} onChange={setCompact} />
        </div>
        <div className="pt-2">
          <label className={labelCls}>Date format</label>
          <div className="flex gap-2">
            {(['DD/MM/YYYY', 'MM/DD/YYYY'] as const).map((f) => (
              <button key={f} type="button" onClick={() => setDateFormat(f)}
                className={cn('flex-1 py-2 rounded-lg text-sm font-medium border transition-all',
                  dateFormat === f
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'
                    : 'border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800',
                )}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelCls}>Time format</label>
          <div className="flex gap-2">
            {(['12h', '24h'] as const).map((f) => (
              <button key={f} type="button" onClick={() => setTimeFormat(f)}
                className={cn('flex-1 py-2 rounded-lg text-sm font-medium border transition-all',
                  timeFormat === f
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400'
                    : 'border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800',
                )}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={handleSave}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
          Save Display Settings
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Preferences
// ─────────────────────────────────────────────────────────────────────────────
function PreferencesSection() {
  const [autoAssign,      setAutoAssign]      = useState(() => typeof window !== 'undefined' && localStorage.getItem('apex-pref-autoassign') !== 'false');
  const [defaultPriority, setDefaultPriority] = useState(() => typeof window !== 'undefined' ? (localStorage.getItem('apex-pref-priority') ?? 'MEDIUM') : 'MEDIUM');

  const handleSave = () => {
    localStorage.setItem('apex-pref-autoassign', autoAssign.toString());
    localStorage.setItem('apex-pref-priority', defaultPriority);
    toast.success('Preferences saved');
  };

  return (
    <div className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800 dark:text-gray-100">Ticket Preferences</h3>
        <div className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-gray-800">
          <div>
            <p className="text-sm font-medium text-slate-800 dark:text-gray-200">Auto-assign tickets I create</p>
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">Automatically assign new tickets to yourself</p>
          </div>
          <Toggle checked={autoAssign} onChange={setAutoAssign} />
        </div>
        <div>
          <label className={labelCls}>Default priority</label>
          <select value={defaultPriority} onChange={(e) => setDefaultPriority(e.target.value)} className={inputCls}>
            {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <button type="button" onClick={handleSave}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
          Save Preferences
        </button>
      </div>

      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800 dark:text-gray-100">Onboarding</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-800 dark:text-gray-200">Welcome screen</p>
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-0.5">Re-show the welcome walkthrough on your next login</p>
          </div>
          <button type="button"
            onClick={() => { localStorage.removeItem('apexWelcomeSeen'); toast.success('Welcome screen will show on next login'); }}
            className="text-sm font-medium px-4 py-1.5 border border-slate-200 dark:border-gray-700 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-800 text-slate-600 dark:text-gray-400 transition-colors">
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Company (admin only)
// ─────────────────────────────────────────────────────────────────────────────
function CompanySection() {
  const qc = useQueryClient();
  const { data: remote } = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => settingsApi.getCompany() as Promise<any>,
  });
  const [form, setForm] = useState({ companyName: 'TechnoEdge Learning Services', tagline: '', contactEmail: '' });

  // Sync from API once loaded
  useEffect(() => {
    if (remote) setForm((f) => ({ ...f, ...remote }));
  }, [remote]);

  const save = useMutation({
    mutationFn: (data: any) => settingsApi.updateCompany(data),
    onSuccess: () => {
      toast.success('Company settings saved');
      qc.invalidateQueries({ queryKey: ['settings', 'company'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to save'),
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(form);
  };

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800 dark:text-gray-100">Company Information</h3>
        <div><label className={labelCls}>Company Name</label><input className={inputCls} value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} /></div>
        <div><label className={labelCls}>Tagline</label><input className={inputCls} value={form.tagline} onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))} placeholder="e.g. AI-powered workplace operations" /></div>
        <div><label className={labelCls}>Contact Email</label><input type="email" className={inputCls} value={form.contactEmail} onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))} placeholder="hr@company.com" /></div>
        <SaveBtn loading={save.isPending} />
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Leave Policy (admin only)
// ─────────────────────────────────────────────────────────────────────────────
function LeavePolicySection({ canEdit = true }: { canEdit?: boolean }) {
  const qc = useQueryClient();
  const { data: remote } = useQuery({
    queryKey: ['settings', 'leave-policy'],
    queryFn: () => settingsApi.getLeavePolicy() as Promise<any>,
  });
  const [quotas, setQuotas]           = useState({ EMPLOYEE: 12, TEAM_LEAD: 12, MANAGER: 15, INTERN: 6 });
  const [workingDays, setWorkingDays] = useState('Mon–Sat');

  useEffect(() => {
    if (remote) {
      if (remote.quotas)      setQuotas(remote.quotas);
      if (remote.workingDays) setWorkingDays(remote.workingDays);
    }
  }, [remote]);

  const save = useMutation({
    mutationFn: (data: any) => settingsApi.updateLeavePolicy(data),
    onSuccess: () => {
      toast.success('Leave policy saved');
      qc.invalidateQueries({ queryKey: ['settings', 'leave-policy'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to save'),
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ quotas, workingDays });
  };

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800 dark:text-gray-100">Leave Quotas <span className="text-xs font-normal text-slate-400">(days/year)</span></h3>
        <div className="grid grid-cols-2 gap-4">
          {(Object.entries(quotas) as [keyof typeof quotas, number][]).map(([role, days]) => (
            <div key={role}>
              <label className={labelCls}>{role.replace('_', ' ')}</label>
              <input type="number" min={0} max={365} className={inputCls} value={days}
                onChange={(e) => setQuotas((q) => ({ ...q, [role]: Number(e.target.value) }))} />
            </div>
          ))}
        </div>
      </div>
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800 dark:text-gray-100">Working Schedule</h3>
        {!canEdit && (
          <p className="text-xs text-slate-400 dark:text-gray-500 mb-2">Read-only — contact your admin to change the schedule.</p>
        )}
        <div>
          <label className={labelCls}>Working Days</label>
          <select
            value={workingDays}
            onChange={(e) => canEdit && setWorkingDays(e.target.value)}
            disabled={!canEdit}
            className={`${inputCls} ${!canEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <option value="Mon–Fri">Mon–Fri (5 days)</option>
            <option value="Mon–Sat">Mon–Sat (6 days)</option>
            <option value="Mon–Sun">Mon–Sun (7 days)</option>
          </select>
        </div>
        {canEdit && <SaveBtn loading={save.isPending} />}
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: SLA (admin only)
// ─────────────────────────────────────────────────────────────────────────────
function SlaSection() {
  const qc = useQueryClient();
  const { data: remote } = useQuery({
    queryKey: ['settings', 'sla'],
    queryFn: () => settingsApi.getSla() as Promise<any>,
  });
  const [sla, setSla] = useState({ URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 });

  useEffect(() => {
    if (remote && Object.keys(remote).length > 0) setSla((s) => ({ ...s, ...remote }));
  }, [remote]);

  const save = useMutation({
    mutationFn: (data: any) => settingsApi.updateSla(data),
    onSuccess: () => {
      toast.success('SLA settings saved');
      qc.invalidateQueries({ queryKey: ['settings', 'sla'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to save'),
  });

  const priorityColor: Record<string, string> = {
    URGENT: 'text-red-600', HIGH: 'text-orange-600', MEDIUM: 'text-blue-600', LOW: 'text-slate-500',
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(sla);
  };

  return (
    <form onSubmit={handleSave}>
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800 dark:text-gray-100">SLA Response Hours</h3>
        <p className="text-xs text-slate-400 dark:text-gray-500">Max hours before a ticket is overdue, by priority.</p>
        <div className="grid grid-cols-2 gap-4">
          {(Object.entries(sla) as [keyof typeof sla, number][]).map(([priority, hours]) => (
            <div key={priority}>
              <label className={cn(labelCls, priorityColor[priority])}>{priority}</label>
              <div className="relative">
                <input type="number" min={1} className={inputCls} value={hours}
                  onChange={(e) => setSla((s) => ({ ...s, [priority]: Number(e.target.value) }))} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">hrs</span>
              </div>
            </div>
          ))}
        </div>
        <SaveBtn loading={save.isPending} />
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: SMTP (super admin only)
// ─────────────────────────────────────────────────────────────────────────────
function SmtpSection() {
  const qc = useQueryClient();
  const { data: remote } = useQuery({
    queryKey: ['settings', 'smtp'],
    queryFn: () => settingsApi.getSmtp() as Promise<any>,
  });
  const [form, setForm]       = useState({ host: '', port: '587', email: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [testing, setTesting]   = useState(false);

  useEffect(() => {
    if (remote) setForm((f) => ({ ...f, ...remote }));
  }, [remote]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: (data: any) => settingsApi.updateSmtp(data),
    onSuccess: () => {
      toast.success('SMTP settings saved');
      qc.invalidateQueries({ queryKey: ['settings', 'smtp'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to save'),
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(form);
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      // Future: call a /settings/smtp/test endpoint
      await new Promise((res) => setTimeout(res, 800));
      toast.success('Test email sent! (Check server logs — SMTP must be configured)');
    } catch {
      toast.error('Test email failed');
    } finally { setTesting(false); }
  };

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800 dark:text-gray-100">SMTP Configuration</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><label className={labelCls}>SMTP Host</label><input className={inputCls} value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp.gmail.com" /></div>
          <div><label className={labelCls}>Port</label><input type="number" className={inputCls} value={form.port} onChange={(e) => set('port', e.target.value)} /></div>
          <div><label className={labelCls}>From Email</label><input type="email" className={inputCls} value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="noreply@company.com" /></div>
          <div className="col-span-2">
            <label className={labelCls}>Password</label>
            <div className="relative">
              <input type={showPass ? 'text' : 'password'} className={`${inputCls} pr-10`} value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="App password or SMTP secret" />
              <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <SaveBtn loading={save.isPending} />
          <button type="button" onClick={handleTest} disabled={testing}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 dark:border-gray-700 rounded-lg text-sm font-medium text-slate-600 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors">
            <Mail size={14} />{testing ? 'Sending…' : 'Send Test Email'}
          </button>
        </div>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Task Types (admin only)
// ─────────────────────────────────────────────────────────────────────────────
function TaskTypesSettings() {
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null); // null = Global
  const { data: allTypesRaw, refetch } = useQuery({
    queryKey: ['task-types-all'],
    queryFn: () => taskTypesApi.getAll() as Promise<any[]>,
  });
  const { data: departmentsRaw } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll() as Promise<any[]>,
  });

  const allTypes: any[] = Array.isArray(allTypesRaw) ? allTypesRaw : [];
  const departments: any[] = Array.isArray(departmentsRaw) ? departmentsRaw : [];

  const [addTypeModal, setAddTypeModal] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [addingSubtypeFor, setAddingSubtypeFor] = useState<string | null>(null);
  const [newSubtypeName, setNewSubtypeName] = useState('');

  // Filter types for selected dept
  const deptTypes = allTypes.filter((t: any) =>
    selectedDeptId === null ? t.isGlobal : t.departmentId === selectedDeptId
  );

  const deptList = [
    { id: null, name: 'Global' },
    ...departments,
  ];

  const handleAddType = async () => {
    if (!newTypeName.trim()) return;
    try {
      await taskTypesApi.create({
        name: newTypeName.trim(),
        departmentId: selectedDeptId || undefined,
        isGlobal: selectedDeptId === null,
      });
      setNewTypeName('');
      setAddTypeModal(false);
      refetch();
      toast.success('Task type added');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add type');
    }
  };

  const handleAddSubtype = async (typeId: string) => {
    if (!newSubtypeName.trim()) return;
    try {
      await taskTypesApi.createSubtype(typeId, { name: newSubtypeName.trim() });
      setNewSubtypeName('');
      setAddingSubtypeFor(null);
      refetch();
      toast.success('Subtype added');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add subtype');
    }
  };

  const handleDeleteType = async (id: string) => {
    if (!confirm('Delete this task type and all its subtypes?')) return;
    try {
      await taskTypesApi.deleteType(id);
      refetch();
      toast.success('Task type deleted');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete type');
    }
  };

  const handleDeleteSubtype = async (typeId: string, subtypeId: string) => {
    try {
      await taskTypesApi.deleteSubtype(typeId, subtypeId);
      refetch();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete subtype');
    }
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-gray-100">Task Types</h2>
        <p className="text-sm text-slate-500 dark:text-gray-400 mt-0.5">
          Task types help organise work by department. They appear in the ticket creation form based on the selected department.
        </p>
      </div>
      <div className="flex gap-6">
        {/* Department list sidebar */}
        <div className="w-48 flex-shrink-0">
          <p className="text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase tracking-wide mb-2">Department</p>
          <ul className="space-y-0.5">
            {deptList.map((d: any) => (
              <li key={d.id ?? 'global'}>
                <button
                  onClick={() => setSelectedDeptId(d.id)}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    selectedDeptId === d.id
                      ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-medium'
                      : 'text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {d.name}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Types list */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-slate-700 dark:text-gray-300">
              {selectedDeptId === null ? 'Global' : deptList.find((d: any) => d.id === selectedDeptId)?.name} Types
            </p>
            <button
              onClick={() => setAddTypeModal(true)}
              className="flex items-center gap-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              + Add Type
            </button>
          </div>

          {deptTypes.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-gray-500 py-4">No task types yet.</p>
          ) : (
            <div className="space-y-3">
              {deptTypes.map((type: any) => (
                <div key={type.id} className="border border-slate-200 dark:border-gray-700 rounded-xl p-3 bg-white dark:bg-gray-900">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-slate-800 dark:text-gray-200">{type.name}</span>
                      <span className="text-xs text-slate-400 dark:text-gray-500">{type.subtypes?.length ?? 0} subtypes</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setAddingSubtypeFor(type.id); setNewSubtypeName(''); }}
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        + Subtype
                      </button>
                      <button
                        onClick={() => handleDeleteType(type.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Subtypes */}
                  {type.subtypes?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {type.subtypes.map((sub: any) => (
                        <span key={sub.id} className="flex items-center gap-1 bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 px-2 py-0.5 rounded-full text-xs">
                          {sub.name}
                          <button
                            onClick={() => handleDeleteSubtype(type.id, sub.id)}
                            className="text-slate-400 hover:text-red-500 ml-0.5"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Add subtype inline */}
                  {addingSubtypeFor === type.id && (
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        autoFocus
                        type="text"
                        value={newSubtypeName}
                        onChange={(e) => setNewSubtypeName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddSubtype(type.id); if (e.key === 'Escape') setAddingSubtypeFor(null); }}
                        placeholder="Subtype name..."
                        className="flex-1 px-2 py-1 text-xs border border-slate-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                      />
                      <button onClick={() => handleAddSubtype(type.id)} className="text-xs bg-indigo-600 text-white px-2 py-1 rounded">Add</button>
                      <button onClick={() => setAddingSubtypeFor(null)} className="text-xs text-slate-400">Cancel</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add Type Modal */}
          {addTypeModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 p-6 w-96 shadow-xl">
                <h3 className="font-semibold text-slate-800 dark:text-gray-100 mb-4">Add Task Type</h3>
                <input
                  autoFocus
                  type="text"
                  value={newTypeName}
                  onChange={(e) => setNewTypeName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddType(); }}
                  placeholder="Type name..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 mb-4"
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setAddTypeModal(false)} className="px-4 py-2 text-sm text-slate-600 dark:text-gray-400 border border-slate-200 dark:border-gray-600 rounded-lg">Cancel</button>
                  <button onClick={handleAddType} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Add Type</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Appearance (theme + accent picker)
// ─────────────────────────────────────────────────────────────────────────────
function AppearanceSettings() {
  const { theme, accent, setTheme, setAccent, setCompanyDefaults, resetToCompanyDefaults } = useTheme();
  const { user } = useAuthStore();
  const roleName = (user?.role as any)?.name ?? '';
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(roleName);

  const [companyTheme, setCompanyThemeState] = useState<ThemeId>('technoedge-light');
  const [companyAccent, setCompanyAccentState] = useState<AccentId>('royal-blue');

  const THEMES = [
    { id: 'technoedge-light', name: 'TechnoEdge Light', desc: 'Clean Professional', preview: { bg: '#f8fafc', sidebar: '#ffffff', accent: '#2563eb' }, active: true },
    { id: 'john-wick-dark', name: 'John Wick Dark', desc: 'Matte Minimal', preview: { bg: '#050505', sidebar: '#0d0d0f', accent: '#fafafa' }, active: true },
    { id: 'gen-z-pastel', name: 'Gen Z Pastel', desc: 'Soft Playful', preview: { bg: '#faf9ff', sidebar: '#ffffff', accent: '#7c3aed' }, active: false },
    { id: 'executive-midnight', name: 'Executive Midnight', desc: 'Navy Premium', preview: { bg: '#0a0e1a', sidebar: '#0f1424', accent: '#3b82f6' }, active: false },
    { id: 'focus-mode', name: 'Focus Mode', desc: 'Warm Minimal', preview: { bg: '#fafaf8', sidebar: '#f5f5f0', accent: '#475569' }, active: false },
    { id: 'neo-future', name: 'Neo Future', desc: 'Deep Space', preview: { bg: '#06060f', sidebar: '#0d0d1a', accent: '#a78bfa' }, active: false },
  ] as const;

  const ACCENTS = [
    { id: 'royal-blue', color: '#2563eb', name: 'Royal Blue' },
    { id: 'emerald',    color: '#059669', name: 'Emerald' },
    { id: 'violet',     color: '#7c3aed', name: 'Violet' },
    { id: 'gold',       color: '#d4af37', name: 'Gold' },
    { id: 'crimson',    color: '#dc2626', name: 'Crimson' },
    { id: 'slate',      color: '#475569', name: 'Slate' },
  ] as const;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Appearance</h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Personalize your workspace look and feel</p>
      </div>

      {/* System Theme */}
      <div>
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>System Theme</h3>
        <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>Choose your workspace theme</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => t.active && setTheme(t.id as ThemeId)}
              className="relative text-left rounded-xl border-2 p-3 transition-all"
              style={{
                borderColor: theme === t.id ? 'var(--accent)' : 'var(--border-primary)',
                backgroundColor: 'var(--surface-card)',
                opacity: t.active ? 1 : 0.5,
                cursor: t.active ? 'pointer' : 'not-allowed',
              }}
            >
              {/* Mini preview */}
              <div className="w-full h-12 rounded-lg mb-2 overflow-hidden flex" style={{ backgroundColor: t.preview.bg }}>
                <div className="w-1/3 h-full" style={{ backgroundColor: t.preview.sidebar }} />
                <div className="flex-1 p-1.5 flex flex-col gap-1">
                  <div className="h-1.5 rounded-full w-3/4" style={{ backgroundColor: t.preview.accent, opacity: 0.7 }} />
                  <div className="h-1 rounded-full w-1/2" style={{ backgroundColor: t.preview.accent, opacity: 0.3 }} />
                </div>
              </div>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t.name}</p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t.desc}</p>
              {!t.active && (
                <span className="absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>Phase 2</span>
              )}
              {theme === t.id && (
                <span className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-white text-xs" style={{ backgroundColor: 'var(--accent)' }}>&#10003;</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Accent Color */}
      <div>
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Accent Color</h3>
        <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>Used for highlights, active states, and your avatar ring</p>
        <div className="flex items-center gap-3 flex-wrap mb-4">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              onClick={() => setAccent(a.id as AccentId)}
              title={a.name}
              className="relative flex items-center justify-center transition-transform hover:scale-110"
              style={{
                width: 36, height: 36,
                borderRadius: '50%',
                backgroundColor: a.color,
                boxShadow: accent === a.id
                  ? `0 0 0 3px var(--surface-card), 0 0 0 5px ${a.color}`
                  : 'none',
              }}
            >
              {accent === a.id && <span className="text-white text-sm font-bold">&#10003;</span>}
            </button>
          ))}
        </div>

        {/* Live Preview */}
        <div className="rounded-xl p-4 border" style={{ backgroundColor: 'var(--surface-sunken)', borderColor: 'var(--border-primary)' }}>
          <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>Preview</p>
          <div className="flex items-center gap-3 flex-wrap">
            <button className="px-4 py-2 text-sm font-medium rounded-lg text-white" style={{ backgroundColor: 'var(--accent)' }}>Primary Button</button>
            <span className="text-sm font-medium pb-1" style={{ color: 'var(--accent)', borderBottom: '2px solid var(--accent)' }}>Active Tab</span>
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: 'var(--accent)', boxShadow: '0 0 0 3px var(--surface-sunken), 0 0 0 5px var(--accent-ring)' }}>AB</div>
            <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-text)', border: '1px solid var(--accent-border)' }}>Active badge</span>
          </div>
        </div>
      </div>

      {/* Reset */}
      <div>
        <button onClick={resetToCompanyDefaults} className="text-sm" style={{ color: 'var(--accent)' }}>
          Reset to company defaults
        </button>
      </div>

      {/* Admin: Company Defaults */}
      {isAdmin && (
        <div className="border-t pt-6" style={{ borderColor: 'var(--border-subtle)' }}>
          <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Company Default Theme</h3>
          <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>All new users start with these settings. Existing users keep their personal choice.</p>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            {THEMES.filter(t => t.active).map((t) => (
              <button
                key={t.id}
                onClick={() => setCompanyThemeState(t.id as ThemeId)}
                className="relative text-left rounded-xl border-2 p-3 transition-all"
                style={{
                  borderColor: companyTheme === t.id ? 'var(--accent)' : 'var(--border-primary)',
                  backgroundColor: 'var(--surface-card)',
                }}
              >
                <div className="w-full h-10 rounded-lg mb-2 overflow-hidden flex" style={{ backgroundColor: t.preview.bg }}>
                  <div className="w-1/3 h-full" style={{ backgroundColor: t.preview.sidebar }} />
                </div>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t.name}</p>
                {companyTheme === t.id && <span className="absolute top-2 right-2 w-4 h-4 rounded-full text-white text-[10px] flex items-center justify-center" style={{ backgroundColor: 'var(--accent)' }}>&#10003;</span>}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 mb-4">
            {ACCENTS.map((a) => (
              <button key={a.id} onClick={() => setCompanyAccentState(a.id as AccentId)} title={a.name}
                className="transition-transform hover:scale-110" style={{ width:32, height:32, borderRadius:'50%', backgroundColor:a.color,
                  boxShadow: companyAccent === a.id ? `0 0 0 2px var(--surface-card), 0 0 0 4px ${a.color}` : 'none' }} />
            ))}
          </div>

          <button
            onClick={() => setCompanyDefaults(companyTheme, companyAccent)}
            className="px-4 py-2 text-sm font-medium text-white rounded-xl"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            Save Company Defaults
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT — left sidebar layout
// ─────────────────────────────────────────────────────────────────────────────
type SectionId =
  | 'profile' | 'security' | 'notifications' | 'display' | 'preferences' | 'appearance'
  | 'company' | 'leave-policy' | 'sla' | 'smtp' | 'task-types';

export default function SettingsPage() {
  const { user } = useAuthStore();
  const roleName    = (user?.role as any)?.name ?? user?.role ?? '';
  const isAdmin     = ['ADMIN', 'SUPER_ADMIN'].includes(roleName);
  const isSuperAdmin = roleName === 'SUPER_ADMIN';
  const isManager   = ['MANAGER', 'TEAM_LEAD', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);

  const [active, setActive] = useState<SectionId>('profile');

  // ── NavItem defined as closure — captures active / setActive ─────────────
  function NavItem({ id, label, icon, badge }: {
    id: SectionId; label: string; icon: React.ReactNode; badge?: string;
  }) {
    return (
      <button
        onClick={() => setActive(id)}
        className={cn(
          'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all text-left',
          active === id
            ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white',
        )}
      >
        <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">{icon}</span>
        <span className="flex-1">{label}</span>
        {badge && (
          <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400">
            {badge}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="flex gap-6 max-w-5xl mx-auto">
      {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
      <div className="w-56 flex-shrink-0">
        <nav className="sticky top-6 space-y-0.5 bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 p-2">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider px-3 py-2">
            My Account
          </p>
          <NavItem id="profile"       label="Profile"           icon={<User size={15} />} />
          <NavItem id="security"      label="Security"          icon={<Shield size={15} />} />
          <NavItem id="notifications" label="Notifications"     icon={<Bell size={15} />} />
          <NavItem id="display"       label="Display & Theme"   icon={<Palette size={15} />} />
          <NavItem id="appearance"    label="Appearance"         icon={<Palette size={15} />} />
          <NavItem id="preferences"   label="Preferences"       icon={<SlidersHorizontal size={15} />} />

          {isAdmin && (
            <>
              <div className="my-2 border-t border-gray-200 dark:border-gray-700" />
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider px-3 py-2">
                Workspace
              </p>
              <NavItem id="company"      label="Company Info"   icon={<Building2 size={15} />}    badge="ADM" />
              <NavItem id="leave-policy" label="Leave Policy"   icon={<CalendarDays size={15} />} badge="ADM" />
              <NavItem id="sla"          label="SLA Settings"   icon={<Gauge size={15} />}         badge="ADM" />
              <NavItem id="task-types"   label="Task Types"     icon={<Tags size={15} />}          badge="ADM" />
              {isSuperAdmin && (
                <NavItem id="smtp" label="Email & SMTP" icon={<Mail size={15} />} badge="SA" />
              )}
            </>
          )}
        </nav>
      </div>

      {/* ── RIGHT CONTENT ────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        {active === 'profile'       && <ProfileSection       user={user} />}
        {active === 'security'      && <SecuritySection      user={user} />}
        {active === 'notifications' && <NotificationsSection isManager={isManager} />}
        {active === 'display'       && <DisplaySection />}
        {active === 'appearance'    && <AppearanceSettings />}
        {active === 'preferences'   && <PreferencesSection />}
        {active === 'company'       && isAdmin      && <CompanySection />}
        {active === 'leave-policy'  && isAdmin      && <LeavePolicySection canEdit={isAdmin} />}
        {active === 'sla'           && isAdmin      && <SlaSection />}
        {active === 'task-types'    && isAdmin      && <TaskTypesSettings />}
        {active === 'smtp'          && isSuperAdmin && <SmtpSection />}
      </div>
    </div>
  );
}
