'use client';

import { useState, useEffect } from 'react';
import NextImage from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@apex/core-identity';
import { settingsApi, taskTypesApi } from '@/lib/api';
import { authApi } from '@apex/core-identity/api';
import { usersApi } from '@apex/core-users/api';
import { departmentsApi } from '@apex/core-organization-departments/api';
import { UserAvatar } from '@apex/shared-ui/components/user-avatar';
import toast from 'react-hot-toast';
import {
  User, Shield, Palette, Building2,
  CalendarDays, Eye, EyeOff, Lock, Tags, Bell, UsersRound, Clock3, ClipboardCheck,
  ExternalLink, Globe2, IndianRupee, Mail, MapPin,
  ArrowLeft, Network,
} from 'lucide-react';
import { cn } from '@apex/shared-utilities';
import { useTheme, type ThemeId, type ThemeChoice, type AccentId } from '@apex/shared-utilities/use-theme';
import { applyAppearanceForUser, readAppearancePreference, resolveTheme, writeAppearancePreference } from '@apex/shared-utilities/appearance-preferences';
import { enablePushNotifications, supportsPushNotifications } from '@/lib/push-notifications';
import { TeamLeadershipSection } from './TeamLeadershipSection';
import { AvailabilityControl } from '@/components/profile/AvailabilityControl';
import { OrganizationHierarchySection } from './OrganizationHierarchySection';
import { ComplianceSettings } from '@/components/transitions/ComplianceSettings';

// ── Shared CSS-variable-aware styles ──────────────────────────────────────────
const inputCls  = 'apex-input';
const labelCls  = 'apex-label';
const cardCls   = 'apex-card p-6 space-y-4';

const AVATAR_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#14b8a6'];

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, disabled = false, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      className="relative w-10 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50"
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
      <Toggle checked={checked} onChange={onChange} label={label} />
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

