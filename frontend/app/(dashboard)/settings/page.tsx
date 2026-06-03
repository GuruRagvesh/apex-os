'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { authApi, usersApi, settingsApi, taskTypesApi, departmentsApi } from '@/lib/api';
import { UserAvatar } from '@/components/ui/user-avatar';
import toast from 'react-hot-toast';
import {
  User, Shield, Palette, Building2,
  CalendarDays, Mail, Eye, EyeOff, Lock, Tags,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme, type ThemeId, type AccentId } from '@/hooks/useTheme';

// ── Shared CSS-variable-aware styles ──────────────────────────────────────────
const inputCls  = 'apex-input';
const labelCls  = 'apex-label';
const cardCls   = 'apex-card p-6 space-y-4';

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
      className="relative w-10 h-6 rounded-full transition-colors flex-shrink-0"
      style={{ backgroundColor: checked ? 'var(--accent)' : 'var(--bg-tertiary)' }}
    >
      <span className={cn('absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all', checked ? 'left-5' : 'left-1')} />
    </button>
  );
}

function ToggleRow({ label, desc, checked, onChange }: {
  label: string; desc: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div
      className="flex items-center justify-between py-3 border-b last:border-0"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <div className="mr-4">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{desc}</p>
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
      className="apex-btn-primary px-6 py-2 text-sm font-medium"
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
      updateUser({ name: name.trim(), avatar: color, bio });
      useAuthStore.setState((s: any) => ({ user: { ...s.user, avatar: color, bio } }));
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
      await (usersApi as any).removePhoto();
      useAuthStore.setState((s: any) => ({ user: { ...s.user, photoUrl: null } }));
      toast.success('Photo removed');
    } catch { toast.error('Failed to remove photo'); }
  };

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Profile Information</h3>
        <div className="flex items-center gap-6">
          <UserAvatar name={name} avatar={color} photoUrl={(user as any)?.photoUrl} size="lg" />
          <div>
            <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Avatar colour</p>
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
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
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
              <label
                className="cursor-pointer inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg border transition-colors"
                style={{
                  borderColor: 'var(--border-primary)',
                  backgroundColor: 'var(--surface-card)',
                  color: 'var(--text-secondary)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-card)')}
              >
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
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>JPG, PNG up to 2MB</p>
            </div>
          </div>
        </div>

        <div>
          <label className={labelCls}>Display Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} required />
        </div>

        <div>
          <label className={labelCls}>Email <Lock size={11} className="inline mb-0.5" style={{ color: 'var(--text-tertiary)' }} /></label>
          <input className={`${inputCls} opacity-60 cursor-not-allowed`} value={user?.email ?? ''} readOnly />
        </div>

        <div className="flex gap-2 flex-wrap">
          {roleName && <span className={cn('px-3 py-1 text-xs font-medium rounded-full', ROLE_BADGE[roleName] ?? 'bg-slate-100 text-slate-600')}>{roleName}</span>}
          {deptName && (
            <span
              className="px-3 py-1 text-xs font-medium rounded-full"
              style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-text)', border: '1px solid var(--accent-border)' }}
            >
              {deptName}
            </span>
          )}
        </div>

        <div>
          <label className={labelCls}>
            Bio <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>({bio.length}/200)</span>
          </label>
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
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Change Password</h3>
        {fields.map(({ label, val, set, key }) => (
          <div key={key}>
            <label className={labelCls}>{label}</label>
            <div className="relative">
              <input type={show[key] ? 'text' : 'password'} value={val} onChange={(e) => set(e.target.value)}
                className={`${inputCls} pr-10`} required autoComplete="new-password" />
              <button type="button" onClick={() => setShow((s) => ({ ...s, [key]: !s[key] }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                style={{ color: 'var(--text-tertiary)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-tertiary)')}
              >
                {show[key] ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        ))}

        {newP.length > 0 && (
          <div className="space-y-1">
            <div className="flex gap-1">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={cn('h-1.5 flex-1 rounded-full transition-all', i <= strength ? strengthColor[strength] : '')}
                  style={i > strength ? { backgroundColor: 'var(--bg-tertiary)' } : undefined}
                />
              ))}
            </div>
            <p className={cn('text-xs font-medium', strengthText[strength])}>{strengthLabel[strength]}</p>
          </div>
        )}
        <SaveBtn loading={saving} label="Change Password" />
      </div>

      <div className={cardCls}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Session Information</h3>
        <div className="space-y-3 text-sm">
          <div
            className="flex items-center justify-between py-2 border-b"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <span style={{ color: 'var(--text-tertiary)' }}>Last sign in</span>
            <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>
              {user?.lastLoginAt
                ? new Date(user.lastLoginAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                : 'This session'}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span style={{ color: 'var(--text-tertiary)' }}>Account status</span>
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
const NOTIF_DEFAULTS = {
  assignedTicket: true,
  statusChanged:  true,
  commentAdded:   false,
  overdueTicket:  true,
  ticketResolved: true,
  leaveApproved:  true,
  leaveRejected:  true,
  teamLeaveApply: true,
  inApp:          true,
  quietFrom:      '22:00',
  quietTo:        '08:00',
};

function NotificationsSection({ isManager }: { isManager: boolean }) {
  const [prefs, setPrefs] = useState(NOTIF_DEFAULTS);
  const [saving, setSaving] = useState(false);

  // Hydrate from server prefs (falling back to localStorage) after mount
  useEffect(() => {
    usersApi.getPreferences()
      .then((remote: any) => {
        const local = typeof window !== 'undefined'
          ? JSON.parse(localStorage.getItem('apexNotifPrefs') ?? '{}')
          : {};
        // Server wins over localStorage for cross-device sync; local is the cache
        const merged = { ...NOTIF_DEFAULTS, ...local, ...remote };
        setPrefs((p) => ({ ...p, ...merged }));
      })
      .catch(() => {
        // Offline fallback: use localStorage only
        const local = typeof window !== 'undefined'
          ? JSON.parse(localStorage.getItem('apexNotifPrefs') ?? '{}')
          : {};
        setPrefs((p) => ({ ...p, ...local }));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (k: keyof typeof prefs) => setPrefs((p) => ({ ...p, [k]: !p[k] }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await usersApi.updatePreferences(prefs);
      localStorage.setItem('apexNotifPrefs', JSON.stringify(prefs));
      toast.success('Notification preferences saved');
    } catch (err: any) {
      // API save failed — still persist locally so the UX isn't broken
      localStorage.setItem('apexNotifPrefs', JSON.stringify(prefs));
      toast.error('Could not sync notification preferences. Saved on this browser only.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Ticket Events</h3>
        <ToggleRow label="Ticket assigned to me"  desc="Notify when a ticket is assigned to you"        checked={prefs.assignedTicket} onChange={() => toggle('assignedTicket')} />
        <ToggleRow label="Status changed"          desc="Notify when a ticket's status is updated"       checked={prefs.statusChanged}  onChange={() => toggle('statusChanged')} />
        <ToggleRow label="Comment added"           desc="Notify when someone comments on your ticket"    checked={prefs.commentAdded}   onChange={() => toggle('commentAdded')} />
        <ToggleRow label="Overdue alert"           desc="Notify when a ticket you own goes overdue"      checked={prefs.overdueTicket}  onChange={() => toggle('overdueTicket')} />
        <ToggleRow label="Ticket resolved"         desc="Notify when your raised ticket is resolved"     checked={prefs.ticketResolved} onChange={() => toggle('ticketResolved')} />
      </div>

      <div className={cardCls}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Leave Events</h3>
        <ToggleRow label="Leave approved"     desc="Notify when your leave request is approved" checked={prefs.leaveApproved} onChange={() => toggle('leaveApproved')} />
        <ToggleRow label="Leave rejected"     desc="Notify when your leave request is rejected" checked={prefs.leaveRejected} onChange={() => toggle('leaveRejected')} />
        {isManager && <ToggleRow label="Team member applied" desc="Notify when a team member applies for leave" checked={prefs.teamLeaveApply} onChange={() => toggle('teamLeaveApply')} />}
      </div>

      <div className={cardCls}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Delivery</h3>
        <ToggleRow label="In-app notifications" desc="Show bell notifications in the top bar" checked={prefs.inApp} onChange={() => toggle('inApp')} />
        <div className="pt-3">
          <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>Quiet Hours</p>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>From</label>
              <input type="time" value={prefs.quietFrom} onChange={(e) => setPrefs((p) => ({ ...p, quietFrom: e.target.value }))} className={inputCls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>To</label>
              <input type="time" value={prefs.quietTo}   onChange={(e) => setPrefs((p) => ({ ...p, quietTo: e.target.value }))}   className={inputCls} />
            </div>
          </div>
        </div>
      </div>

      <button type="button" onClick={handleSave} disabled={saving}
        className="apex-btn-primary px-6 py-2 text-sm font-medium">
        {saving ? 'Saving…' : 'Save Preferences'}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Display & Theme (legacy — superseded by AppearanceSettings tab)
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
    toast.success('Applied locally');
  };

  const optionBtnCls = (active: boolean) =>
    cn('flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all');
  const optionBtnStyle = (active: boolean): React.CSSProperties => active
    ? { borderColor: 'var(--accent)', backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }
    : { borderColor: 'var(--border-primary)', backgroundColor: 'var(--surface-card)', color: 'var(--text-secondary)' };

  return (
    <div className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Theme</h3>
        <div className="flex gap-3">
          {([['light', '☀️ Light'], ['dark', '🌙 Dark'], ['system', '💻 System']] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => applyTheme(key)}
              className={optionBtnCls(theme === key)}
              style={optionBtnStyle(theme === key)}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Theme applies immediately and persists across sessions.</p>
      </div>

      <div className={cardCls}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Format & Density</h3>
        <div
          className="flex items-center justify-between py-3 border-b"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Compact mode</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>Reduce spacing for higher information density</p>
          </div>
          <Toggle checked={compact} onChange={setCompact} />
        </div>
        <div className="pt-2">
          <label className={labelCls}>Date format</label>
          <div className="flex gap-2">
            {(['DD/MM/YYYY', 'MM/DD/YYYY'] as const).map((f) => (
              <button key={f} type="button" onClick={() => setDateFormat(f)}
                className={optionBtnCls(dateFormat === f)}
                style={optionBtnStyle(dateFormat === f)}>
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
                className={optionBtnCls(timeFormat === f)}
                style={optionBtnStyle(timeFormat === f)}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <button type="button" onClick={handleSave}
          className="apex-btn-primary px-6 py-2 text-sm font-medium">
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
  const [autoAssign,      setAutoAssign]      = useState(true);
  const [defaultPriority, setDefaultPriority] = useState('MEDIUM');
  const [saving, setSaving] = useState(false);

  // Hydrate from server after mount (server wins for cross-device sync)
  useEffect(() => {
    usersApi.getPreferences()
      .then((remote: any) => {
        // Read local first so we can merge
        const localAA = typeof window !== 'undefined'
          ? localStorage.getItem('apex-pref-autoassign')
          : null;
        const localPri = typeof window !== 'undefined'
          ? localStorage.getItem('apex-pref-priority')
          : null;
        setAutoAssign(remote.autoAssign ?? (localAA !== null ? localAA !== 'false' : true));
        setDefaultPriority(remote.defaultPriority ?? localPri ?? 'MEDIUM');
      })
      .catch(() => {
        if (typeof window !== 'undefined') {
          const aa = localStorage.getItem('apex-pref-autoassign');
          setAutoAssign(aa !== null ? aa !== 'false' : true);
          setDefaultPriority(localStorage.getItem('apex-pref-priority') ?? 'MEDIUM');
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await usersApi.updatePreferences({ autoAssign, defaultPriority });
      localStorage.setItem('apex-pref-autoassign', autoAssign.toString());
      localStorage.setItem('apex-pref-priority', defaultPriority);
      toast.success('Preferences saved');
    } catch (err: any) {
      localStorage.setItem('apex-pref-autoassign', autoAssign.toString());
      localStorage.setItem('apex-pref-priority', defaultPriority);
      toast.error('Could not sync ticket preferences. Saved on this browser only.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Ticket Preferences</h3>
        <div
          className="flex items-center justify-between py-3 border-b"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Auto-assign tickets I create</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>Automatically assign new tickets to yourself</p>
          </div>
          <Toggle checked={autoAssign} onChange={setAutoAssign} />
        </div>
        <div>
          <label className={labelCls}>Default priority</label>
          <select value={defaultPriority} onChange={(e) => setDefaultPriority(e.target.value)} className={inputCls}>
            {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <button type="button" onClick={handleSave} disabled={saving}
          className="apex-btn-primary px-6 py-2 text-sm font-medium">
          {saving ? 'Saving…' : 'Save Preferences'}
        </button>
      </div>

      <div className={cardCls}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Onboarding</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Welcome screen</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>Show welcome screen again on this device</p>
          </div>
          <button
            type="button"
            onClick={() => { localStorage.removeItem('apexWelcomeSeen'); toast.success('Welcome screen will show on next login on this device'); }}
            className="text-sm font-medium px-4 py-1.5 rounded-lg transition-colors border"
            style={{
              borderColor: 'var(--border-primary)',
              backgroundColor: 'var(--surface-card)',
              color: 'var(--text-secondary)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-card)')}
          >
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
  const [form, setForm] = useState({ 
    companyName: 'TechnoEdge Learning Services', 
    tagline: '', 
    contactEmail: '', 
    timezone: 'Asia/Kolkata', 
    branding: 'Royal Blue' 
  });

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
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Company Information</h3>
        <div><label className={labelCls}>Company Name</label><input className={inputCls} value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} /></div>
        <div><label className={labelCls}>Tagline</label><input className={inputCls} value={form.tagline} onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))} placeholder="e.g. AI-powered workplace operations" /></div>
        <div><label className={labelCls}>Contact Email</label><input type="email" className={inputCls} value={form.contactEmail} onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))} placeholder="hr@company.com" /></div>
        <div>
          <label className={labelCls}>Company Timezone</label>
          <select 
            className={inputCls} 
            value={form.timezone || 'Asia/Kolkata'} 
            onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
          >
            <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
            <option value="UTC">Coordinated Universal Time (UTC)</option>
            <option value="America/New_York">America/New_York (EST/EDT)</option>
            <option value="Europe/London">Europe/London (GMT/BST)</option>
            <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Company Branding</label>
          <input 
            className={inputCls} 
            value={form.branding || 'Royal Blue'} 
            onChange={(e) => setForm((f) => ({ ...f, branding: e.target.value }))} 
            placeholder="e.g. Royal Blue, Emerald Green" 
          />
        </div>
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
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          Leave Quotas <span className="text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>(days/year)</span>
        </h3>
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
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Working Schedule</h3>
        {!canEdit && (
          <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>Read-only — contact your admin to change the schedule.</p>
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
  const [sla, setSla]           = useState({ URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 });
  const [reviewSla, setReviewSla] = useState({ URGENT: 2, HIGH: 4, MEDIUM: 24, LOW: 48 });

  useEffect(() => {
    if (!remote || !Object.keys(remote).length) return;
    const { reviewSla: rv, ...exec } = remote;
    setSla((s) => ({ ...s, ...exec }));
    if (rv) setReviewSla((s) => ({ ...s, ...rv }));
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
    save.mutate({ ...sla, reviewSla });
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div className={cardCls}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Execution SLA — Response Hours</h3>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Max hours before a ticket is overdue (SLA age timer), by priority.</p>
        <div className="grid grid-cols-2 gap-4">
          {(Object.entries(sla) as [keyof typeof sla, number][]).map(([priority, hours]) => (
            <div key={priority}>
              <label className={cn(labelCls, priorityColor[priority])}>{priority}</label>
              <div className="relative">
                <input type="number" min={1} className={inputCls} value={hours}
                  onChange={(e) => setSla((s) => ({ ...s, [priority]: Number(e.target.value) }))} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>hrs</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={cardCls}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Review SLA — Reviewer Deadline</h3>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Max hours a reviewer has to approve/reject after submission, by priority.</p>
        <div className="grid grid-cols-2 gap-4">
          {(Object.entries(reviewSla) as [keyof typeof reviewSla, number][]).map(([priority, hours]) => (
            <div key={priority}>
              <label className={cn(labelCls, priorityColor[priority])}>{priority}</label>
              <div className="relative">
                <input type="number" min={1} className={inputCls} value={hours}
                  onChange={(e) => setReviewSla((s) => ({ ...s, [priority]: Number(e.target.value) }))} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>hrs</span>
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

  const testEmail = useMutation({
    mutationFn: () => settingsApi.testEmail(form.email),
    onSuccess: (res: any) => toast.success(res?.message || 'Test email sent'),
    onError: (err: any) => toast.error(err?.message || 'Test email failed'),
  });

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>SMTP Configuration</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><label className={labelCls}>SMTP Host</label><input className={inputCls} value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp.gmail.com" /></div>
          <div><label className={labelCls}>Port</label><input type="number" className={inputCls} value={form.port} onChange={(e) => set('port', e.target.value)} /></div>
          <div><label className={labelCls}>From Email</label><input type="email" className={inputCls} value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="noreply@company.com" /></div>
          <div className="col-span-2">
            <label className={labelCls}>Password</label>
            <div className="relative">
              <input type={showPass ? 'text' : 'password'} className={`${inputCls} pr-10`} value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="App password or SMTP secret" />
              <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }}>
                {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <SaveBtn loading={save.isPending} />
          <button
            type="button"
            onClick={() => testEmail.mutate()}
            disabled={testEmail.isPending || !form.email}
            className="apex-btn apex-btn-secondary text-sm disabled:opacity-50"
          >
            <Mail size={12} />
            {testEmail.isPending ? 'Sending...' : 'Send Test Email'}
          </button>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Save SMTP changes before sending a test.
          </p>
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
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Task Types</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Task types help organise work by department. They appear in the ticket creation form based on the selected department.
        </p>
      </div>
      <div className="flex gap-6">
        {/* Department list sidebar */}
        <div className="w-48 flex-shrink-0">
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-tertiary)' }}>Department</p>
          <ul className="space-y-0.5">
            {deptList.map((d: any) => {
              const isActive = selectedDeptId === d.id;
              return (
                <li key={d.id ?? 'global'}>
                  <button
                    onClick={() => setSelectedDeptId(d.id)}
                    className="w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors"
                    style={{
                      backgroundColor: isActive ? 'var(--accent-subtle)' : 'transparent',
                      color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                      fontWeight: isActive ? 500 : 400,
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    {d.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Types list */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
              {selectedDeptId === null ? 'Global' : deptList.find((d: any) => d.id === selectedDeptId)?.name} Types
            </p>
            <button
              onClick={() => setAddTypeModal(true)}
              className="flex items-center gap-1.5 text-xs font-medium apex-btn-primary px-3 py-1.5"
            >
              + Add Type
            </button>
          </div>

          {deptTypes.length === 0 ? (
            <p className="text-sm py-4" style={{ color: 'var(--text-tertiary)' }}>No task types yet.</p>
          ) : (
            <div className="space-y-3">
              {deptTypes.map((type: any) => (
                <div key={type.id} className="apex-card p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{type.name}</span>
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{type.subtypes?.length ?? 0} subtypes</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setAddingSubtypeFor(type.id); setNewSubtypeName(''); }}
                        className="text-xs hover:underline"
                        style={{ color: 'var(--accent)' }}
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
                        <span
                          key={sub.id}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
                          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                        >
                          {sub.name}
                          <button
                            onClick={() => handleDeleteSubtype(type.id, sub.id)}
                            className="ml-0.5 hover:text-red-500"
                            style={{ color: 'var(--text-tertiary)' }}
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
                        className="flex-1 px-2 py-1 text-xs rounded apex-input"
                        style={{ padding: '0.25rem 0.5rem' }}
                      />
                      <button onClick={() => handleAddSubtype(type.id)} className="text-xs apex-btn-primary px-2 py-1">Add</button>
                      <button onClick={() => setAddingSubtypeFor(null)} className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Cancel</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add Type Modal */}
          {addTypeModal && (
            <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
              <div className="apex-card p-6 w-96 shadow-xl">
                <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Add Task Type</h3>
                <input
                  autoFocus
                  type="text"
                  value={newTypeName}
                  onChange={(e) => setNewTypeName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddType(); }}
                  placeholder="Type name..."
                  className="apex-input mb-4"
                />
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setAddTypeModal(false)}
                    className="px-4 py-2 text-sm rounded-lg border transition-colors"
                    style={{
                      borderColor: 'var(--border-primary)',
                      color: 'var(--text-secondary)',
                      backgroundColor: 'var(--surface-card)',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--surface-card)')}
                  >
                    Cancel
                  </button>
                  <button onClick={handleAddType} className="px-4 py-2 text-sm apex-btn-primary">Add Type</button>
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
// SECTION: Appearance (theme + accent + font size + compact mode)
// ─────────────────────────────────────────────────────────────────────────────
function AppearanceSettings() {
  const { theme, accent, setTheme, setAccent, setCompanyDefaults, resetToCompanyDefaults } = useTheme();
  const { user } = useAuthStore();
  const roleName = (user?.role as any)?.name ?? '';
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(roleName);

  const [companyTheme, setCompanyThemeState] = useState<ThemeId>('technoedge-light');
  const [companyAccent, setCompanyAccentState] = useState<AccentId>('royal-blue');
  const [savingDefaults, setSavingDefaults] = useState(false);

  // Font size
  const [fontSize, setFontSizeState] = useState<'small' | 'medium' | 'large'>(() =>
    typeof window !== 'undefined'
      ? ((localStorage.getItem('apex-font-size') as any) ?? 'medium')
      : 'medium',
  );

  const applyFontSize = (size: 'small' | 'medium' | 'large') => {
    setFontSizeState(size);
    localStorage.setItem('apex-font-size', size);
    document.documentElement.setAttribute('data-font-size', size);
  };

  // Compact mode
  const [compact, setCompactState] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? localStorage.getItem('apex-compact') === 'true'
      : false,
  );

  const applyCompact = (val: boolean) => {
    setCompactState(val);
    localStorage.setItem('apex-compact', String(val));
    document.documentElement.setAttribute('data-compact', String(val));
  };

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
        <p className="text-xs mt-1 font-medium px-3 py-2 rounded" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)', display: 'inline-block' }}>
          These appearance preferences apply only to this browser/device.
        </p>
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

      {/* Font Size */}
      <div>
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Font Size</h3>
        <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>Adjusts the base text size across the app</p>
        <div className="flex gap-3">
          {([
            { id: 'small',  label: 'Small',  desc: '12px' },
            { id: 'medium', label: 'Medium', desc: '13px' },
            { id: 'large',  label: 'Large',  desc: '15px' },
          ] as const).map(({ id, label, desc }) => (
            <button
              key={id}
              type="button"
              onClick={() => applyFontSize(id)}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all"
              style={{
                borderColor: fontSize === id ? 'var(--accent)' : 'var(--border-primary)',
                backgroundColor: fontSize === id ? 'var(--accent-subtle)' : 'var(--surface-card)',
                color: fontSize === id ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              {label}
              <span className="block text-xs mt-0.5" style={{ color: fontSize === id ? 'var(--accent-text)' : 'var(--text-tertiary)' }}>{desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Compact Mode */}
      <div className="rounded-xl p-4 border" style={{ backgroundColor: 'var(--surface-card)', borderColor: 'var(--border-primary)' }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Compact Mode</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>Reduces spacing for denser information display</p>
          </div>
          <Toggle checked={compact} onChange={applyCompact} />
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
            disabled={savingDefaults}
            onClick={async () => {
              setSavingDefaults(true);
              try {
                await settingsApi.updateCompany({ defaultTheme: companyTheme, defaultAccent: companyAccent });
                setCompanyDefaults(companyTheme, companyAccent);
                toast.success('Company theme defaults saved');
              } catch (err: any) {
                toast.error(err?.message || 'Failed to save company defaults');
              } finally {
                setSavingDefaults(false);
              }
            }}
            className="px-4 py-2 text-sm font-medium text-white rounded-xl disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            {savingDefaults ? 'Saving…' : 'Save Company Defaults'}
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
  | 'profile' | 'security' | 'appearance'
  | 'company' | 'policies' | 'smtp' | 'task-types';

export default function SettingsPage() {
  const { user } = useAuthStore();
  const roleName    = (user?.role as any)?.name ?? user?.role ?? '';
  const isAdmin     = ['ADMIN', 'SUPER_ADMIN'].includes(roleName);
  const isSuperAdmin = roleName === 'SUPER_ADMIN';
  const isManager   = ['MANAGER', 'TEAM_LEAD', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);

  const allowedTabs: SectionId[] = [
    'profile',
    'security',
    'appearance',
    ...(isAdmin ? (['company', 'policies', 'task-types'] as SectionId[]) : []),
  ];
  // Legacy tab aliases (deep-links from other pages still work)
  const tabAliases: Record<string, SectionId> = {
    preferences: 'profile', 'leave-policy': 'policies', sla: 'policies',
  };
  const [active, setActive] = useState<SectionId>('profile');

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('tab') ?? '';
    const resolved = (tabAliases[raw] ?? raw) as SectionId;
    setActive(resolved && allowedTabs.includes(resolved) ? resolved : 'profile');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleName]);

  // ── NavItem defined as closure — captures active / setActive ─────────────
  function NavItem({ id, label, icon, badge }: {
    id: SectionId; label: string; icon: React.ReactNode; badge?: string;
  }) {
    const isActive = active === id;
    return (
      <button
        onClick={() => setActive(id)}
        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all text-left"
        style={{
          backgroundColor: isActive ? 'var(--accent-subtle)' : 'transparent',
          color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
          fontWeight: isActive ? 500 : 400,
        }}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">{icon}</span>
        <span className="flex-1">{label}</span>
        {badge && (
          <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold bg-amber-100 text-amber-700">
            {badge}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="flex gap-6 max-w-5xl mx-auto">
      {/* ── LEFT SIDEBAR ─────────────────────────────────────────────────── */}
      <div className="w-52 flex-shrink-0">
        <nav className="sticky top-6 space-y-0.5 apex-card p-2">
          <p className="text-xs font-medium uppercase tracking-wider px-3 py-2" style={{ color: 'var(--text-tertiary)' }}>
            My Account
          </p>
          <NavItem id="profile"    label="Profile"    icon={<User size={15} />} />
          <NavItem id="appearance" label="Appearance" icon={<Palette size={15} />} />
          <NavItem id="security"   label="Security"   icon={<Shield size={15} />} />

          {isAdmin && (
            <>
              <div className="my-2 border-t" style={{ borderColor: 'var(--border-subtle)' }} />
              <p className="text-xs font-medium uppercase tracking-wider px-3 py-2" style={{ color: 'var(--text-tertiary)' }}>
                Workspace
              </p>
              <NavItem id="company"    label="Company"    icon={<Building2 size={15} />}    badge="ADM" />
              <NavItem id="policies"   label="Policies"   icon={<CalendarDays size={15} />} badge="ADM" />
              <NavItem id="task-types" label="Task Types" icon={<Tags size={15} />}          badge="ADM" />
            </>
          )}
        </nav>
      </div>

      {/* ── RIGHT CONTENT ────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        {active === 'profile' && (
          <div className="space-y-8">
            <ProfileSection user={user} />
            <div className="border-t pt-6" style={{ borderColor: 'var(--border-subtle)' }}>
              <h3 className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Preferences</h3>
              <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>Ticket defaults and notification settings</p>
              <PreferencesSection />
              <div className="mt-8">
                <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Notification Preferences</h3>
                <NotificationsSection isManager={isManager} />
              </div>
            </div>
          </div>
        )}
        {active === 'appearance'  && <AppearanceSettings />}
        {active === 'security'    && <SecuritySection user={user} />}
        {active === 'company'     && isAdmin && <CompanySection />}
        {active === 'policies'    && isAdmin && (
          <div className="space-y-8">
            <LeavePolicySection canEdit={isAdmin} />
            <div className="border-t pt-6" style={{ borderColor: 'var(--border-subtle)' }}>
              <h3 className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>SLA Settings</h3>
              <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>Response time targets for execution and review phases</p>
              <SlaSection />
            </div>
          </div>
        )}
        {active === 'task-types'  && isAdmin      && <TaskTypesSettings />}
      </div>
    </div>
  );
}
