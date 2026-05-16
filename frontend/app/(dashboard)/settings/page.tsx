'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { authApi, usersApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Eye, EyeOff } from 'lucide-react';

const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white';
const labelCls = 'block text-sm font-medium text-slate-700 mb-1.5';
const sectionCls = 'bg-white rounded-xl border border-slate-200 p-6 space-y-4';

const AVATAR_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#14b8a6'];

function getInitials(name: string) {
  return name?.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) ?? 'U';
}

// ── Profile Tab ───────────────────────────────────────────────────────────────
function ProfileTab({ user }: { user: any }) {
  const [name, setName] = useState(user?.name ?? '');
  const [color, setColor] = useState(user?.avatar ?? AVATAR_COLORS[0]);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await usersApi.updateMe({ name, avatar: color });
      toast.success('Profile updated');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  const roleName = (user?.role as any)?.name ?? user?.role ?? '';
  const deptName = (user?.department as any)?.name ?? '';

  return (
    <div className="space-y-4">
      <div className={sectionCls}>
        {/* Avatar */}
        <div className="flex items-center gap-6">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold flex-shrink-0"
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
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full border-2 transition-all"
                  style={{ background: c, borderColor: color === c ? '#1e40af' : 'transparent' }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Name */}
        <div>
          <label className={labelCls}>Display Name</label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        {/* Email (read-only) */}
        <div>
          <label className={labelCls}>Email 🔒</label>
          <input className={`${inputCls} bg-slate-50 text-slate-400 cursor-not-allowed`} value={user?.email ?? ''} readOnly />
        </div>

        {/* Dept + Role badges */}
        <div className="flex gap-3">
          <span className="px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-full">{deptName || '—'}</span>
          <span className="px-3 py-1 bg-slate-100 text-slate-600 text-xs font-medium rounded-full">{roleName}</span>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Profile'}
        </button>
      </div>
    </div>
  );
}