function ReferenceHeading({ title, description }: { title: string; description: string }) {
  return <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div>
      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{description}</p>
    </div>
    <span className="w-fit rounded-full border px-3 py-1 text-xs font-medium" style={{ borderColor: 'var(--accent-border)', backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-text)' }}>Reference only</span>
  </div>;
}

function ReferenceValue({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-secondary)' }}>
    <p className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
    <p className="mt-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</p>
    {hint && <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>{hint}</p>}
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Profile
// ─────────────────────────────────────────────────────────────────────────────
function ProfileSection({ user }: { user: any }) {
  const [name, setName]   = useState(user?.name ?? '');
  const [bio, setBio]     = useState(user?.bio ?? '');
  const [color, setColor] = useState(user?.avatar ?? AVATAR_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [photoSaving, setPhotoSaving] = useState(false);
  const [crop, setCrop] = useState<{ file: File; url: string } | null>(null);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropX, setCropX] = useState(50);
  const [cropY, setCropY] = useState(50);
  const updateUser = useAuthStore((s) => s.updateUser);

  const roleName = (user?.role as any)?.name ?? user?.role ?? '';
  const deptName = (user?.department as any)?.name ?? '';
  const title = typeof user?.designation === 'string' && user.designation.trim()
    ? user.designation.trim() : roleName.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter: string) => letter.toUpperCase());

  useEffect(() => {
    setName(user?.name ?? '');
    setBio(user?.bio ?? '');
    setColor(user?.avatar ?? AVATAR_COLORS[0]);
  }, [user?.id, user?.name, user?.bio, user?.avatar]);

  useEffect(() => () => { if (crop) URL.revokeObjectURL(crop.url); }, [crop]);

  useEffect(() => {
    if (!crop) return;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setCrop(null); };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [crop]);

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

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type)) { toast.error('Use a JPG or PNG photo'); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error('Max 2MB'); return; }
    setCrop({ file, url: URL.createObjectURL(file) });
    setCropZoom(1); setCropX(50); setCropY(50);
    e.target.value = '';
  };

  const saveCroppedPhoto = async () => {
    if (!crop) return;
    setPhotoSaving(true);
    try {
      const image = new Image();
      image.src = crop.url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 512; canvas.height = 512;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image editor unavailable');
      const baseScale = Math.max(512 / image.naturalWidth, 512 / image.naturalHeight);
      const baseWidth = image.naturalWidth * baseScale;
      const baseHeight = image.naturalHeight * baseScale;
      // object-position followed by a centered CSS zoom, matching the preview.
      const width = baseWidth * cropZoom;
      const height = baseHeight * cropZoom;
      const left = 256 + ((512 - baseWidth) * cropX / 100 - 256) * cropZoom;
      const top = 256 + ((512 - baseHeight) * cropY / 100 - 256) * cropZoom;
      context.drawImage(image, left, top, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, crop.file.type, 0.9));
      if (!blob) throw new Error('Could not prepare photo');
      const file = new File([blob], crop.file.name, { type: crop.file.type });
      const data = await usersApi.uploadPhoto(file) as any;
      useAuthStore.setState((s: any) => ({ user: { ...s.user, photoUrl: data.photoUrl } }));
      setCrop(null);
      toast.success('Photo updated!');
    } catch { toast.error('Failed to upload photo'); }
    finally { setPhotoSaving(false); }
  };

  const handleRemovePhoto = async () => {
    try {
      await (usersApi as any).removePhoto();
      useAuthStore.setState((s: any) => ({ user: { ...s.user, photoUrl: null } }));
      toast.success('Photo removed');
    } catch { toast.error('Failed to remove photo'); }
  };

  return (
    <form onSubmit={handleSave}>
      <div className="apex-card overflow-visible p-5 sm:p-7">
        <div className="mb-6">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Your profile</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Introduce yourself to your team and manage how you appear across APEX OS.</p>
        </div>
        <div className="grid gap-6 xl:grid-cols-[minmax(280px,0.85fr)_minmax(0,1fr)] xl:gap-8">
          <section aria-label="Profile preview" className="min-w-0 overflow-visible rounded-2xl border" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--surface-card)' }}>
            <div className="relative h-28 overflow-hidden rounded-t-2xl" style={{ background: `linear-gradient(125deg, ${color} 0%, #18345c 62%, #10182d 100%)` }}>
              <div className="absolute -right-8 -top-12 h-40 w-40 rounded-full border border-white/20" />
              <div className="absolute right-16 top-8 h-24 w-24 rounded-full border border-white/15" />
            </div>
            <div className="relative px-5 pb-6">
              <div className="-mt-10 mb-3 flex items-end justify-between gap-2">
                <UserAvatar name={name} avatar={color} photoUrl={user?.photoUrl} size="lg" className="!h-20 !w-20 !text-2xl ring-4 ring-[var(--surface-card)]" />
                <span className="pb-1 text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>Live preview</span>
              </div>
              <h3 className="break-words text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{name.trim() || 'Your name'}</h3>
              <p className="mt-0.5 text-sm" style={{ color: 'var(--text-secondary)' }}>{title || 'Team member'}{deptName ? ` · ${deptName}` : ''}</p>
              <div className="mt-4"><AvailabilityControl align="left" /></div>
              <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>About</p>
                <p className="mt-2 min-h-10 whitespace-pre-wrap break-words text-sm" style={{ color: bio.trim() ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{bio.trim() || 'Add a short introduction so teammates know what you work on.'}</p>
              </div>
              <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>Work email</p>
                <p className="mt-1 break-all text-sm" style={{ color: 'var(--text-secondary)' }}>{user?.email ?? '—'}</p>
              </div>
            </div>
          </section>

          <section aria-label="Edit profile" className="min-w-0 space-y-6">
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Profile photo</h3>
              <p className="mb-3 mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>JPG or PNG, up to 2 MB. Your photo appears throughout APEX OS.</p>
              <div className="flex items-center gap-4">
                <UserAvatar name={name} avatar={color} photoUrl={user?.photoUrl} size="lg" />
                <div className="flex flex-wrap items-center gap-2">
                  <label className="cursor-pointer rounded-xl border px-3 py-2 text-sm font-medium transition-colors hover:bg-[var(--bg-tertiary)]" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
                    <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={handlePhotoUpload} disabled={photoSaving} aria-label="Upload profile photo" />
                    {photoSaving ? 'Uploading…' : 'Change photo'}
                  </label>
                  {user?.photoUrl && <button type="button" onClick={handleRemovePhoto} className="px-2 py-2 text-sm" style={{ color: 'var(--color-danger)' }}>Remove</button>}
                </div>
              </div>
              <p className="mb-2 mt-4 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Fallback avatar colour</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Fallback avatar colour">
                {AVATAR_COLORS.map((c) => <button key={c} type="button" onClick={() => setColor(c)} aria-label={`Use ${c} as avatar colour`} aria-pressed={color === c}
                  className="h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  style={{ background: c, borderColor: color === c ? 'var(--text-primary)' : 'transparent' }} />)}
              </div>
            </div>
            <div>
              <label htmlFor="profile-display-name" className={labelCls}>Display name</label>
              <input id="profile-display-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} maxLength={100} required autoComplete="name" />
              <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>This is the name teammates see on tickets and messages.</p>
            </div>
            <div>
              <label htmlFor="profile-bio" className={labelCls}>About me <span className="font-normal" style={{ color: 'var(--text-tertiary)' }}>({bio.length}/200)</span></label>
              <textarea id="profile-bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={200}
                className={`${inputCls} resize-none`} rows={4} placeholder="What do you work on? What should teammates know?" />
            </div>
            <div className="rounded-xl border p-3 text-xs" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
              Your role, department and work email are managed by the organization. Official personal information is handled separately with HR approval.
            </div>
            <SaveBtn loading={saving} label="Save profile" />
          </section>
        </div>
      </div>
      {crop && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="presentation">
        <div role="dialog" aria-modal="true" aria-labelledby="photo-crop-title" className="w-full max-w-sm rounded-2xl border p-5 shadow-2xl" style={{ backgroundColor: 'var(--surface-elevated)', borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}>
          <h3 id="photo-crop-title" className="text-lg font-semibold">Adjust your photo</h3>
          <p className="mb-4 mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Move and zoom the photo to choose what teammates see.</p>
          <div className="mx-auto h-48 w-48 overflow-hidden rounded-full border-4" style={{ borderColor: 'var(--border-primary)' }}>
            <img src={crop.url} alt="Profile photo crop preview" className="h-full w-full object-cover" style={{ objectPosition: `${cropX}% ${cropY}%`, transform: `scale(${cropZoom})` }} />
          </div>
          <div className="mt-5 space-y-3">
            <label className="block text-xs">Zoom<input type="range" min="1" max="2.5" step="0.05" value={cropZoom} onChange={(event) => setCropZoom(Number(event.target.value))} className="mt-1 w-full" /></label>
            <label className="block text-xs">Horizontal position<input type="range" min="0" max="100" value={cropX} onChange={(event) => setCropX(Number(event.target.value))} className="mt-1 w-full" /></label>
            <label className="block text-xs">Vertical position<input type="range" min="0" max="100" value={cropY} onChange={(event) => setCropY(Number(event.target.value))} className="mt-1 w-full" /></label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={photoSaving} onClick={() => setCrop(null)} className="rounded-lg border px-4 py-2 text-sm" style={{ borderColor: 'var(--border-primary)' }}>Cancel</button>
            <button type="button" disabled={photoSaving} onClick={saveCroppedPhoto} className="apex-btn-primary px-4 py-2 text-sm">{photoSaving ? 'Saving…' : 'Save photo'}</button>
          </div>
        </div>
      </div>}
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
                className={`${inputCls} pr-10`} required autoComplete={key === 'cur' ? 'current-password' : 'new-password'} />
              <button type="button" onClick={() => setShow((s) => ({ ...s, [key]: !s[key] }))}
                aria-label={`${show[key] ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
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
                : 'Unavailable'}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span style={{ color: 'var(--text-tertiary)' }}>Account status</span>
            <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium', user?.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600')}>
              {user?.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div className="flex items-center justify-between border-t py-2" style={{ borderColor: 'var(--border-subtle)' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>Current session</span>
            <span style={{ color: 'var(--text-secondary)' }}>Active in this browser</span>
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
  ticketResolved: true,
  ticketBlocked:  true,
  reviewPending:  true,
  projectCreated: true,
  breakOverrun:   true,
  workdayStart:   true,
  workdayEnd:     true,
  leaveApproved:  true,
  leaveRejected:  true,
  teamLeaveApply: true,
  attendanceCorrection: true,
  attendanceCorrectionDecided: true,
  inApp:          true,
  pushEnabled:    true,
  quietHoursEnabled: true,
  quietFrom:      '22:00',
  quietTo:        '08:00',
};

// Per-event channels (spec §4, §11.4). Notification Center always keeps every
// notification; these switches only decide popups and push. There is no email
// delivery path for these events yet, so no email switch is shown.
type ChannelKey = 'popup' | 'push';
const NOTIF_EVENTS: { group: 'Tickets' | 'Leave' | 'Workday & attendance' | 'Projects'; key: keyof typeof NOTIF_DEFAULTS; label: string; desc: string; managerOnly?: boolean }[] = [
  { group: 'Tickets', key: 'assignedTicket', label: 'Assigned to me', desc: 'A ticket is assigned to you' },
  { group: 'Tickets', key: 'statusChanged', label: 'Status changed', desc: 'A ticket you follow changes status' },
  { group: 'Tickets', key: 'commentAdded', label: 'New comment', desc: 'Someone comments on your ticket' },
  { group: 'Tickets', key: 'ticketResolved', label: 'Ticket resolved', desc: 'A ticket you raised is resolved' },
  { group: 'Tickets', key: 'ticketBlocked', label: 'Ticket blocked', desc: 'A ticket needs attention because it is blocked' },
  { group: 'Tickets', key: 'reviewPending', label: 'Review needed', desc: 'Work is waiting for your review' },
  { group: 'Leave', key: 'leaveApproved', label: 'Leave approved', desc: 'Your leave request is approved' },
  { group: 'Leave', key: 'leaveRejected', label: 'Leave rejected', desc: 'Your leave request is rejected' },
  { group: 'Leave', key: 'teamLeaveApply', label: 'Team leave request', desc: 'A team member applies for leave', managerOnly: true },
  { group: 'Workday & attendance', key: 'workdayStart', label: 'Start reminder', desc: 'Your workday is due to begin' },
  { group: 'Workday & attendance', key: 'workdayEnd', label: 'End reminder', desc: 'Your workday is due to end' },
  { group: 'Workday & attendance', key: 'breakOverrun', label: 'Break overrun', desc: 'A break exceeds its scheduled length' },
  { group: 'Workday & attendance', key: 'attendanceCorrection', label: 'Attendance correction', desc: 'A correction needs attention' },
  { group: 'Workday & attendance', key: 'attendanceCorrectionDecided', label: 'Correction decision', desc: 'Your attendance correction is decided' },
  { group: 'Projects', key: 'projectCreated', label: 'New project', desc: 'A project is created for your team' },
];

function ChannelSwitch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className="relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
      style={{ backgroundColor: checked ? 'var(--accent)' : 'var(--bg-tertiary)' }}
    >
      <span className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform" style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }} />
    </button>
  );
}

function notificationCacheKey(userId: string | null | undefined): string | null {
  return userId ? `apexNotifPrefs:${userId}` : null;
}

function readCachedNotificationPreferences(userId: string | null | undefined): Record<string, any> {
  const key = notificationCacheKey(userId);
  if (typeof window === 'undefined' || !key) return {};
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// Preferences are shared by several Settings screens. Keep this screen's
// payload limited to notification keys so an older tab cannot overwrite a
// newer Team operations (or other) save.
function notificationPreferencesOnly(value: unknown): Partial<typeof NOTIF_DEFAULTS> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return Object.fromEntries(
    (Object.keys(NOTIF_DEFAULTS) as Array<keyof typeof NOTIF_DEFAULTS>)
      .filter((key) => typeof source[key] === typeof NOTIF_DEFAULTS[key])
      .map((key) => [key, source[key]]),
  ) as Partial<typeof NOTIF_DEFAULTS>;
}

function NotificationsSection({ isManager }: { isManager: boolean }) {
  const userId = useAuthStore((state) => state.user?.id);
  const [prefs, setPrefs] = useState(NOTIF_DEFAULTS);
  const [channels, setChannels] = useState<Record<string, Partial<Record<ChannelKey | 'email', boolean>>>>({});
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [loadState, setLoadState] = useState<'loading' | 'server' | 'offline'>('loading');
  const [notificationTimezone, setNotificationTimezone] = useState('Asia/Kolkata');
  const [deviceStatus, setDeviceStatus] = useState<'checking' | 'enabled' | 'not-enabled' | 'blocked' | 'unsupported'>('checking');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ Tickets: true, Leave: true });
  const [saving, setSaving] = useState(false);
  const [enablingDevice, setEnablingDevice] = useState(false);

  // Hydrate from server prefs (falling back to localStorage) after mount
  useEffect(() => {
    if (!userId) return;
    let current = true;
    setLoadState('loading');
    usersApi.getPreferences()
      .then((remote: any) => {
        if (!current) return;
        const local = readCachedNotificationPreferences(userId);
        // Server wins over localStorage for cross-device sync; local is the cache
        const merged = { ...NOTIF_DEFAULTS, ...notificationPreferencesOnly(local), ...notificationPreferencesOnly(remote) };
        const savedChannels = remote?.channels ?? local.channels;
        const nextChannels = savedChannels && typeof savedChannels === 'object' && !Array.isArray(savedChannels) ? savedChannels : {};
        setPrefs(merged);
        setChannels(nextChannels);
        setSavedSnapshot(JSON.stringify({ prefs: merged, channels: nextChannels }));
        setNotificationTimezone(typeof remote?.timezone === 'string' ? remote.timezone : 'Asia/Kolkata');
        setLoadState('server');
      })
      .catch(() => {
        if (!current) return;
        // Offline fallback: use localStorage only
        const local = readCachedNotificationPreferences(userId);
        const nextPrefs = { ...NOTIF_DEFAULTS, ...notificationPreferencesOnly(local) };
        const nextChannels = local.channels && typeof local.channels === 'object' && !Array.isArray(local.channels) ? local.channels : {};
        setPrefs(nextPrefs);
        setChannels(nextChannels);
        setSavedSnapshot(JSON.stringify({ prefs: nextPrefs, channels: nextChannels }));
        setNotificationTimezone(typeof local.timezone === 'string' ? local.timezone : 'Asia/Kolkata');
        setLoadState('offline');
      });
    return () => { current = false; };
  }, [userId]);

  useEffect(() => {
    if (!supportsPushNotifications()) { setDeviceStatus('unsupported'); return; }
    if (Notification.permission === 'denied') { setDeviceStatus('blocked'); return; }
    let current = true;
    void navigator.serviceWorker.getRegistration('/').then(async (registration) => {
      const subscription = await registration?.pushManager.getSubscription();
      if (current) setDeviceStatus(subscription ? 'enabled' : 'not-enabled');
    }).catch(() => { if (current) setDeviceStatus('not-enabled'); });
    return () => { current = false; };
  }, []);

  const dirty = loadState !== 'loading' && savedSnapshot !== JSON.stringify({ prefs, channels });

  const toggle = (k: keyof typeof prefs) => setPrefs((p) => ({ ...p, [k]: !p[k] }));

  // A legacy `false` for an event reads as every channel off; a per-channel
  // choice wins over it, channel by channel.
  const channelOn = (eventKey: string, c: ChannelKey) => {
    const own = channels[eventKey]?.[c];
    return typeof own === 'boolean' ? own : (prefs as any)[eventKey] !== false;
  };
  const toggleChannel = (eventKey: string, c: ChannelKey) =>
    setChannels((ch) => ({ ...ch, [eventKey]: { ...(ch[eventKey] ?? {}), [c]: !channelOn(eventKey, c) } }));

  const handleSave = async () => {
    if (!userId || loadState === 'loading') return;
    setSaving(true);
    const body = { ...notificationPreferencesOnly(prefs), channels };
    try {
      await usersApi.updatePreferences(body);
      const key = notificationCacheKey(userId);
      if (key) localStorage.setItem(key, JSON.stringify(body));
      setSavedSnapshot(JSON.stringify({ prefs, channels }));
      setLoadState('server');
      toast.success('Notification preferences saved');
    } catch (err: any) {
      toast.error('Notification preferences were not saved. Please retry.');
    } finally {
      setSaving(false);
    }
  };

  const enableThisDevice = async () => {
    setEnablingDevice(true);
    try {
      const result = await enablePushNotifications();
      if (result === 'enabled') { setDeviceStatus('enabled'); toast.success('System notifications enabled on this device'); }
      else if (result === 'denied') { setDeviceStatus('blocked'); toast.error('Notifications are blocked in this browser'); }
      else if (result === 'unconfigured') toast.error('Server push is not configured yet');
      else toast.error('Push notifications are not supported on this device');
    } catch (error: any) {
      toast.error(error?.message ?? 'Could not enable system notifications');
    } finally {
      setEnablingDevice(false);
    }
  };

  if (loadState === 'loading') return <div className="apex-card p-5 text-sm" role="status">Loading notification preferences…</div>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Notifications</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }} data-testid="notification-center-note">
          Choose which events interrupt you. The bell keeps the full notification history even when popup or push alerts are off.
        </p>
        {loadState === 'offline' && <p className="mt-2 text-xs" role="status" style={{ color: 'var(--color-warning)' }}>Server unavailable. Showing this account’s saved browser copy; changes cannot be saved until the connection returns.</p>}
      </div>
      {(['Tickets', 'Leave', 'Workday & attendance', 'Projects'] as const).map((group) => (
        <div key={group} className="apex-card overflow-hidden p-0" data-testid={`notif-matrix-${group.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
          <button type="button" aria-expanded={!!expandedGroups[group]} onClick={() => setExpandedGroups((current) => ({ ...current, [group]: !current[group] }))}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]">
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{group}</span>
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{NOTIF_EVENTS.filter((event) => event.group === group && (!event.managerOnly || isManager)).length} events {expandedGroups[group] ? '−' : '+'}</span>
          </button>
          {expandedGroups[group] && <div className="border-t px-5 pb-4" style={{ borderColor: 'var(--border-primary)' }}>
            <div className="flex items-center gap-3 py-3">
              <span className="flex-1 text-xs" style={{ color: 'var(--text-secondary)' }}>Event</span>
              <span className="w-12 text-center text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Popup</span>
              <span className="w-12 text-center text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Push</span>
            </div>
          {NOTIF_EVENTS.filter((e) => e.group === group && (!e.managerOnly || isManager)).map((e) => (
            <div key={e.key} className="flex items-center gap-3 border-t py-3" style={{ borderColor: 'var(--border-subtle)' }} data-event={e.key}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{e.label}</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{e.desc}</p>
              </div>
              <span className="w-12 flex justify-center"><ChannelSwitch label={`${e.label}: popup`} checked={channelOn(e.key, 'popup')} disabled={!prefs.inApp} onChange={() => toggleChannel(e.key, 'popup')} /></span>
              <span className="w-12 flex justify-center"><ChannelSwitch label={`${e.label}: push`} checked={channelOn(e.key, 'push')} disabled={!prefs.pushEnabled} onChange={() => toggleChannel(e.key, 'push')} /></span>
            </div>
          ))}
          </div>}
        </div>
      ))}

      <div className={cardCls}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Delivery</h3>
        <ToggleRow label="Popup alerts" desc="Show a brief on-screen alert for selected events. The bell history remains available." checked={prefs.inApp} onChange={() => toggle('inApp')} />
        <ToggleRow label="System push alerts" desc="Send selected alerts to registered devices, including when Apex OS is in the background." checked={prefs.pushEnabled} onChange={() => toggle('pushEnabled')} />
        {prefs.pushEnabled && (
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--surface-sunken)' }}>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>This device</p>
            <p className="mt-1 text-xs" role="status" style={{ color: 'var(--text-secondary)' }}>
              {deviceStatus === 'enabled' ? 'Registered for push alerts.' : deviceStatus === 'blocked' ? 'Notifications are blocked in this browser. Allow them in browser settings.' : deviceStatus === 'unsupported' ? 'Push alerts are not supported in this browser.' : deviceStatus === 'checking' ? 'Checking browser permission…' : 'Not registered for push alerts.'}
            </p>
            {deviceStatus === 'not-enabled' && <button type="button" onClick={enableThisDevice} disabled={enablingDevice || dirty}
              className="apex-btn apex-btn-secondary mt-2 text-sm disabled:opacity-50">
              {enablingDevice ? 'Enabling…' : 'Enable on this device'}
            </button>}
            {deviceStatus === 'not-enabled' && dirty && <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>Save your changes first, then enable this device.</p>}
          </div>
        )}
        <div className="pt-3">
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Quiet hours</p>
          <p className="mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>Pause popup and push alerts during this time. Events still appear in the bell. Timezone: {notificationTimezone}.</p>
          <ToggleRow label="Use quiet hours" desc="Pause alerts between the times below." checked={prefs.quietHoursEnabled} onChange={() => toggle('quietHoursEnabled')} />
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label htmlFor="notification-quiet-from" className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>From</label>
              <input id="notification-quiet-from" type="time" disabled={!prefs.quietHoursEnabled} value={prefs.quietFrom} onChange={(e) => setPrefs((p) => ({ ...p, quietFrom: e.target.value }))} className={inputCls} />
            </div>
            <div className="flex-1">
              <label htmlFor="notification-quiet-to" className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>To</label>
              <input id="notification-quiet-to" type="time" disabled={!prefs.quietHoursEnabled} value={prefs.quietTo} onChange={(e) => setPrefs((p) => ({ ...p, quietTo: e.target.value }))} className={inputCls} />
            </div>
          </div>
        </div>
      </div>

      <div className="sticky bottom-3 z-30 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 shadow-lg" style={{ backgroundColor: 'var(--surface-elevated)', borderColor: dirty ? 'var(--accent)' : 'var(--border-primary)' }}>
        <div role="status" aria-live="polite"><p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{dirty ? 'Unsaved notification changes' : 'Notification settings saved'}</p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{dirty ? 'Save to use these choices on your other devices.' : 'Your choices are up to date.'}</p></div>
        <button type="button" onClick={handleSave} disabled={saving || !dirty}
          className="apex-btn apex-btn-primary px-5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Company (admin only)
// ─────────────────────────────────────────────────────────────────────────────
function CompanySection() {
  const qc = useQueryClient();
  const { data: remote, isLoading, isError, refetch } = useQuery({
    queryKey: ['settings', 'company'],
    queryFn: () => settingsApi.getCompany() as Promise<any>,
  });
  const [form, setForm] = useState({
    companyName: 'TechnoEdge Learning Services',
    logoUrl: '/brand/technoedge-logo.png',
    contactEmail: 'hr@technoedgels.com',
    website: 'https://www.technoedgels.com/',
    country: 'India',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    registeredOffice: 'Office No. B-2/201,\nUmang Premiere,\nG.No.677, 687(P), 6 Tal-Haveli,\nDist-Pune, Wagholi-412207,\nMaharashtra, India',
    headOffice: 'Baner Biz Bay,\nOffice No. B-704, B-705 & B-706,\n7th Floor, Laxman Nagar,\nBaner, Pune - 411045,\nMaharashtra, India',
  });

  // Sync from API once loaded
  useEffect(() => {
    if (remote) setForm((current) => ({
      companyName: remote.companyName || current.companyName,
      logoUrl: remote.logoUrl || current.logoUrl,
      contactEmail: remote.contactEmail || current.contactEmail,
      website: remote.website || current.website,
      country: remote.country || current.country,
      timezone: remote.timezone || current.timezone,
      currency: remote.currency || current.currency,
      registeredOffice: remote.registeredOffice || current.registeredOffice,
      headOffice: remote.headOffice || current.headOffice,
    }));
  }, [remote]);

  const save = useMutation({
    mutationFn: (data: any) => settingsApi.updateCompany(data),
    onSuccess: () => {
      toast.success('Organization profile saved');
      qc.invalidateQueries({ queryKey: ['settings', 'company'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to save'),
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate(Object.fromEntries(
      Object.entries(form).map(([key, value]) => [key, value.trim()]),
    ));
  };

  if (isLoading) return <p className="apex-card p-5 text-sm" role="status">Loading organization profile…</p>;
  if (isError) return <div className="apex-card p-5 text-sm" role="alert">Organization profile could not be loaded. <button type="button" className="underline" onClick={() => refetch()}>Retry</button></div>;

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className={cardCls}>
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Organization profile</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>The official identity, contact details and regional defaults used across APEX OS.</p>
        </div>

        <section
          className="overflow-hidden rounded-2xl border"
          style={{ borderColor: '#2666C4', backgroundColor: 'var(--bg-secondary)' }}
          aria-label="Organization identity preview"
        >
          <div className="h-2" style={{ background: 'linear-gradient(90deg, #01266A, #2666C4, #73C2FB)' }} />
          <div className="grid gap-5 p-5 sm:grid-cols-[112px_minmax(0,1fr)] sm:items-center">
            <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl border bg-white p-3 shadow-sm" style={{ borderColor: '#D8E9FF' }}>
              <NextImage src={form.logoUrl} alt="TechnoEdge organization logo" width={96} height={96} className="h-full w-full object-contain" priority />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: '#2666C4' }}>Organization identity</p>
              <h3 className="mt-1 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{form.companyName}</h3>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5" style={{ backgroundColor: '#F0F7FF', color: '#01266A' }}><MapPin size={13} />{form.country}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5" style={{ backgroundColor: '#F0F7FF', color: '#01266A' }}><IndianRupee size={13} />{form.currency}</span>
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5" style={{ backgroundColor: '#F0F7FF', color: '#01266A' }}><Clock3 size={13} />{form.timezone === 'Asia/Kolkata' ? 'IST' : form.timezone}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4" aria-labelledby="organization-contact-heading">
          <div>
            <h3 id="organization-contact-heading" className="font-semibold" style={{ color: 'var(--text-primary)' }}>Organization details</h3>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Information shown on official communication and company records.</p>
          </div>
          <div><label className={labelCls}>Organization name</label><input required autoComplete="organization" className={inputCls} value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} /></div>
          <div className="grid gap-4 md:grid-cols-2">
            <div><label className={labelCls}><Mail size={14} />Contact email</label><input required type="email" autoComplete="email" className={inputCls} value={form.contactEmail} onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))} /></div>
            <div><label className={labelCls}><Globe2 size={14} />Website</label><input required type="url" autoComplete="url" className={inputCls} value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} /></div>
          </div>
          <a href={form.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--accent)' }}>
            Visit organization website <ExternalLink size={14} aria-hidden="true" />
          </a>
        </section>

        <section className="space-y-4 border-t pt-5" style={{ borderColor: 'var(--border-subtle)' }} aria-labelledby="regional-defaults-heading">
          <div>
            <h3 id="regional-defaults-heading" className="font-semibold" style={{ color: 'var(--text-primary)' }}>Regional defaults</h3>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Used for dates, work schedules and financial values.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div><label className={labelCls}>Country</label><input required autoComplete="country-name" className={inputCls} value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} /></div>
            <div>
              <label className={labelCls}>Timezone</label>
              <select className={inputCls} value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}>
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                <option value="UTC">Coordinated Universal Time (UTC)</option>
                <option value="America/New_York">America/New_York (EST/EDT)</option>
                <option value="Europe/London">Europe/London (GMT/BST)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Currency</label>
              <select className={inputCls} value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                <option value="INR">Indian Rupee (INR ₹)</option>
                <option value="USD">US Dollar (USD $)</option>
                <option value="GBP">Pound Sterling (GBP £)</option>
                <option value="EUR">Euro (EUR €)</option>
              </select>
            </div>
          </div>
        </section>

        <section className="space-y-4 border-t pt-5" style={{ borderColor: 'var(--border-subtle)' }} aria-labelledby="office-locations-heading">
          <div>
            <h3 id="office-locations-heading" className="font-semibold" style={{ color: 'var(--text-primary)' }}>Office locations</h3>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Official addresses used for statutory records and correspondence.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div><label className={labelCls}>Registered office</label><textarea required rows={6} className={inputCls} value={form.registeredOffice} onChange={(e) => setForm((f) => ({ ...f, registeredOffice: e.target.value }))} /></div>
            <div><label className={labelCls}>Head office</label><textarea required rows={6} className={inputCls} value={form.headOffice} onChange={(e) => setForm((f) => ({ ...f, headOffice: e.target.value }))} /></div>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5" style={{ borderColor: 'var(--border-subtle)' }}>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Changes apply to organization-wide records.</p>
          <SaveBtn loading={save.isPending} label="Save organization profile" />
        </div>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Leave Policy (admin only)
