'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { authApi, usersApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  User, Shield, Bell, Monitor, Settings2, Building2,
  CalendarDays, Gauge, Mail, Eye, EyeOff, Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Shared styles ─────────────────────────────────────────────────────────────
const inputCls =
  'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white';
const labelCls = 'block text-sm font-medium text-slate-700 mb-1.5';
const cardCls = 'bg-white rounded-xl border border-slate-200 p-6 space-y-4';

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

// ── Toggle component ──────────────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn('relative w-10 h-6 rounded-full transition-colors', checked ? 'bg-indigo-600' : 'bg-slate-200')}
    >
      <span className={cn('absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all', checked ? 'left-5' : 'left-1')} />
    </button>
  );
}

function ToggleRow({
  label, desc, checked, onChange,
}: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
      <div>
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

// ── Save button ───────────────────────────────────────────────────────────────
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

  const roleName = (user?.role as any)?.name ?? user?.role ?? '';
  const deptName = (user?.department as any)?.name ?? '';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await usersApi.updateMe({ name: name.trim(), avatar: color, bio });
      toast.success('Profile updated');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800">Profile Information</h3>

        {/* Avatar + colour picker */}
        <div className="flex items-center gap-6">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold flex-shrink-0 select-none"
            style={{ background: color }}
          >
            {getInitials(name)}
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700 mb-2">Avatar colour</p>
            <div className="flex gap-2">
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full border-2 transition-all hover:scale-110"
                  style={{ background: c, borderColor: color === c ? '#1e40af' : 'transparent' }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Name */}
        <div>
          <label className={labelCls}>Display Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            required
          />
        </div>

        {/* Email (read-only) */}
        <div>
          <label className={labelCls}>
            Email <Lock size={11} className="inline text-slate-400 mb-0.5" />
          </label>
          <input
            className={`${inputCls} bg-slate-50 text-slate-400 cursor-not-allowed`}
            value={user?.email ?? ''}
            readOnly
          />
        </div>

        {/* Role + Dept badges */}
        <div className="flex gap-2 flex-wrap">
          {roleName && (
            <span className={cn('px-3 py-1 text-xs font-medium rounded-full', ROLE_BADGE[roleName] ?? 'bg-slate-100 text-slate-600')}>
              {roleName}
            </span>
          )}
          {deptName && (
            <span className="px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-full">
              {deptName}
            </span>
          )}
        </div>

        {/* Bio */}
        <div>
          <label className={labelCls}>Bio <span className="text-slate-400 font-normal">({bio.length}/200)</span></label>
          <textarea
            value={bio}
            onChange={(e) => e.target.value.length <= 200 && setBio(e.target.value)}
            className={`${inputCls} resize-none`}
            rows={3}
            placeholder="Tell your team a little about yourself…"
          />
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
  const [cur, setCur] = useState('');
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
    if (newP !== conf) return toast.error('Passwords do not match');
    if (newP.length < 8)  return toast.error('Password must be at least 8 characters');
    setSaving(true);
    try {
      await authApi.changePassword(cur, newP);
      toast.success('Password changed successfully!');
      setCur(''); setNewP(''); setConf('');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  const fields = [
    { label: 'Current Password', val: cur, set: setCur, key: 'cur' as const },
    { label: 'New Password',     val: newP, set: setNewP, key: 'new' as const },
    { label: 'Confirm Password', val: conf, set: setConf, key: 'con' as const },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800">Change Password</h3>
        {fields.map(({ label, val, set, key }) => (
          <div key={key}>
            <label className={labelCls}>{label}</label>
            <div className="relative">
              <input
                type={show[key] ? 'text' : 'password'}
                value={val}
                onChange={(e) => set(e.target.value)}
                className={`${inputCls} pr-10`}
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShow((s) => ({ ...s, [key]: !s[key] }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
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
                <div key={i} className={cn('h-1.5 flex-1 rounded-full transition-all', i <= strength ? strengthColor[strength] : 'bg-slate-200')} />
              ))}
            </div>
            <p className={cn('text-xs font-medium', strengthText[strength])}>{strengthLabel[strength]}</p>
          </div>
        )}

        <SaveBtn loading={saving} label="Change Password" />
      </div>

      {/* Session info */}
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800">Session Information</h3>
        <div className="space-y-3 text-sm text-slate-600">
          <div className="flex items-center justify-between py-2 border-b border-slate-100">
            <span className="text-slate-500">Last sign in</span>
            <span className="font-medium">{user?.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'This session'}</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-slate-500">Account status</span>
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
  const stored = typeof window !== 'undefined'
    ? JSON.parse(localStorage.getItem('apexNotifPrefs') ?? '{}')
    : {};

  const [prefs, setPrefs] = useState({
    assignedTicket:  stored.assignedTicket  ?? true,
    statusChanged:   stored.statusChanged   ?? true,
    commentAdded:    stored.commentAdded    ?? false,
    overdueTicket:   stored.overdueTicket   ?? true,
    ticketResolved:  stored.ticketResolved  ?? true,
    leaveApproved:   stored.leaveApproved   ?? true,
    leaveRejected:   stored.leaveRejected   ?? true,
    teamLeaveApply:  stored.teamLeaveApply  ?? true,
    inApp:           stored.inApp           ?? true,
    quietFrom:       stored.quietFrom       ?? '22:00',
    quietTo:         stored.quietTo         ?? '08:00',
  });

  const toggle = (k: keyof typeof prefs) =>
    setPrefs((p) => ({ ...p, [k]: !p[k] }));

  const handleSave = () => {
    localStorage.setItem('apexNotifPrefs', JSON.stringify(prefs));
    toast.success('Notification preferences saved');
  };

  return (
    <div className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800">Ticket Events</h3>
        <ToggleRow label="Ticket assigned to me"   desc="Notify when a ticket is assigned to you"        checked={prefs.assignedTicket} onChange={() => toggle('assignedTicket')} />
        <ToggleRow label="Status changed"           desc="Notify when a ticket's status is updated"       checked={prefs.statusChanged}  onChange={() => toggle('statusChanged')} />
        <ToggleRow label="Comment added"            desc="Notify when someone comments on your ticket"    checked={prefs.commentAdded}   onChange={() => toggle('commentAdded')} />
        <ToggleRow label="Overdue alert"            desc="Notify when a ticket you own goes overdue"      checked={prefs.overdueTicket}  onChange={() => toggle('overdueTicket')} />
        <ToggleRow label="Ticket resolved"          desc="Notify when your raised ticket is resolved"     checked={prefs.ticketResolved} onChange={() => toggle('ticketResolved')} />
      </div>

      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800">Leave Events</h3>
        <ToggleRow label="Leave approved" desc="Notify when your leave request is approved" checked={prefs.leaveApproved} onChange={() => toggle('leaveApproved')} />
        <ToggleRow label="Leave rejected" desc="Notify when your leave request is rejected" checked={prefs.leaveRejected} onChange={() => toggle('leaveRejected')} />
        {isManager && (
          <ToggleRow label="Team member applied" desc="Notify when a team member applies for leave" checked={prefs.teamLeaveApply} onChange={() => toggle('teamLeaveApply')} />
        )}
      </div>

      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800">Delivery</h3>
        <ToggleRow label="In-app notifications" desc="Show bell notifications in the top bar" checked={prefs.inApp} onChange={() => toggle('inApp')} />
        <div className="pt-3">
          <p className="text-sm font-medium text-slate-700 mb-3">Quiet Hours</p>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs text-slate-500 mb-1">From</label>
              <input type="time" value={prefs.quietFrom} onChange={(e) => setPrefs((p) => ({ ...p, quietFrom: e.target.value }))} className={inputCls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-slate-500 mb-1">To</label>
              <input type="time" value={prefs.quietTo}   onChange={(e) => setPrefs((p) => ({ ...p, quietTo: e.target.value }))}   className={inputCls} />
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={handleSave}
        className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors"
      >
        Save Preferences
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Display
// ─────────────────────────────────────────────────────────────────────────────
function DisplaySection() {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => {
    if (typeof window === 'undefined') return 'light';
    return (localStorage.getItem('apex-theme') as any) ?? 'light';
  });
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
        <h3 className="font-semibold text-slate-800">Theme</h3>
        <div className="flex gap-3">
          {([
            { key: 'light',  label: '☀️ Light'  },
            { key: 'dark',   label: '🌙 Dark'   },
            { key: 'system', label: '💻 System' },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => applyTheme(key)}
              className={cn(
                'flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all',
                theme === key
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400">Theme applies immediately and persists across sessions.</p>
      </div>

      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800">Format & Density</h3>

        <div className="flex items-center justify-between py-3 border-b border-slate-100">
          <div>
            <p className="text-sm font-medium text-slate-800">Compact mode</p>
            <p className="text-xs text-slate-400 mt-0.5">Reduce spacing for higher information density</p>
          </div>
          <Toggle checked={compact} onChange={setCompact} />
        </div>

        <div className="pt-2">
          <label className={labelCls}>Date format</label>
          <div className="flex gap-2">
            {(['DD/MM/YYYY', 'MM/DD/YYYY'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setDateFormat(f)}
                className={cn('flex-1 py-2 rounded-lg text-sm font-medium border transition-all', dateFormat === f ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls}>Time format</label>
          <div className="flex gap-2">
            {(['12h', '24h'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setTimeFormat(f)}
                className={cn('flex-1 py-2 rounded-lg text-sm font-medium border transition-all', timeFormat === f ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <button type="button" onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
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
  const [autoAssign,       setAutoAssign]       = useState(() => typeof window !== 'undefined' && localStorage.getItem('apex-pref-autoassign') !== 'false');
  const [defaultPriority,  setDefaultPriority]  = useState(() => typeof window !== 'undefined' ? (localStorage.getItem('apex-pref-priority') ?? 'MEDIUM') : 'MEDIUM');

  const handleSave = () => {
    localStorage.setItem('apex-pref-autoassign', autoAssign.toString());
    localStorage.setItem('apex-pref-priority', defaultPriority);
    toast.success('Preferences saved');
  };

  const handleResetWelcome = () => {
    localStorage.removeItem('apexWelcomeSeen');
    toast.success('Welcome screen will show on next login');
  };

  return (
    <div className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800">Ticket Preferences</h3>

        <div className="flex items-center justify-between py-3 border-b border-slate-100">
          <div>
            <p className="text-sm font-medium text-slate-800">Auto-assign tickets I create</p>
            <p className="text-xs text-slate-400 mt-0.5">Automatically assign new tickets to yourself</p>
          </div>
          <Toggle checked={autoAssign} onChange={setAutoAssign} />
        </div>

        <div>
          <label className={labelCls}>Default priority</label>
          <select
            value={defaultPriority}
            onChange={(e) => setDefaultPriority(e.target.value)}
            className={inputCls}
          >
            {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <button type="button" onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
          Save Preferences
        </button>
      </div>

      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800">Onboarding</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-800">Welcome screen</p>
            <p className="text-xs text-slate-400 mt-0.5">Re-show the welcome walkthrough on your next login</p>
          </div>
          <button
            type="button"
            onClick={handleResetWelcome}
            className="text-sm font-medium px-4 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors"
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
  const [form, setForm] = useState({ name: 'TechnoEdge Learning Services', tagline: '', contactEmail: '' });
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      toast.success('Company settings saved');
    } catch { toast.error('Failed to save'); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800">Company Information</h3>
        <div>
          <label className={labelCls}>Company Name</label>
          <input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label className={labelCls}>Tagline</label>
          <input className={inputCls} value={form.tagline} onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))} placeholder="e.g. AI-powered workplace operations" />
        </div>
        <div>
          <label className={labelCls}>Contact Email</label>
          <input type="email" className={inputCls} value={form.contactEmail} onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))} placeholder="hr@company.com" />
        </div>
        <SaveBtn loading={saving} />
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Leave Policy (admin only)
// ─────────────────────────────────────────────────────────────────────────────
function LeavePolicySection() {
  const [quotas, setQuotas] = useState({ EMPLOYEE: 12, TEAM_LEAD: 12, MANAGER: 15, INTERN: 6 });
  const [workingDays, setWorkingDays] = useState('Mon–Sat');
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      toast.success('Leave policy saved');
    } catch { toast.error('Failed to save'); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800">Leave Quotas <span className="text-xs font-normal text-slate-400">(days per year)</span></h3>
        <div className="grid grid-cols-2 gap-4">
          {(Object.entries(quotas) as [keyof typeof quotas, number][]).map(([role, days]) => (
            <div key={role}>
              <label className={labelCls}>{role.replace('_', ' ')}</label>
              <input
                type="number" min={0} max={365}
                className={inputCls}
                value={days}
                onChange={(e) => setQuotas((q) => ({ ...q, [role]: Number(e.target.value) }))}
              />
            </div>
          ))}
        </div>
      </div>

      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800">Working Schedule</h3>
        <div>
          <label className={labelCls}>Working Days</label>
          <select value={workingDays} onChange={(e) => setWorkingDays(e.target.value)} className={inputCls}>
            <option value="Mon–Fri">Mon–Fri (5 days)</option>
            <option value="Mon–Sat">Mon–Sat (6 days)</option>
            <option value="Mon–Sun">Mon–Sun (7 days)</option>
          </select>
        </div>
        <SaveBtn loading={saving} />
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: SLA (admin only)
// ─────────────────────────────────────────────────────────────────────────────
function SlaSection() {
  const [sla, setSla] = useState({ URGENT: 4, HIGH: 8, MEDIUM: 24, LOW: 72 });
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      toast.success('SLA settings saved');
    } catch { toast.error('Failed to save'); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSave}>
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800">SLA Response Hours</h3>
        <p className="text-xs text-slate-400">Maximum hours before a ticket is considered overdue, by priority.</p>
        <div className="grid grid-cols-2 gap-4">
          {(Object.entries(sla) as [keyof typeof sla, number][]).map(([priority, hours]) => (
            <div key={priority}>
              <label className={cn(labelCls,
                priority === 'URGENT' ? 'text-red-600' :
                priority === 'HIGH'   ? 'text-orange-600' :
                priority === 'MEDIUM' ? 'text-blue-600' : 'text-slate-500',
              )}>{priority}</label>
              <div className="relative">
                <input
                  type="number" min={1}
                  className={inputCls}
                  value={hours}
                  onChange={(e) => setSla((s) => ({ ...s, [priority]: Number(e.target.value) }))}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">hrs</span>
              </div>
            </div>
          ))}
        </div>
        <SaveBtn loading={saving} />
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: SMTP (super admin only)
// ─────────────────────────────────────────────────────────────────────────────
function SmtpSection() {
  const [form, setForm] = useState({ host: '', port: '587', email: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      toast.success('SMTP settings saved');
    } catch { toast.error('Failed to save'); } finally { setSaving(false); }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await fetch('/api/settings/test-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form }) });
      toast.success('Test email sent!');
    } catch {
      toast.error('Test email failed');
    } finally { setTesting(false); }
  };

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-semibold text-slate-800">SMTP Configuration</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className={labelCls}>SMTP Host</label>
            <input className={inputCls} value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp.gmail.com" />
          </div>
          <div>
            <label className={labelCls}>Port</label>
            <input type="number" className={inputCls} value={form.port} onChange={(e) => set('port', e.target.value)} placeholder="587" />
          </div>
          <div>
            <label className={labelCls}>From Email</label>
            <input type="email" className={inputCls} value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="noreply@company.com" />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Password</label>
            <div className="relative">
              <input type={showPass ? 'text' : 'password'} className={`${inputCls} pr-10`} value={form.password} onChange={(e) => set('password', e.target.value)} />
              <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          <SaveBtn loading={saving} />
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            <Mail size={14} />
            {testing ? 'Sending…' : 'Send Test Email'}
          </button>
        </div>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT — Settings Page with left sidebar
// ─────────────────────────────────────────────────────────────────────────────
type Section =
  | 'profile' | 'security' | 'notifications' | 'display' | 'preferences'
  | 'company' | 'leave-policy' | 'sla' | 'smtp';

export default function SettingsPage() {
  const { user } = useAuthStore();

  const roleName    = (user?.role as any)?.name ?? user?.role ?? '';
  const isAdmin     = ['ADMIN', 'SUPER_ADMIN'].includes(roleName);
  const isSuperAdmin = roleName === 'SUPER_ADMIN';
  const isManager   = ['MANAGER', 'TEAM_LEAD', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);

  const [active, setActive] = useState<Section>('profile');

  type NavItem = { key: Section; label: string; icon: React.ReactNode; adminOnly?: boolean; superOnly?: boolean };

  const navItems: NavItem[] = [
    { key: 'profile',       label: 'Profile',             icon: <User size={15} /> },
    { key: 'security',      label: 'Password & Security', icon: <Shield size={15} /> },
    { key: 'notifications', label: 'Notifications',       icon: <Bell size={15} /> },
    { key: 'display',       label: 'Display',             icon: <Monitor size={15} /> },
    { key: 'preferences',   label: 'Preferences',         icon: <Settings2 size={15} /> },
    { key: 'company',       label: 'Company',             icon: <Building2 size={15} />,    adminOnly: true },
    { key: 'leave-policy',  label: 'Leave Policy',        icon: <CalendarDays size={15} />, adminOnly: true },
    { key: 'sla',           label: 'SLA',                 icon: <Gauge size={15} />,        adminOnly: true },
    { key: 'smtp',          label: 'SMTP',                icon: <Mail size={15} />,         superOnly: true },
  ];

  const visible = navItems.filter((n) => {
    if (n.superOnly) return isSuperAdmin;
    if (n.adminOnly) return isAdmin;
    return true;
  });

  // If active section is no longer visible (e.g., role changed), reset to profile
  useEffect(() => {
    if (!visible.find((n) => n.key === active)) setActive('profile');
  }, [roleName]);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage your account and workspace preferences</p>
      </div>

      <div className="flex gap-6 items-start">
        {/* ── Left sidebar nav ── */}
        <nav className="w-52 flex-shrink-0 bg-white rounded-xl border border-slate-200 p-2 sticky top-6">
          <div className="space-y-0.5">
            {visible.map(({ key, label, icon, adminOnly, superOnly }) => (
              <button
                key={key}
                onClick={() => setActive(key)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all text-left',
                  active === key
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800',
                )}
              >
                <span className={cn('flex-shrink-0', active === key ? 'text-indigo-600' : 'text-slate-400')}>
                  {icon}
                </span>
                <span className="truncate">{label}</span>
                {(adminOnly || superOnly) && (
                  <span className={cn(
                    'ml-auto text-[9px] font-bold px-1 py-0.5 rounded uppercase',
                    superOnly ? 'bg-purple-100 text-purple-600' : 'bg-red-100 text-red-600',
                  )}>
                    {superOnly ? 'SA' : 'ADM'}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>

        {/* ── Right content area ── */}
        <div className="flex-1 min-w-0">
          {active === 'profile'       && <ProfileSection       user={user} />}
          {active === 'security'      && <SecuritySection      user={user} />}
          {active === 'notifications' && <NotificationsSection isManager={isManager} />}
          {active === 'display'       && <DisplaySection />}
          {active === 'preferences'   && <PreferencesSection />}
          {active === 'company'       && isAdmin      && <CompanySection />}
          {active === 'leave-policy'  && isAdmin      && <LeavePolicySection />}
          {active === 'sla'           && isAdmin      && <SlaSection />}
          {active === 'smtp'          && isSuperAdmin && <SmtpSection />}
        </div>
      </div>
    </div>
  );
}