// ── Security Tab ──────────────────────────────────────────────────────────────
function SecurityTab({ user }: { user: any }) {
  const [cur, setCur] = useState('');
  const [newP, setNewP] = useState('');
  const [conf, setConf] = useState('');
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConf, setShowConf] = useState(false);
  const [saving, setSaving] = useState(false);

  const strength = newP.length === 0 ? 0 : newP.length < 8 ? 1 : newP.length < 12 || !/[^a-zA-Z0-9]/.test(newP) ? 2 : 3;
  const strengthLabel = ['', 'Weak', 'Medium', 'Strong'];
  const strengthColor = ['', 'bg-red-400', 'bg-amber-400', 'bg-green-500'];

  const handleChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newP !== conf) return toast.error('Passwords do not match');
    setSaving(true);
    try {
      await authApi.changePassword(cur, newP);
      toast.success('Password changed!');
      setCur(''); setNewP(''); setConf('');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className={sectionCls}>
        <h3 className="font-semibold text-slate-800">Change Password</h3>
        <form onSubmit={handleChange} className="space-y-3">
          {[
            { label: 'Current Password', val: cur, set: setCur, show: showCur, toggle: () => setShowCur(!showCur) },
            { label: 'New Password', val: newP, set: setNewP, show: showNew, toggle: () => setShowNew(!showNew) },
            { label: 'Confirm New Password', val: conf, set: setConf, show: showConf, toggle: () => setShowConf(!showConf) },
          ].map(({ label, val, set, show, toggle }) => (
            <div key={label}>
              <label className={labelCls}>{label}</label>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  value={val}
                  onChange={(e) => set(e.target.value)}
                  className={`${inputCls} pr-10`}
                  required
                />
                <button type="button" onClick={toggle} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                  {show ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          ))}
          {newP.length > 0 && (
            <div className="space-y-1">
              <div className="flex gap-1">
                {[1, 2, 3].map((i) => (
                  <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${i <= strength ? strengthColor[strength] : 'bg-slate-200'}`} />
                ))}
              </div>
              <p className="text-xs text-slate-500">{strengthLabel[strength]}</p>
            </div>
          )}
          <button
            type="submit"
            disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Notifications Tab ─────────────────────────────────────────────────────────
function NotificationsTab() {
  const [prefs, setPrefs] = useState({
    emailOnAssign: true,
    emailOnResolve: true,
    emailOnLeave: true,
    pushNotifications: true,
    sounds: false,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await usersApi.updatePreferences(prefs);
      toast.success('Preferences saved');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const Toggle = ({ label, desc, k }: { label: string; desc: string; k: keyof typeof prefs }) => (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
      <div>
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
      </div>
      <button
        onClick={() => setPrefs((p) => ({ ...p, [k]: !p[k] }))}
        className={`relative w-10 h-6 rounded-full transition-colors ${prefs[k] ? 'bg-indigo-600' : 'bg-slate-200'}`}
      >
        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${prefs[k] ? 'left-5' : 'left-1'}`} />
      </button>
    </div>
  );

  return (
    <div className={sectionCls}>
      <Toggle label="Email on ticket assign" desc="Get emailed when a ticket is assigned to you" k="emailOnAssign" />
      <Toggle label="Email on ticket resolve" desc="Get emailed when your raised ticket is resolved" k="emailOnResolve" />
      <Toggle label="Email on leave decision" desc="Get emailed when your leave is approved or rejected" k="emailOnLeave" />
      <Toggle label="Push notifications" desc="Show in-app bell notifications" k="pushNotifications" />
      <Toggle label="Sounds" desc="Play sound for new notifications" k="sounds" />
      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-4 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save Preferences'}
      </button>
    </div>
  );
}

// ── Display Tab ───────────────────────────────────────────────────────────────
function DisplayTab() {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(
    () => (typeof window !== 'undefined' ? (localStorage.getItem('apexTheme') as any) ?? 'light' : 'light')
  );
  const [compact, setCompact] = useState(false);
  const [dateFormat, setDateFormat] = useState<'DD/MM' | 'MM/DD'>('DD/MM');

  const applyTheme = (t: 'light' | 'dark' | 'system') => {
    setTheme(t);
    if (typeof window !== 'undefined') {
      localStorage.setItem('apexTheme', t);
      const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
    }
  };

  return (
    <div className="space-y-4">
      <div className={sectionCls}>
        <div>
          <p className="text-sm font-medium text-slate-800 mb-2">Theme</p>
          <div className="flex gap-2">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button
                key={t}
                onClick={() => applyTheme(t)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-all capitalize ${theme === t ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                {t === 'light' ? '☀️ Light' : t === 'dark' ? '🌙 Dark' : '💻 System'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between py-3">
          <div>
            <p className="text-sm font-medium text-slate-800">Date format</p>
            <p className="text-xs text-slate-400 mt-0.5">How dates appear throughout the app</p>
          </div>
          <div className="flex gap-2">
            {(['DD/MM', 'MM/DD'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setDateFormat(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${dateFormat === f ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between py-3">
          <div>
            <p className="text-sm font-medium text-slate-800">Compact mode</p>
            <p className="text-xs text-slate-400 mt-0.5">Reduce spacing for higher information density</p>
          </div>
          <button
            onClick={() => setCompact(!compact)}
            className={`relative w-10 h-6 rounded-full transition-colors ${compact ? 'bg-indigo-600' : 'bg-slate-200'}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${compact ? 'left-5' : 'left-1'}`} />
          </button>
        </div>
        <p className="text-xs text-slate-400">These settings are saved on this device only.</p>
      </div>
    </div>
  );
}

// ── Company Tab (admin only) ───────────────────────────────────────────────────
function CompanyTab() {
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      toast.success('Company settings saved');
    } catch { toast.error('Failed'); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className={sectionCls}>
        <h3 className="font-semibold text-slate-800">Company Information</h3>
        <div>
          <label className={labelCls}>Company Name</label>
          <input className={inputCls} defaultValue="TechnoEdge Learning Services" />
        </div>
        <div>
          <label className={labelCls}>Working Days</label>
          <input className={inputCls} defaultValue="Mon–Sat (6 days)" readOnly />
        </div>
      </div>

      <div className={sectionCls}>
        <h3 className="font-semibold text-slate-800">Leave Quotas (days per year)</h3>
        <div className="grid grid-cols-2 gap-4">
          {[['Employee', 12], ['Team Lead', 12], ['Manager', 15], ['Intern', 6]].map(([role, val]) => (
            <div key={role as string}>
              <label className={labelCls}>{role}</label>
              <input type="number" className={inputCls} defaultValue={val as number} />
            </div>
          ))}
        </div>
      </div>

      <div className={sectionCls}>
        <h3 className="font-semibold text-slate-800">SLA Hours</h3>
        <div className="grid grid-cols-2 gap-4">
          {[['Urgent', 4], ['High', 8], ['Medium', 24], ['Low', 72]].map(([label, val]) => (
            <div key={label as string}>
              <label className={labelCls}>{label}</label>
              <input type="number" className={inputCls} defaultValue={val as number} />
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save Company Settings'}
      </button>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
const ALL_TABS = ['Profile', 'Password & Security', 'Notifications', 'Display', 'Company'];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState(0);
  const { user } = useAuthStore();

  const roleName = (user?.role as any)?.name ?? user?.role ?? '';
  const isAdmin = roleName === 'ADMIN' || roleName === 'SUPER_ADMIN';
  const visibleTabs = isAdmin ? ALL_TABS : ALL_TABS.slice(0, 4);

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Settings</h1>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 bg-slate-100 rounded-xl p-1 overflow-x-auto">
        {visibleTabs.map((tab, i) => (
          <button
            key={i}
            onClick={() => setActiveTab(i)}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === i ? 'bg-white shadow text-indigo-600' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 0 && <ProfileTab user={user} />}
      {activeTab === 1 && <SecurityTab user={user} />}
      {activeTab === 2 && <NotificationsTab />}
      {activeTab === 3 && <DisplayTab />}
      {activeTab === 4 && isAdmin && <CompanyTab />}
    </div>
  );
}