// ─────────────────────────────────────────────────────────────────────────────
function LeavePolicySection({ canEdit = true }: { canEdit?: boolean }) {
  const qc = useQueryClient();
  const { data: remote, isLoading, isError, refetch } = useQuery({
    queryKey: ['settings', 'leave-policy'],
    queryFn: () => settingsApi.getLeavePolicy() as Promise<any>,
  });
  const { data: versions, isError: versionsError } = useQuery({
    queryKey: ['settings', 'leave-policy-versions'],
    queryFn: () => settingsApi.getLeavePolicyVersions() as Promise<any>,
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

  if (isLoading) return <p className="apex-card p-5 text-sm" role="status">Loading leave settings…</p>;
  if (isError) return <div className="apex-card p-5 text-sm" role="alert">Leave settings could not be loaded. <button type="button" className="underline" onClick={() => refetch()}>Retry</button></div>;

  if (!canEdit) return <div className="space-y-5">
    <section className={cardCls}>
      <ReferenceHeading title="Leave policy" description="Review the leave rules currently used by your organization. Policy publishing remains controlled by the leave administration workflow." />
      <div className="grid gap-3 sm:grid-cols-2">
        <ReferenceValue label="Policy authority" value={versions?.leaveAuthorityEnabled ? 'Versioned policy enabled' : 'Legacy allocation'} hint={versions?.leaveAuthorityEnabled ? 'Effective-dated policy rules are authoritative.' : 'Legacy role quotas remain in effect.'} />
        <ReferenceValue label="Working week" value={workingDays} hint="Schedule used for the legacy leave allocation." />
      </div>
    </section>
    <section className={cardCls}>
      <div>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Current policy versions</h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Effective dates and annual entitlements for published policies.</p>
      </div>
      {versionsError ? <p className="text-sm" role="alert">Policy versions could not be loaded.</p> : (versions?.policies ?? []).length === 0
        ? <p className="rounded-xl border p-4 text-sm" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>No active versioned leave policy is configured.</p>
        : <div className="space-y-3">{versions.policies.map((policy: any) => <div key={policy.id} className="rounded-xl border p-4" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{policy.name}</p>
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Version {policy.version} · {policy.financialYear}</span>
            </div>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Effective {new Date(policy.effectiveFrom).toLocaleDateString('en-IN')}{policy.effectiveTo ? ` to ${new Date(policy.effectiveTo).toLocaleDateString('en-IN')}` : ' with no end date'}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <ReferenceValue label="Total paid" value={`${policy.totalPaidLeaves} days`} />
              <ReferenceValue label="Casual" value={`${policy.casualLeaveAllocation} days`} />
              <ReferenceValue label="Emergency" value={`${policy.emergencyLeaveAllocation} days`} />
            </div>
          </div>)}</div>}
    </section>
    {!versions?.leaveAuthorityEnabled && <section className={cardCls}>
      <div>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Legacy annual entitlement</h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Role-based allocations shown while the legacy policy remains authoritative.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.entries(quotas) as [keyof typeof quotas, number][]).map(([role, days]) => <ReferenceValue key={role} label={role.replace('_', ' ')} value={`${days} days`} />)}
      </div>
    </section>}
  </div>;

  return (
    <form onSubmit={handleSave} className="space-y-5">
      {!canEdit && <p className="apex-card p-4 text-sm" role="status" style={{ color: 'var(--text-secondary)' }}>Current legacy quota settings are shown for reference. They are not the effective-dated leave policy. Editing is paused until entitlement rules, impact preview and historical safeguards are confirmed.</p>}
      <div className={cardCls}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Effective-dated policy versions</h3>
        {versionsError ? <p className="text-sm" role="alert">Policy versions could not be loaded.</p> : <>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Attendance leave authority: <strong>{versions?.leaveAuthorityEnabled ? 'Enabled' : 'Disabled — legacy allocation applies'}</strong></p>
          {(versions?.policies ?? []).length === 0 ? <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No versioned leave policy governs today.</p> :
            <div className="space-y-2">{versions.policies.map((policy: any) => <div key={policy.id} className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--border-primary)' }}>
              <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{policy.name} · v{policy.version} · {policy.financialYear}</p>
              <p style={{ color: 'var(--text-secondary)' }}>Effective {new Date(policy.effectiveFrom).toLocaleDateString('en-IN')}{policy.effectiveTo ? ` to ${new Date(policy.effectiveTo).toLocaleDateString('en-IN')}` : ''}</p>
              <p style={{ color: 'var(--text-secondary)' }}>Total {policy.totalPaidLeaves} · Casual {policy.casualLeaveAllocation} · Sick {policy.sickLeaveAllocation}</p>
            </div>)}</div>}
        </>}
      </div>
      <div className={cardCls}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          Leave Quotas <span className="text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>(days/year)</span>
        </h3>
        <div className="grid grid-cols-2 gap-4">
          {(Object.entries(quotas) as [keyof typeof quotas, number][]).map(([role, days]) => (
            <div key={role}>
              <label className={labelCls}>{role.replace('_', ' ')}</label>
              <input type="number" min={0} max={365} className={inputCls} value={days} disabled={!canEdit}
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
function SlaSection({ canEdit = true }: { canEdit?: boolean }) {
  const qc = useQueryClient();
  const { data: remote, isLoading, isError, refetch } = useQuery({
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

  if (isLoading) return <p className="apex-card p-5 text-sm" role="status">Loading SLA settings…</p>;
  if (isError) return <div className="apex-card p-5 text-sm" role="alert">SLA settings could not be loaded. <button type="button" className="underline" onClick={() => refetch()}>Retry</button></div>;

  if (!canEdit) return <div className="space-y-5">
    <section className={cardCls}>
      <ReferenceHeading title="Service levels" description="Review the response and decision targets applied to tickets. Changes require a versioned policy with an effective date and impact review." />
    </section>
    <section className={cardCls}>
      <div>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Ticket response targets</h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Maximum elapsed time before active work is treated as overdue.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.entries(sla) as [keyof typeof sla, number][]).map(([priority, hours]) => <ReferenceValue key={priority} label={priority} value={`${hours} hours`} />)}
      </div>
    </section>
    <section className={cardCls}>
      <div>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Review decision targets</h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Maximum time for an assigned reviewer to approve or reject submitted work.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.entries(reviewSla) as [keyof typeof reviewSla, number][]).map(([priority, hours]) => <ReferenceValue key={priority} label={priority} value={`${hours} hours`} />)}
      </div>
    </section>
  </div>;

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {!canEdit && <p className="apex-card p-4 text-sm" role="status" style={{ color: 'var(--text-secondary)' }}>These are the current SLA hours. Publishing a new policy needs an effective date, impact check and historical-ticket safeguards; edits are not enabled yet.</p>}
      <div className={cardCls}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Execution SLA — Response Hours</h3>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Max hours before a ticket is overdue (SLA age timer), by priority.</p>
        <div className="grid grid-cols-2 gap-4">
          {(Object.entries(sla) as [keyof typeof sla, number][]).map(([priority, hours]) => (
            <div key={priority}>
              <label className={cn(labelCls, priorityColor[priority])}>{priority}</label>
              <div className="relative">
                <input type="number" min={1} className={inputCls} value={hours} disabled={!canEdit}
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
                <input type="number" min={1} className={inputCls} value={hours} disabled={!canEdit}
                  onChange={(e) => setReviewSla((s) => ({ ...s, [priority]: Number(e.target.value) }))} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none" style={{ color: 'var(--text-tertiary)' }}>hrs</span>
              </div>
            </div>
          ))}
        </div>
        {canEdit && <SaveBtn loading={save.isPending} />}
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Workday Policy (admin only)
// ─────────────────────────────────────────────────────────────────────────────
function WorkdayPolicySection({ canEdit = true }: { canEdit?: boolean }) {
  const qc = useQueryClient();
  const { data: remote, isLoading, isError, refetch } = useQuery({
    queryKey: ['settings', 'workday-policy'],
    queryFn: () => settingsApi.getWorkdayPolicy() as Promise<any>,
  });

  const [form, setForm] = useState({
    timezone: 'Asia/Kolkata',
    minimumWorkdayMinutes: 540,
    employeeTiming: { start: '09:30', end: '18:30', flexible: false },
    tlTiming: { entryStart: '09:30', entryEnd: '10:30', exitStart: '18:30', exitEnd: '19:30', minimumWorkdayMinutes: 540 },
    managerTiming: { flexible: true },
    autoClose: true,
    autoCloseTime: '23:59',
  });

  useEffect(() => {
    if (remote) setForm((f) => ({ ...f, ...remote }));
  }, [remote]);

  const save = useMutation({
    mutationFn: (data: any) => settingsApi.updateWorkdayPolicy(data),
    onSuccess: () => {
      toast.success('Workday policy saved');
      qc.invalidateQueries({ queryKey: ['settings', 'workday-policy'] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to save'),
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    if (form.minimumWorkdayMinutes <= 0) return toast.error('Minimum workday must be > 0');
    save.mutate(form);
  };

  const update = (key: keyof typeof form, val: any) => setForm((f) => ({ ...f, [key]: val }));
  const updateNested = (parent: 'employeeTiming' | 'tlTiming', key: string, val: any) =>
    setForm((f) => ({ ...f, [parent]: { ...(f[parent] as any), [key]: val } }));

  if (isLoading) return <p className="apex-card p-5 text-sm" role="status">Loading workday settings…</p>;
  if (isError) return <div className="apex-card p-5 text-sm" role="alert">Workday settings could not be loaded. <button type="button" className="underline" onClick={() => refetch()}>Retry</button></div>;

  if (!canEdit) return <div className="space-y-5">
    <section className={cardCls}>
      <ReferenceHeading title="Work schedule" description="Review the standard attendance schedule by role. Publishing changes requires an effective date and checks against closed attendance and payroll periods." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ReferenceValue label="Timezone" value={form.timezone} />
        <ReferenceValue label="Minimum workday" value={`${form.minimumWorkdayMinutes} minutes`} />
        <ReferenceValue label="Automatic close" value={form.autoClose ? `Enabled at ${form.autoCloseTime}` : 'Disabled'} />
      </div>
    </section>
    <section className={cardCls}>
      <div>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Role schedules</h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Expected workday windows used for attendance insights and exceptions.</p>
      </div>
      <div className="divide-y rounded-xl border" style={{ borderColor: 'var(--border-subtle)' }}>
        <div className="grid gap-2 p-4 sm:grid-cols-[1.2fr_1fr] sm:items-center">
          <div><p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Employees and interns</p><p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Standard fixed schedule</p></div>
          <p className="text-sm sm:text-right" style={{ color: 'var(--text-secondary)' }}>{form.employeeTiming?.start ?? '—'}–{form.employeeTiming?.end ?? '—'}</p>
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-[1.2fr_1fr] sm:items-center">
          <div><p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Team leads</p><p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Flexible entry and exit windows</p></div>
          <p className="text-sm sm:text-right" style={{ color: 'var(--text-secondary)' }}>Entry {form.tlTiming?.entryStart ?? '—'}–{form.tlTiming?.entryEnd ?? '—'} · Exit {form.tlTiming?.exitStart ?? '—'}–{form.tlTiming?.exitEnd ?? '—'}</p>
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-[1.2fr_1fr] sm:items-center">
          <div><p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Managers and administrators</p><p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Leadership schedule</p></div>
          <p className="text-sm sm:text-right" style={{ color: 'var(--text-secondary)' }}>{form.managerTiming?.flexible ? 'Flexible timing' : 'Fixed timing'}</p>
        </div>
      </div>
    </section>
  </div>;

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {!canEdit && <p className="apex-card p-4 text-sm" role="status" style={{ color: 'var(--text-secondary)' }}>Current schedule values are shown for reference. Policy publication is paused until effective dates, impact preview and payroll-closed history checks are in place.</p>}
      <div className={cardCls}>
        <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Workday Policy</h3>
        {!canEdit && (
          <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>Read-only — contact your admin to change workday policies.</p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Company Timezone</label>
            <select className={inputCls} value={form.timezone} onChange={(e) => canEdit && update('timezone', e.target.value)} disabled={!canEdit}>
              <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
              <option value="UTC">Coordinated Universal Time (UTC)</option>
              <option value="America/New_York">America/New_York (EST/EDT)</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Minimum Workday (minutes)</label>
            <input type="number" min={1} className={inputCls} value={form.minimumWorkdayMinutes} onChange={(e) => canEdit && update('minimumWorkdayMinutes', Number(e.target.value))} disabled={!canEdit} />
          </div>
        </div>

        <div className="pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>Employee / Intern Timing</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Expected Start</label>
              <input type="time" className={inputCls} value={form.employeeTiming.start} onChange={(e) => canEdit && updateNested('employeeTiming', 'start', e.target.value)} disabled={!canEdit} required />
            </div>
            <div>
              <label className={labelCls}>Expected End</label>
              <input type="time" className={inputCls} value={form.employeeTiming.end} onChange={(e) => canEdit && updateNested('employeeTiming', 'end', e.target.value)} disabled={!canEdit} required />
            </div>
          </div>
        </div>

        <div className="pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <h4 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>Team Lead Timing</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Entry Window Start</label>
              <input type="time" className={inputCls} value={form.tlTiming.entryStart} onChange={(e) => canEdit && updateNested('tlTiming', 'entryStart', e.target.value)} disabled={!canEdit} required />
            </div>
            <div>
              <label className={labelCls}>Entry Window End</label>
              <input type="time" className={inputCls} value={form.tlTiming.entryEnd} onChange={(e) => canEdit && updateNested('tlTiming', 'entryEnd', e.target.value)} disabled={!canEdit} required />
            </div>
            <div>
              <label className={labelCls}>Exit Window Start</label>
              <input type="time" className={inputCls} value={form.tlTiming.exitStart} onChange={(e) => canEdit && updateNested('tlTiming', 'exitStart', e.target.value)} disabled={!canEdit} required />
            </div>
            <div>
              <label className={labelCls}>Exit Window End</label>
              <input type="time" className={inputCls} value={form.tlTiming.exitEnd} onChange={(e) => canEdit && updateNested('tlTiming', 'exitEnd', e.target.value)} disabled={!canEdit} required />
            </div>
            <div>
              <label className={labelCls}>TL Minimum Workday (minutes)</label>
              <input type="number" min={1} className={inputCls} value={form.tlTiming.minimumWorkdayMinutes} onChange={(e) => canEdit && updateNested('tlTiming', 'minimumWorkdayMinutes', Number(e.target.value))} disabled={!canEdit} />
            </div>
          </div>
        </div>

        <div className="pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Manager / Admin / SuperAdmin Timing</h4>
          <span className="px-3 py-1 bg-blue-100 text-blue-700 font-medium text-xs rounded-full">Flexible timing enabled</span>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
            Flexible timing means this role has no fixed expected start/end window — Auto Close below still applies to this role when enabled.
          </p>
        </div>

        <div className="pt-4 border-t flex items-center justify-between" style={{ borderColor: 'var(--border-subtle)' }}>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Auto Close</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>If enabled, Apex OS closes every open workday — including Manager, Admin, and SuperAdmin — at Auto Close Time below.</p>
          </div>
          <Toggle checked={form.autoClose} onChange={(v) => update('autoClose', v)} disabled={!canEdit} />
        </div>

        {form.autoClose && (
          <div className="pt-3 pb-1">
            <label className={labelCls}>Auto Close Time</label>
            <input type="time" className={inputCls} value={form.autoCloseTime} onChange={(e) => canEdit && update('autoCloseTime', e.target.value)} disabled={!canEdit} required />
          </div>
        )}


        <div className="pt-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Individual User Timing Overrides</h4>
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 text-sm italic text-center">
            Coming next: assign custom office timings for specific users.
          </div>
        </div>

        {canEdit && <SaveBtn loading={save.isPending} />}
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION: Task Types (admin only)
// ─────────────────────────────────────────────────────────────────────────────
function TaskTypesSettings() {
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null); // null = Global
  const [taxonomySearch, setTaxonomySearch] = useState('');
  const [editing, setEditing] = useState<{ kind: 'type' | 'subtype'; id: string; typeId?: string; name: string } | null>(null);
  const { data: allTypesRaw, refetch, isLoading, isError } = useQuery({
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
    (selectedDeptId === null ? t.isGlobal : t.departmentId === selectedDeptId) &&
    (!taxonomySearch.trim() || `${t.name} ${(t.subtypes ?? []).map((subtype: any) => subtype.name).join(' ')}`.toLowerCase().includes(taxonomySearch.toLowerCase().trim()))
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
      toast.success('Ticket type added');
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
    if (!confirm('Delete this ticket type and all its subtypes?')) return;
    try {
      await taskTypesApi.deleteType(id);
      refetch();
      toast.success('Ticket type deleted');
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

  const saveEdit = async () => {
    if (!editing?.name.trim()) return toast.error('Name is required');
    try {
      if (editing.kind === 'type') await taskTypesApi.updateType(editing.id, { name: editing.name.trim() });
      else await taskTypesApi.updateSubtype(editing.typeId!, editing.id, { name: editing.name.trim() });
      setEditing(null);
      refetch();
      toast.success('Ticket classification updated');
    } catch (error: any) { toast.error(error?.message || 'Could not update task classification'); }
  };

  if (isLoading) return <p className="apex-card p-5 text-sm" role="status">Loading ticket types…</p>;
  if (isError) return <div className="apex-card p-5 text-sm" role="alert">Ticket types could not be loaded. <button type="button" className="underline" onClick={() => refetch()}>Retry</button></div>;

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Ticket types</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Define the categories used to classify tickets by department. They appear in the ticket creation form for the selected department.
        </p>
        <input className="apex-input mt-4 w-full max-w-md" value={taxonomySearch} onChange={(event) => setTaxonomySearch(event.target.value)} placeholder="Search ticket types or subtypes" aria-label="Search ticket types and subtypes" />
      </div>
      <div className="flex flex-col gap-6 md:flex-row">
        {/* Department list sidebar */}
        <div className="w-full flex-shrink-0 md:w-48">
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
        <div className="min-w-0 flex-1">
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
            <p className="text-sm py-4" style={{ color: 'var(--text-tertiary)' }}>No ticket types yet.</p>
          ) : (
            <div className="space-y-3">
              {deptTypes.map((type: any) => (
                <div key={type.id} className="apex-card p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {editing?.kind === 'type' && editing.id === type.id
                        ? <input className="apex-input max-w-48 text-sm" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') saveEdit(); if (event.key === 'Escape') setEditing(null); }} aria-label="Edit ticket type name" />
                        : <span className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{type.name}</span>}
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{type.subtypes?.length ?? 0} subtypes</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {editing?.kind === 'type' && editing.id === type.id
                        ? <><button type="button" onClick={saveEdit} className="text-xs" style={{ color: 'var(--accent)' }}>Save</button><button type="button" onClick={() => setEditing(null)} className="text-xs">Cancel</button></>
                        : <button type="button" onClick={() => setEditing({ kind: 'type', id: type.id, name: type.name })} className="text-xs" style={{ color: 'var(--accent)' }}>Edit</button>}
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
                          {editing?.kind === 'subtype' && editing.id === sub.id
                            ? <><input className="apex-input max-w-28 text-xs" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') saveEdit(); if (event.key === 'Escape') setEditing(null); }} aria-label="Edit subtype name" /><button type="button" onClick={saveEdit} aria-label="Save subtype">✓</button></>
                            : <><span>{sub.name}</span><button type="button" onClick={() => setEditing({ kind: 'subtype', id: sub.id, typeId: type.id, name: sub.name })} aria-label={`Edit ${sub.name}`} style={{ color: 'var(--accent)' }}>Edit</button></>}
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
                <h3 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Add ticket type</h3>
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
// SECTION: Appearance (personal display controls and organization defaults)
// ─────────────────────────────────────────────────────────────────────────────
type DisplayDraft = {
  theme: ThemeChoice;
  accent: AccentId;
  fontSize: 'small' | 'medium' | 'large';
  compact: boolean;
  contrast: boolean;
  reduceMotion: boolean;
  sidebarDensity: 'comfortable' | 'compact';
};

function AppearanceSettings({ mode }: { mode: 'personal' | 'company' }) {
  const { user } = useAuthStore();
  const userId = user?.id;
  const { theme, accent, setTheme, setAccent, setCompanyDefaults } = useTheme(userId);
  const roleName = (user?.role as any)?.name ?? '';
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(roleName);

  const [companyTheme, setCompanyThemeState] = useState<ThemeId>('technoedge-light');
  const [companyAccent, setCompanyAccentState] = useState<AccentId>('royal-blue');
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [saved, setSaved] = useState<DisplayDraft | null>(null);
  const [draft, setDraft] = useState<DisplayDraft | null>(null);

  useEffect(() => {
    settingsApi.getCompany().then((company: any) => {
      const savedTheme: ThemeId = company?.defaultTheme === 'john-wick-dark' ? 'john-wick-dark' : 'technoedge-light';
      const savedAccent: AccentId = ['royal-blue', 'emerald', 'violet', 'gold', 'crimson', 'slate'].includes(company?.defaultAccent)
        ? company.defaultAccent : 'royal-blue';
      setCompanyThemeState(savedTheme);
      setCompanyAccentState(savedAccent);
      setCompanyDefaults(savedTheme, savedAccent);
    }).catch(() => { /* Device-local defaults remain available offline. */ });
  }, [setCompanyDefaults, userId]);

  useEffect(() => {
    if (!userId || mode !== 'personal') return;
    const size = readAppearancePreference(userId, 'font-size');
    const next: DisplayDraft = {
      theme, accent,
      fontSize: size === 'small' || size === 'large' ? size : 'medium',
      compact: readAppearancePreference(userId, 'compact') === 'true',
      contrast: readAppearancePreference(userId, 'contrast') === 'more',
      reduceMotion: readAppearancePreference(userId, 'motion') === 'reduce',
      sidebarDensity: readAppearancePreference(userId, 'sidebar-density') === 'compact' ? 'compact' : 'comfortable',
    };
    setSaved(next);
    setDraft(next);
  }, [accent, mode, theme, userId]);

  useEffect(() => {
    if (!draft || mode !== 'personal') return;
    const root = document.documentElement;
    root.setAttribute('data-theme', resolveTheme(draft.theme));
    root.setAttribute('data-accent', draft.accent);
    root.setAttribute('data-font-size', draft.fontSize);
    root.setAttribute('data-compact', String(draft.compact));
    root.setAttribute('data-contrast', draft.contrast ? 'more' : 'normal');
    root.setAttribute('data-motion', draft.reduceMotion ? 'reduce' : 'normal');
    root.setAttribute('data-sidebar-density', draft.sidebarDensity);
  }, [draft, mode]);

  useEffect(() => () => applyAppearanceForUser(userId), [userId]);

  const updateDraft = (changes: Partial<DisplayDraft>) => setDraft((current) => current ? { ...current, ...changes } : current);
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);

  const applyDraft = () => {
    if (!userId || !draft) return;
    writeAppearancePreference(userId, 'theme', draft.theme);
    writeAppearancePreference(userId, 'accent', draft.accent);
    writeAppearancePreference(userId, 'font-size', draft.fontSize);
    writeAppearancePreference(userId, 'compact', String(draft.compact));
    writeAppearancePreference(userId, 'contrast', draft.contrast ? 'more' : 'normal');
    writeAppearancePreference(userId, 'motion', draft.reduceMotion ? 'reduce' : 'normal');
    writeAppearancePreference(userId, 'sidebar-density', draft.sidebarDensity);
    setTheme(draft.theme);
    setAccent(draft.accent);
    setSaved({ ...draft });
    toast.success('Display settings saved');
  };

  const THEMES = [
    { id: 'technoedge-light', name: 'TechnoEdge Light', desc: 'Clean Professional', preview: { bg: '#f8fafc', sidebar: '#ffffff', accent: '#2563eb' }, active: true },
    { id: 'john-wick-dark', name: 'TechnoEdge Dark', desc: 'Matte Minimal', preview: { bg: '#050505', sidebar: '#0d0d0f', accent: '#fafafa' }, active: true },
  ] as const;

  const ACCENTS = [
    { id: 'royal-blue', color: '#2563eb', name: 'Royal Blue' },
    { id: 'emerald',    color: '#047857', name: 'Emerald' },
    { id: 'violet',     color: '#7c3aed', name: 'Violet' },
    { id: 'gold',       color: '#8a6900', name: 'Gold' },
    { id: 'crimson',    color: '#dc2626', name: 'Crimson' },
    { id: 'slate',      color: '#475569', name: 'Slate' },
  ] as const;

  return (
    <div className="space-y-8">
      {mode === 'personal' && <>
      <div>
        <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Display &amp; theme</h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Choose a comfortable, readable workspace.</p>
        <p className="text-xs mt-1 font-medium px-3 py-2 rounded" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)', display: 'inline-block' }}>
          Preview changes here, then apply to save for your account on this browser.
        </p>
      </div>

      {/* System Theme */}
      <div>
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Theme</h3>
        <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>Follow your device or choose a fixed theme.</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <button type="button" aria-pressed={draft?.theme === 'system'} disabled={!draft}
            onClick={() => updateDraft({ theme: 'system' })}
            className="rounded-xl border-2 p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{ borderColor: draft?.theme === 'system' ? 'var(--accent)' : 'var(--border-primary)', backgroundColor: 'var(--surface-card)' }}>
            <div className="mb-2 flex h-12 overflow-hidden rounded-lg"><span className="w-1/2 bg-slate-100" /><span className="w-1/2 bg-slate-900" /></div>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Follow device</p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Light or dark automatically</p>
          </button>
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={draft?.theme === t.id}
              disabled={!t.active}
              onClick={() => updateDraft({ theme: t.id as ThemeId })}
              className="relative text-left rounded-xl border-2 p-3 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                borderColor: draft?.theme === t.id ? 'var(--accent)' : 'var(--border-primary)',
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
              {draft?.theme === t.id && (
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
              type="button"
              aria-label={`${a.name} accent`}
              aria-pressed={draft?.accent === a.id}
              onClick={() => updateDraft({ accent: a.id as AccentId })}
              title={a.name}
              className="relative flex items-center justify-center transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                width: 36, height: 36,
                borderRadius: '50%',
                backgroundColor: a.color,
                boxShadow: draft?.accent === a.id
                  ? `0 0 0 3px var(--surface-card), 0 0 0 5px ${a.color}`
                  : 'none',
              }}
            >
              {draft?.accent === a.id && <span className="text-white text-sm font-bold">&#10003;</span>}
            </button>
          ))}
        </div>

        {/* Representative, non-interactive workspace preview. Semantic status colours stay independent of the accent. */}
        <div className="overflow-hidden rounded-xl border" style={{ backgroundColor: 'var(--surface-card)', borderColor: 'var(--border-primary)' }}>
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--surface-sunken)' }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Workspace preview</p>
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{ACCENTS.find((item) => item.id === draft?.accent)?.name ?? 'Royal Blue'} · {resolveTheme(draft?.theme ?? 'technoedge-light') === 'john-wick-dark' ? 'Dark' : 'Light'}</span>
          </div>
          <div role="img" aria-label={`Apex OS workspace preview with ${ACCENTS.find((item) => item.id === draft?.accent)?.name ?? 'Royal Blue'} accent`} className="flex min-h-[214px]">
            <div className="w-20 flex-shrink-0 space-y-2 border-r p-2 sm:w-28" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}>
              <div className="mb-4 flex items-center gap-1.5"><span className="h-5 w-5 rounded-md" style={{ backgroundColor: 'var(--accent)' }} /><span className="hidden text-[10px] font-bold sm:inline" style={{ color: 'var(--text-primary)' }}>APEX OS</span></div>
              <div className="rounded-md px-2 py-1.5 text-[10px] font-semibold" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-text)', borderLeft: '3px solid var(--accent)' }}>Home</div>
              <div className="px-2 py-1 text-[10px]" style={{ color: 'var(--text-secondary)' }}>Tickets</div>
              <div className="px-2 py-1 text-[10px]" style={{ color: 'var(--text-secondary)' }}>My Team</div>
            </div>
            <div className="min-w-0 flex-1 p-3" style={{ backgroundColor: 'var(--bg-primary)' }}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div><p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Good morning, Alex</p><p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Your workspace</p></div>
                <span className="rounded-md px-2 py-1 text-[10px] font-semibold text-white" style={{ backgroundColor: 'var(--accent)' }}>+ New ticket</span>
              </div>
              <div className="mb-3 flex gap-3 border-b text-[10px] font-semibold" style={{ borderColor: 'var(--border-primary)' }}>
                <span className="border-b-2 pb-1" style={{ borderColor: 'var(--accent)', color: 'var(--accent-text)' }}>Overview</span>
                <span style={{ color: 'var(--text-secondary)' }}>My work</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border p-2" style={{ backgroundColor: 'var(--surface-card)', borderColor: 'var(--border-primary)' }}>
                  <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Open tickets</p>
                  <p className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>12</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--bg-tertiary)' }}><div className="h-full w-2/3 rounded-full" style={{ backgroundColor: 'var(--accent)' }} /></div>
                </div>
                <div className="rounded-lg border p-2" style={{ backgroundColor: 'var(--surface-card)', borderColor: 'var(--border-primary)' }}>
                  <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>Team status</p>
                  <p className="mt-1 text-[10px] font-semibold" style={{ color: 'var(--text-primary)' }}><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--color-success)' }} />Available</p>
                  <p className="mt-1 text-[10px]" style={{ color: 'var(--text-secondary)' }}>Status colour stays distinct</p>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-[10px]" style={{ backgroundColor: 'var(--surface-card)', borderColor: 'var(--border-primary)' }}>
                <span className="truncate" style={{ color: 'var(--text-primary)' }}>Website update</span>
                <span className="whitespace-nowrap rounded-full px-2 py-0.5 font-semibold" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-text)' }}>In progress</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Font Size */}
      <div>
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Font Size</h3>
        <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>Adjusts text and layout scale across the workspace</p>
        <div className="flex gap-3">
          {([
            { id: 'small',  label: 'Small',  desc: 'Compact text' },
            { id: 'medium', label: 'Medium', desc: 'Default' },
            { id: 'large',  label: 'Large',  desc: 'Larger text' },
          ] as const).map(({ id, label, desc }) => (
            <button
              key={id}
              type="button"
              aria-pressed={draft?.fontSize === id}
              onClick={() => updateDraft({ fontSize: id })}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{
                borderColor: draft?.fontSize === id ? 'var(--accent)' : 'var(--border-primary)',
                backgroundColor: draft?.fontSize === id ? 'var(--accent-subtle)' : 'var(--surface-card)',
                color: draft?.fontSize === id ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              {label}
              <span className="block text-xs mt-0.5" style={{ color: draft?.fontSize === id ? 'var(--accent-text)' : 'var(--text-tertiary)' }}>{desc}</span>
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
          <Toggle checked={draft?.compact ?? false} onChange={(compact) => updateDraft({ compact })} disabled={!draft} label="Compact mode" />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Readability</h3>
        <div className="rounded-xl border p-4 flex items-center justify-between gap-4" style={{ backgroundColor: 'var(--surface-card)', borderColor: 'var(--border-primary)' }}>
          <div><p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Higher contrast</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>Stronger text and borders throughout the workspace.</p></div>
          <Toggle checked={draft?.contrast ?? false} onChange={(contrast) => updateDraft({ contrast })} disabled={!draft} label="Higher contrast" />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Motion &amp; navigation</h3>
        <div className="rounded-xl border p-4 flex items-center justify-between gap-4" style={{ backgroundColor: 'var(--surface-card)', borderColor: 'var(--border-primary)' }}>
          <div><p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Reduce motion</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>Minimise sliding and decorative animation. Your device preference is also respected.</p></div>
          <Toggle checked={draft?.reduceMotion ?? false} onChange={(reduceMotion) => updateDraft({ reduceMotion })} disabled={!draft} label="Reduce motion" />
        </div>
        <div className="rounded-xl border p-4" style={{ backgroundColor: 'var(--surface-card)', borderColor: 'var(--border-primary)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Sidebar spacing</p>
          <p className="text-xs mt-0.5 mb-3" style={{ color: 'var(--text-secondary)' }}>Adjust navigation independently of content density.</p>
          <div className="flex gap-2" role="group" aria-label="Sidebar spacing">
            {(['comfortable', 'compact'] as const).map((density) => (
              <button key={density} type="button" aria-pressed={draft?.sidebarDensity === density}
                onClick={() => updateDraft({ sidebarDensity: density })}
                className="rounded-lg border px-4 py-2 text-sm capitalize focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{ borderColor: draft?.sidebarDensity === density ? 'var(--accent)' : 'var(--border-primary)', backgroundColor: draft?.sidebarDensity === density ? 'var(--accent-subtle)' : 'var(--surface-card)', color: 'var(--text-primary)' }}>
                {density}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sticky bottom-3 z-30 flex flex-col gap-3 rounded-xl border p-3 shadow-lg sm:flex-row sm:items-center sm:justify-between"
        style={{ backgroundColor: 'var(--surface-elevated)', borderColor: dirty ? 'var(--accent)' : 'var(--border-primary)' }}>
        <div className="min-w-0" role="status" aria-live="polite">
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{dirty ? 'Unsaved display changes' : 'Display settings saved'}</p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{dirty ? 'Apply to keep this preview.' : 'Make a change to preview it.'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={applyDraft} disabled={!dirty} className="apex-btn apex-btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60">Apply changes</button>
          <button type="button" disabled={!dirty} onClick={() => { setDraft(saved); applyAppearanceForUser(userId); }} className="apex-btn apex-btn-secondary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
          <button type="button" onClick={() => updateDraft({
            theme: (localStorage.getItem('apex-company-theme') === 'john-wick-dark' ? 'john-wick-dark' : 'technoedge-light'),
            accent: (['royal-blue', 'emerald', 'violet', 'gold', 'crimson', 'slate'].includes(localStorage.getItem('apex-company-accent') || '') ? localStorage.getItem('apex-company-accent') : 'royal-blue') as AccentId,
            fontSize: 'medium', compact: false, contrast: false, reduceMotion: false, sidebarDensity: 'comfortable',
          })} className="px-2 py-2 text-sm underline" style={{ color: 'var(--accent-text)' }}>Reset to defaults</button>
        </div>
      </div>
      </>}

      {/* Admin: Company Defaults */}
      {mode === 'company' && isAdmin && (
        <div className="border-t pt-6" style={{ borderColor: 'var(--border-subtle)' }}>
          <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Organization theme</h3>
          <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>Set the starting theme for new accounts. Existing people keep their personal choice.</p>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            {THEMES.filter(t => t.active).map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={companyTheme === t.id}
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
              <button key={a.id} type="button" aria-label={`${a.name} organization accent`} aria-pressed={companyAccent === a.id} onClick={() => setCompanyAccentState(a.id as AccentId)} title={a.name}
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
                toast.success('Organization theme saved');
              } catch (err: any) {
                toast.error(err?.message || 'Failed to save company defaults');
              } finally {
                setSavingDefaults(false);
              }
            }}
            className="px-4 py-2 text-sm font-medium text-white rounded-xl disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            {savingDefaults ? 'Saving…' : 'Save organization theme'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POLICY CENTER — organization rules grouped into focused internal tabs
// ─────────────────────────────────────────────────────────────────────────────
type PolicyTab = 'leave' | 'workday' | 'task-types' | 'sla';

function PolicyCenter() {
  const [tab, setTab] = useState<PolicyTab>('leave');
  const tabs: Array<{ id: PolicyTab; label: string; icon: React.ReactNode }> = [
    { id: 'leave', label: 'Leave policy', icon: <CalendarDays size={16} /> },
    { id: 'workday', label: 'Work schedule', icon: <Clock3 size={16} /> },
    { id: 'task-types', label: 'Ticket types', icon: <Tags size={16} /> },
    { id: 'sla', label: 'Service levels', icon: <ClipboardCheck size={16} /> },
  ];

  return <section className="space-y-5">
    <header>
      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Policy</h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Manage the organization rules that govern leave, working time, ticket setup, and service standards.</p>
    </header>
    <nav aria-label="Policy sections" className="flex gap-2 overflow-x-auto border-b pb-px" style={{ borderColor: 'var(--border-subtle)' }}>
      {tabs.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}
        className="inline-flex flex-none items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors"
        style={{ borderColor: tab === item.id ? 'var(--accent)' : 'transparent', color: tab === item.id ? 'var(--accent)' : 'var(--text-secondary)' }}>
        {item.icon}{item.label}
      </button>)}
    </nav>
    {tab === 'leave' && <LeavePolicySection canEdit={false} />}
    {tab === 'workday' && <WorkdayPolicySection canEdit={false} />}
    {tab === 'task-types' && <TaskTypesSettings />}
    {tab === 'sla' && <SlaSection canEdit={false} />}
  </section>;
}

// ROOT — left sidebar layout
// ─────────────────────────────────────────────────────────────────────────────
type SectionId =
  | 'profile' | 'appearance' | 'notifications' | 'security' | 'team'
  | 'company' | 'policies' | 'hierarchy' | 'compliance';

type SettingsNavItem = { id: SectionId; label: string; icon: React.ReactNode; keywords: string };
type SettingsNavGroup = { label: string; items: SettingsNavItem[] };

export function SettingsCenter() {
  const { user } = useAuthStore();
  const roleName    = (user?.role as any)?.name ?? user?.role ?? '';
  const isAdmin     = ['ADMIN', 'SUPER_ADMIN'].includes(roleName);
  const isLead = ['MANAGER', 'TEAM_LEAD', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);
  const [active, setActive] = useState<SectionId>('profile');
  const accountItems: SettingsNavItem[] = [
    { id: 'profile', label: 'Profile', icon: <User size={16} />, keywords: 'photo avatar display name email bio department' },
    { id: 'appearance', label: 'Display & theme', icon: <Palette size={16} />, keywords: 'display theme appearance accent colour color font compact welcome screen' },
    { id: 'notifications', label: 'Notifications', icon: <Bell size={16} />, keywords: 'popup push ticket leave quiet hours' },
    { id: 'security', label: 'Security', icon: <Shield size={16} />, keywords: 'password sign in account session' },
  ];
  const teamItems: SettingsNavItem[] = isLead ? [
    { id: 'team', label: 'Team operations', icon: <UsersRound size={16} />, keywords: 'assignment approvals capacity escalation delivery rules' },
  ] : [];
  const organizationItems: SettingsNavItem[] = isAdmin ? [
    { id: 'company', label: 'Organization profile', icon: <Building2 size={16} />, keywords: 'company organization name email timezone branding theme accent' },
    { id: 'policies', label: 'Policy', icon: <ClipboardCheck size={16} />, keywords: 'leave work schedule ticket types service levels SLA' },
    { id: 'hierarchy', label: 'Organization hierarchy', icon: <Network size={16} />, keywords: 'organization chart reporting manager team lead department structure roles hierarchy' },
    { id: 'compliance', label: 'Compliance', icon: <Shield size={16} />, keywords: 'retention record legal hold delete rollout switch transfer resignation payroll acknowledgement' },
  ] : [];
  const groups: SettingsNavGroup[] = [
    { label: 'My account', items: accountItems },
    ...(teamItems.length ? [{ label: 'Team', items: teamItems }] : []),
    ...(organizationItems.length ? [{ label: 'Organization', items: organizationItems }] : []),
  ];
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('tab') ?? '';
    const mapped = ['leave-policy', 'leave', 'workday', 'task-types', 'sla', 'policies'].includes(raw) ? 'policies' : raw;
    const resolved = (mapped === 'preferences' ? 'notifications' : mapped) as SectionId;
    const allowedItems = [...accountItems, ...teamItems, ...organizationItems];
    const allowed = allowedItems.map((item) => item.id);
    setActive(allowed.includes(resolved) ? resolved : 'profile');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleName]);

  const leaveHierarchy = () => {
    setActive('profile');
    window.history.replaceState(null, '', '/settings?tab=profile');
  };

  if (active === 'hierarchy' && isAdmin) {
    return <div className="w-full max-w-none px-2 pb-8 sm:px-4">
      <div className="sticky top-2 z-30 mb-4 flex items-center justify-between gap-3 rounded-2xl border border-[var(--border-primary)] bg-[var(--surface-card)] px-3 py-2.5 shadow-sm sm:px-4">
        <button type="button" onClick={leaveHierarchy} className="apex-btn apex-btn-secondary inline-flex items-center gap-2 text-sm">
          <ArrowLeft size={16} /> Back to settings
        </button>
        <p className="hidden text-sm font-semibold text-[var(--text-primary)] sm:block">Organization hierarchy workspace</p>
      </div>
      <OrganizationHierarchySection />
    </div>;
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 sm:px-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>APEX OS</p>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>Settings</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Manage your account, preferences and authorized organization settings.</p>
      </header>
      <div className="flex flex-col gap-5 lg:flex-row lg:gap-7">
        <nav aria-label="Settings" className="apex-card h-fit w-full space-y-1 p-3 lg:sticky lg:top-6 lg:w-60 lg:flex-shrink-0">
          {groups.map((group, groupIndex) => <div key={group.label} className={cn(groupIndex > 0 && 'mt-3 border-t pt-3')} style={{ borderColor: 'var(--border-subtle)' }}>
            <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>{group.label}</p>
            <div className="space-y-1">
              {group.items.map((item) => <button key={item.id} type="button" onClick={() => {
                setActive(item.id);
                window.history.replaceState(null, '', `/settings?tab=${item.id}`);
              }} aria-current={active === item.id ? 'page' : undefined}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors"
                style={{ backgroundColor: active === item.id ? 'var(--accent-subtle)' : 'transparent', color: active === item.id ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: active === item.id ? 600 : 400 }}>
                {item.icon}<span>{item.label}</span>
              </button>)}
            </div>
          </div>)}
        </nav>
        <main className="min-w-0 flex-1" id="settings-content">
          {active === 'profile' && <ProfileSection user={user} />}
          {active === 'appearance' && <AppearanceSettings mode="personal" />}
          {active === 'notifications' && <NotificationsSection isManager={isLead} />}
          {active === 'security' && <SecuritySection user={user} />}
          {active === 'team' && isLead && <TeamLeadershipSection />}
          {active === 'company' && isAdmin && <div className="space-y-7"><CompanySection /><AppearanceSettings mode="company" /></div>}
          {active === 'policies' && isAdmin && <PolicyCenter />}
          {active === 'hierarchy' && isAdmin && <OrganizationHierarchySection />}
          {active === 'compliance' && isAdmin && <ComplianceSettings me={user ? { id: user.id } : undefined} isSuperAdmin={roleName === 'SUPER_ADMIN'} />}
        </main>
      </div>
    </div>
  );
}
