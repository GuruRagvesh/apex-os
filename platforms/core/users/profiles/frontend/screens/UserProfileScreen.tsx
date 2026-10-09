'use client';

import { useState, useMemo, createContext, useContext } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@apex/core-identity';
import { analyticsApi } from '@apex/intelligence-analytics/api';
import { usersApi } from '@apex/core-users/api';
import { rolesApi } from '@apex/core-organization-roles/api';
import { departmentsApi } from '@apex/core-organization-departments/api';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { ChevronRight, Edit2, Upload, Eye, Clock, CheckCircle, AlertTriangle, RotateCcw, Building2, UsersRound } from 'lucide-react';

const fmtSeconds = (sec: number | null | undefined) => {
  if (sec == null) return '0h 0m';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
};

const fmtPct = (pct: number | null | undefined) => (pct == null ? '0%' : `${pct}%`);

const ProfileFormContext = createContext<any>(null);

const TABS = [
  { id: 'personal', label: 'Personal Details' },
  { id: 'employment', label: 'Employment Details' },
  { id: 'access', label: 'Account & Access' },
  { id: 'payroll', label: 'Payroll & Statutory' },
  { id: 'documents', label: 'Documents & Verification' },
  { id: 'approvals', label: 'Approval Workload' },
];

const DOCUMENT_TYPES = [
  { type: 'PROFILE_PHOTO', label: 'Profile Photo' },
  { type: 'AADHAAR', label: 'Aadhaar Card' },
  { type: 'PAN', label: 'PAN Card' },
  { type: 'ADDRESS_PROOF', label: 'Address Proof' },
  { type: 'BANK_PROOF', label: 'Bank Proof' },
  { type: 'OFFER_LETTER', label: 'Offer Letter' },
  { type: 'EDUCATION_CERT', label: 'Education Cert' },
  { type: 'OTHER', label: 'Other Document' },
];

const ROLE_PRESENTATION: Record<string, { label: string; badge: string }> = {
  SUPER_ADMIN: { label: 'SUPER ADMIN', badge: 'bg-violet-100 text-violet-800 ring-violet-200 dark:bg-violet-400/15 dark:text-white dark:ring-violet-300/80' },
  ADMIN: { label: 'ADMIN', badge: 'bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-400/15 dark:text-white dark:ring-rose-300/80' },
  MANAGER: { label: 'MANAGER', badge: 'bg-orange-100 text-orange-800 ring-orange-200 dark:bg-orange-400/15 dark:text-white dark:ring-orange-300/80' },
  TEAM_LEAD: { label: 'TEAM LEAD', badge: 'bg-blue-100 text-blue-800 ring-blue-200 dark:bg-blue-400/15 dark:text-white dark:ring-blue-300/80' },
  EMPLOYEE: { label: 'EMPLOYEE', badge: 'bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-400/15 dark:text-white dark:ring-emerald-300/80' },
  INTERN: { label: 'INTERN', badge: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-300/15 dark:text-white dark:ring-slate-300/80' },
};

const FALLBACK_ROLE_BADGE = 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-300/15 dark:text-white dark:ring-slate-300/80';
const HR_BADGE = 'bg-violet-100 text-violet-800 ring-violet-200 dark:bg-violet-400/15 dark:text-white dark:ring-violet-300/80';

const inputCls = 'apex-profile-value w-full px-4 py-3 rounded-xl border border-[var(--border-secondary)] bg-[var(--surface-card)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm';
const labelCls = 'apex-profile-label block text-sm font-bold mb-2';
const readCls = 'apex-profile-value w-full px-4 py-3 rounded-xl border border-[var(--border-primary)] bg-[var(--surface-sunken)] text-sm';
const sectionCls = 'apex-section-border bg-[var(--surface-sunken)] rounded-xl p-6 border';
const neutralButtonCls = 'border border-[var(--border-secondary)] bg-[var(--surface-card)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]';
const selectCls = 'apex-profile-value w-full px-4 py-3 rounded-xl border border-[var(--border-secondary)] bg-[var(--surface-card)] text-sm';
const metricCardCls = 'apex-section-border bg-[var(--surface-sunken)] p-4 rounded-xl border flex flex-col';
const metricLabelCls = 'apex-profile-label flex items-center gap-2 mb-2';
const metricValueCls = 'apex-profile-value text-3xl font-black';
const sectionHeadingCls = 'apex-profile-heading text-xl font-black';

const Field = ({ label, field, type = 'text', readOnly = false }: any) => {
  const ctx = useContext(ProfileFormContext);
  if (!ctx) return null;
  const { editMode, formData, setFormData, profile } = ctx;
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {editMode && !readOnly ? (
        <input
          type={type}
          value={formData[field] ?? ''}
          onChange={(e) => setFormData((f: any) => ({ ...f, [field]: e.target.value }))}
          className={inputCls}
        />
      ) : (
        <div className={readCls}>{profile?.[field] || <span className="text-[var(--text-tertiary)]">Not set</span>}</div>
      )}
    </div>
  );
};

const SelectField = ({ label, field, options, readOnly = false }: any) => {
  const ctx = useContext(ProfileFormContext);
  if (!ctx) return null;
  const { editMode, formData, setFormData, profile } = ctx;
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {editMode && !readOnly ? (
        <select
          value={formData[field] ?? ''}
          onChange={(e) => setFormData((f: any) => ({ ...f, [field]: e.target.value }))}
          className={inputCls}
        >
          <option value="">Select...</option>
          {options.map((o: string) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <div className={readCls}>{profile?.[field] || <span className="text-[var(--text-tertiary)]">Not set</span>}</div>
      )}
    </div>
  );
};

export default function UserProfileScreen() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user: currentUser } = useAuthStore();
  const qc = useQueryClient();

  const userId = params.id as string;
  const fromContext = searchParams.get('from');
  const deptId = searchParams.get('deptId');
  const deptName = searchParams.get('deptName') ? decodeURIComponent(searchParams.get('deptName')!) : null;

  const [activeTab, setActiveTab] = useState('personal');
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState<any>({});
  const [uploading, setUploading] = useState<string | null>(null);

  const currentRoleName = (currentUser?.role as any)?.name ?? '';
  const isHR = (currentUser as any)?.isHR;
  const canEditAll = ['SUPER_ADMIN', 'ADMIN'].includes(currentRoleName) || isHR;

  /**
   * Account & Access is a NARROWER permission than the rest of the profile.
   *
   * canEditAll includes HR, who may edit somebody's phone number and payroll
   * details. Deciding who is an administrator is not the same job, so authority
   * is administrators only. The server enforces this independently -- the route
   * is @Roles(ADMIN, SUPER_ADMIN) -- and this only decides whether the control
   * is worth showing.
   */
  const canEditAccess = ['SUPER_ADMIN', 'ADMIN'].includes(currentRoleName);

  const [accessEdit, setAccessEdit] = useState(false);
  const [accessForm, setAccessForm] = useState<any>({});

  const { data: roleOptions } = useQuery({
    queryKey: ['roles'],
    queryFn: () => (rolesApi as any).getAll() as Promise<any[]>,
    enabled: canEditAccess,
    staleTime: 5 * 60_000,
  });
  const { data: departmentOptions } = useQuery({
    queryKey: ['departments'],
    queryFn: () => (departmentsApi as any).getAll() as Promise<any[]>,
    enabled: canEditAccess,
    staleTime: 5 * 60_000,
  });

  /**
   * Authority goes through PUT /users/:id, NOT the profile endpoint.
   *
   * They are deliberately different routes: the profile save cannot change a
   * role or the HR flag, so a form that looks like it edits a phone number can
   * never quietly grant HR authority. This one is whitelisted server-side to
   * exactly the account-access fields.
   */
  const accessMutation = useMutation({
    mutationFn: (data: any) => (usersApi as any).update(userId, data),
    onSuccess: () => {
      toast.success('Account access updated');
      setAccessEdit(false);
      // Refetched everywhere it is shown, so nobody has to wonder whether the
      // save worked: this page, the header badge and the Users list.
      qc.invalidateQueries({ queryKey: ['user-profile', userId] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.message ?? err?.message;
      toast.error(
        typeof detail === 'string' && detail.length < 200
          ? detail
          : 'The account could not be updated.',
      );
    },
  });

  const startAccessEdit = () => {
    setAccessForm({
      roleId: (profile as any)?.role?.id ?? '',
      departmentId: (profile as any)?.departmentId ?? '',
      isHR: !!(profile as any)?.isHR,
      isActive: (profile as any)?.isActive !== false,
    });
    setAccessEdit(true);
  };

  const selectedRoleName =
    (Array.isArray(roleOptions) ? roleOptions : []).find((r: any) => r.id === accessForm.roleId)
      ?.name ?? '';
  // ADMIN + HR is the HR ADMIN and is offered normally. Only SUPER_ADMIN is
  // refused, and the server refuses it independently.
  const accessIsSuperAdmin = selectedRoleName === 'SUPER_ADMIN';

  const saveAccess = () =>
    accessMutation.mutate({
      roleId: accessForm.roleId || undefined,
      departmentId: accessForm.departmentId || null,
      isHR: accessIsSuperAdmin ? false : !!accessForm.isHR,
      isActive: !!accessForm.isActive,
    });
  const isOwnProfile = currentUser?.id === userId;
  const canSeePayroll = canEditAll || isOwnProfile;
  const canSeeAccess = ['SUPER_ADMIN', 'ADMIN'].includes(currentRoleName);

  const { data: profile, isLoading, refetch } = useQuery({
    queryKey: ['user-profile', userId],
    queryFn: () => (usersApi as any).getProfile(userId) as Promise<any>,
  });

  const { data: documents, refetch: refetchDocs } = useQuery({
    queryKey: ['user-documents', userId],
    queryFn: () => (usersApi as any).getDocuments(userId) as Promise<any[]>,
  });

  const { data: reviewerMetrics, isLoading: reviewerMetricsLoading } = useQuery({
    queryKey: ['reviewer-metrics', userId],
    queryFn: () => analyticsApi.getReviewerMetrics(userId) as Promise<any>,
    enabled: ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(profile?.role?.name ?? ''),
  });

  const updateMutation = useMutation({
    mutationFn: (data: any) => (usersApi as any).updateProfile(userId, data),
    onSuccess: () => {
      toast.success('Profile updated!');
      qc.invalidateQueries({ queryKey: ['user-profile', userId] });
      qc.invalidateQueries({ queryKey: ['users'] });
      setEditMode(false);
    },
    onError: (e: any) => toast.error(e?.message || 'Update failed'),
  });

  // Admin Correction — separate from the Personal Details form above. Email there is
  // read-only; this is the deliberate, audited path for fixing a login email/user id.
  const [correctionEmail, setCorrectionEmail] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');

  const adminCorrectionMutation = useMutation({
    mutationFn: () => (usersApi as any).adminCorrectEmail(userId, correctionEmail.trim(), correctionReason.trim()),
    onSuccess: () => {
      toast.success('Login email corrected');
      qc.invalidateQueries({ queryKey: ['user-profile', userId] });
      qc.invalidateQueries({ queryKey: ['users'] });
      setCorrectionEmail('');
      setCorrectionReason('');
    },
    onError: (e: any) => toast.error(e?.message || 'Could not correct email'),
  });

  const handleSaveCorrection = () => {
    if (!window.confirm('This will change the user’s login email. Internal user ID will not change.')) return;
    adminCorrectionMutation.mutate();
  };

  const handleEditToggle = () => {
    setFormData({ ...profile });
    setEditMode((v) => !v);
  };

  const handleSave = () => updateMutation.mutate(formData);

  const handleDocumentUpload = async (docType: string, file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error('Max 5MB'); return; }
    setUploading(docType);
    try {
      await (usersApi as any).uploadDocument(userId, file, docType);
      toast.success('Document uploaded!');
      refetchDocs();
    } catch { toast.error('Upload failed'); }
    finally { setUploading(null); }
  };

  const handleVerifyDoc = async (docId: string, status: 'VERIFIED' | 'REJECTED', reason?: string) => {
    try {
      await (usersApi as any).verifyDocument(userId, docId, status, reason);
      toast.success(status === 'VERIFIED' ? 'Document verified!' : 'Document rejected');
      refetchDocs();
    } catch { toast.error('Failed'); }
  };

  const handleDeleteDoc = async (docId: string) => {
    if (!confirm('Delete this document?')) return;
    try {
      await (usersApi as any).deleteDocument(userId, docId);
      toast.success('Document deleted');
      refetchDocs();
    } catch { toast.error('Failed to delete document'); }
  };

  const breadcrumbs = useMemo(() => {
    if (fromContext === 'department' && deptId && deptName) {
      return [
        { label: 'Departments', href: '/departments' },
        { label: deptName, href: `/departments/${deptId}` },
        { label: profile?.name || 'Profile', href: null },
      ];
    }
    return [
      { label: 'Users', href: '/users' },
      { label: profile?.name || 'Profile', href: null },
    ];
  }, [fromContext, deptId, deptName, profile]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="text-[var(--text-secondary)]">Loading profile...</div>
      </div>
    );
  }

  const roleName = profile?.role?.name ?? '';
  const isProfileActive = profile?.isActive !== false;

  // HR ADMIN is a COMPOSED authority, not a seventh role: an administrator who
  // also carries HR functional authority. Presented as one identity because
  // that is how the company thinks of the person -- while Account & Access
  // still shows both underlying facts, so nothing is hidden.
  const isHrAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(roleName) && !!(profile as any)?.isHR;
  const authorityLabel = isHrAdmin ? 'HR ADMIN' : (profile as any)?.isHR ? 'HR' : roleName;
  const rolePresentation = ROLE_PRESENTATION[roleName];
  const authorityBadgeLabel = isHrAdmin || (profile as any)?.isHR
    ? authorityLabel
    : rolePresentation?.label ?? roleName.replace(/_/g, ' ');
  const authorityBadgeColor = isHrAdmin || (profile as any)?.isHR
    ? HR_BADGE
    : rolePresentation?.badge ?? FALLBACK_ROLE_BADGE;
  const initials = profile?.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || '?';

  return (
    <ProfileFormContext.Provider value={{ editMode, formData, setFormData, profile }}>
      <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <div className="max-w-6xl mx-auto px-4 py-6">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-sm text-[var(--text-secondary)] mb-6 flex-wrap">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="w-3 h-3" />}
              {crumb.href ? (
                <Link href={crumb.href} className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors">
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-[var(--text-primary)] font-medium">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>

        {/* Header */}
        <div className="apex-profile-hero relative overflow-hidden border rounded-2xl p-6 mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-5">
              <div className="relative flex-shrink-0">
                <div className="flex h-[90px] w-[90px] items-center justify-center rounded-full border border-white/70 bg-white/90 p-1 shadow-[0_10px_28px_rgba(3,30,80,0.28)] dark:border-white/50 dark:bg-slate-900/75">
                  {profile?.photoUrl ? (
                    <img
                      src={profile.photoUrl}
                      alt={`${profile?.name} profile photo`}
                      className="h-20 w-20 rounded-full object-cover"
                    />
                  ) : (
                    <span
                      className="apex-user-initials text-2xl font-bold tracking-wide"
                      aria-label={`${profile?.name} initials`}
                    >
                      {initials}
                    </span>
                  )}
                </div>
                <span
                  className="absolute bottom-2 right-0 h-5 w-5 rounded-full border-[3px] border-white shadow-sm"
                  style={{ backgroundColor: isProfileActive ? 'var(--color-success)' : 'var(--color-danger)' }}
                  title={isProfileActive ? 'Active' : 'Inactive'}
                  aria-label={isProfileActive ? 'Active user' : 'Inactive user'}
                />
              </div>
              <div>
                <h1 className="text-3xl font-black text-white drop-shadow-sm">{profile?.name}</h1>
                {profile?.employeeId && (
                  <p className="text-blue-100 text-sm font-semibold tracking-wide mt-1">EMP ID: {profile.employeeId}</p>
                )}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {authorityLabel && (
                    <span
                      title={isHrAdmin ? `Base role ${roleName} with HR authority` : undefined}
                      className={`apex-user-role-badge inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-inset ${authorityBadgeColor}`}
                    >
                      <UsersRound size={16} aria-hidden="true" />
                      {authorityBadgeLabel}
                    </span>
                  )}
                  {profile?.department?.name && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-white/90 px-3 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-inset ring-white/70 shadow-sm backdrop-blur-sm dark:bg-white/15 dark:text-white dark:ring-white/30">
                      <Building2 size={16} aria-hidden="true" />
                      {profile.department.name}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {canEditAccess && !isOwnProfile && (
              <div className="flex items-center gap-2">
                <button
                  // Through the ACCOUNT route, not the profile one. The profile
                  // save is whitelisted to profile columns and drops isActive
                  // silently, so this toggle reported success and did nothing.
                  // Activating here also records the lifecycle transition, so a
                  // previously archived account genuinely comes back.
                  onClick={() => accessMutation.mutate({ isActive: !(profile?.isActive !== false) })}
                  className={`rounded-xl border px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
                    isProfileActive
                      ? 'border-red-400/80 bg-red-600 hover:bg-red-700'
                      : 'border-emerald-400/80 bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {profile?.isActive === false ? 'Activate' : 'Deactivate'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Tab Bar */}
        <div className="border-b border-[var(--border-primary)] mb-6">
          <div className="flex gap-1 overflow-x-auto">
            {TABS.filter((t) => {
              if (t.id === 'payroll') return canSeePayroll;
              if (t.id === 'access') return canSeeAccess || isOwnProfile;
              if (t.id === 'approvals') return ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);
              return true;
            }).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-700 dark:text-white'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="apex-section-border bg-[var(--surface-card)] border rounded-2xl p-6 shadow-sm">

          {/* Tab 1: Personal Details */}
          {activeTab === 'personal' && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className={sectionHeadingCls}>Personal Details</h2>
                {(canEditAll || isOwnProfile) && (
                  <div className="flex items-center gap-2">
                    {editMode ? (
                      <>
                        <button onClick={handleSave} disabled={updateMutation.isPending}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl disabled:opacity-50">
                          {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
                        </button>
                        <button onClick={() => setEditMode(false)}
                          className={`px-4 py-2 text-sm rounded-xl ${neutralButtonCls}`}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button onClick={handleEditToggle}
                        className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl ${neutralButtonCls}`}>
                        <Edit2 size={14} /> Edit
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className={sectionCls}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <Field label="Full Name *" field="name" />
                  <Field label="Email *" field="email" readOnly />
                  <Field label="Phone" field="phone" type="tel" />
                  <Field label="Date of Birth" field="dateOfBirth" type="date" />
                  <SelectField label="Gender" field="gender" options={['Male','Female','Non-binary','Prefer not to say']} />
                  <SelectField label="Blood Group" field="bloodGroup" options={['A+','A-','B+','B-','O+','O-','AB+','AB-']} />
                  <div className="md:col-span-2">
                    <label className={labelCls}>Current Address</label>
                    {editMode && (canEditAll || isOwnProfile) ? (
                      <textarea value={formData.currentAddress ?? ''} onChange={(e) => setFormData((f: any) => ({ ...f, currentAddress: e.target.value }))}
                        className={`${inputCls} min-h-[80px] resize-none`} />
                    ) : (
                      <div className={`${readCls} min-h-[60px]`}>{profile?.currentAddress || <span className="text-[var(--text-tertiary)]">Not set</span>}</div>
                    )}
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelCls}>Permanent Address</label>
                    {editMode && (canEditAll || isOwnProfile) ? (
                      <textarea value={formData.permanentAddress ?? ''} onChange={(e) => setFormData((f: any) => ({ ...f, permanentAddress: e.target.value }))}
                        className={`${inputCls} min-h-[80px] resize-none`} />
                    ) : (
                      <div className={`${readCls} min-h-[60px]`}>{profile?.permanentAddress || <span className="text-[var(--text-tertiary)]">Not set</span>}</div>
                    )}
                  </div>
                  <Field label="Emergency Contact Name" field="emergencyName" />
                  <Field label="Emergency Contact Number" field="emergencyPhone" type="tel" />
                  <Field label="Relationship" field="emergencyRelation" />
                  <Field label="Location" field="userLocation" />
                </div>
              </div>

              {/* Admin Correction — ADMIN/SUPER_ADMIN only (canSeeAccess, not canEditAll,
                  since HR must not get this). Separate from the form above: the Email
                  field there is read-only — this is the deliberate, audited path for
                  fixing a login email. Internal user ID never changes. */}
              {canSeeAccess && (
                <div className={`${sectionCls} mt-5`} style={{ borderColor: 'rgba(217,119,6,0.4)' }}>
                  <p className="text-amber-700 dark:text-amber-400 text-sm font-black mb-1">ADMIN CORRECTION</p>
                  <p className="text-xs text-[var(--text-secondary)] mb-4">
                    Correct login email/user id. Internal user ID will not change.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label className={labelCls}>Current login email</label>
                      <div className={readCls}>{profile?.email}</div>
                    </div>
                    <div>
                      <label className={labelCls}>New login email</label>
                      <input
                        type="email"
                        value={correctionEmail}
                        onChange={(e) => setCorrectionEmail(e.target.value)}
                        placeholder="new.email@company.com"
                        className={inputCls}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className={labelCls}>Reason for correction *</label>
                      <textarea
                        value={correctionReason}
                        onChange={(e) => setCorrectionReason(e.target.value)}
                        placeholder="e.g. Typo in original email — should be mahendra@technoedgels.com"
                        className={`${inputCls} min-h-[70px] resize-none`}
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={handleSaveCorrection}
                      disabled={adminCorrectionMutation.isPending || !correctionEmail.trim() || !correctionReason.trim()}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-xl disabled:opacity-50"
                    >
                      {adminCorrectionMutation.isPending ? 'Saving…' : 'Save Correction'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Employment Details */}
          {activeTab === 'employment' && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className={sectionHeadingCls}>Employment Details</h2>
                {canEditAll && (
                  <div className="flex gap-2">
                    {editMode ? (
                      <>
                        <button onClick={handleSave} disabled={updateMutation.isPending} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-xl disabled:opacity-50">
                          {updateMutation.isPending ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditMode(false)} className={`px-4 py-2 text-sm rounded-xl ${neutralButtonCls}`}>Cancel</button>
                      </>
                    ) : (
                      <button onClick={handleEditToggle} className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl ${neutralButtonCls}`}>
                        <Edit2 size={14} /> Edit
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className={sectionCls}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <Field label="Employee ID *" field="employeeId" readOnly={!canEditAll} />
                  <div><label className={labelCls}>Company</label><div className={readCls}>TechnoEdge Learning Solutions</div></div>
                  <div><label className={labelCls}>Department *</label><div className={readCls}>{profile?.department?.name || 'Not set'}</div></div>
                  <Field label="Designation *" field="designation" readOnly={!canEditAll} />
                  <SelectField label="Employment Type *" field="employmentType" options={['Full-time','Part-time','Contract','Intern','Consultant']} readOnly={!canEditAll} />
                  <SelectField label="Work Mode *" field="workMode" options={['Office','Remote','Hybrid']} readOnly={!canEditAll} />
                  <Field label="Joining Date *" field="joiningDate" type="date" readOnly={!canEditAll} />
                  <Field label="Probation Period" field="probationPeriod" readOnly={!canEditAll} />
                  <Field label="Reporting Manager *" field="reportingManager" readOnly={!canEditAll} />
                  <Field label="Team Lead" field="teamLeadName" readOnly={!canEditAll} />
                  <Field label="Work Location" field="workLocation" readOnly={!canEditAll} />
                  <Field label="Shift Timing" field="shiftTiming" readOnly={!canEditAll} />
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Account & Access */}
          {activeTab === 'access' && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className={sectionHeadingCls}>Account &amp; Access</h2>
                {/* Authority editing is administrators only -- narrower than
                    the rest of the profile, which HR may also edit. The server
                    enforces it independently. */}
                {canEditAccess && !isOwnProfile && (
                  accessEdit ? (
                    <div className="flex gap-2">
                      <button
                        onClick={saveAccess}
                        disabled={accessMutation.isPending}
                        className="px-4 py-2 bg-blue-600 text-white text-sm rounded-xl disabled:opacity-50"
                      >
                        {accessMutation.isPending ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={() => setAccessEdit(false)}
                        className={`px-4 py-2 text-sm rounded-xl ${neutralButtonCls}`}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={startAccessEdit}
                      className={`flex items-center gap-2 px-4 py-2 text-sm rounded-xl ${neutralButtonCls}`}
                    >
                      <Edit2 size={14} /> Edit
                    </button>
                  )
                )}
              </div>
              {!canSeeAccess && !isOwnProfile ? (
                <div className="text-[var(--text-secondary)] text-center py-8">You don&apos;t have permission to view this section.</div>
              ) : (
                <div className={sectionCls}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div><label className={labelCls}>Login Email *</label><div className={readCls}>{profile?.email}</div></div>
                    <div>
                      <label className={labelCls}>Password</label>
                      {canEditAll ? (
                        <button className="w-full px-4 py-3 rounded-xl border border-[var(--border-secondary)] bg-[var(--surface-card)] text-blue-600 dark:text-blue-400 text-sm text-left hover:bg-[var(--bg-tertiary)]">
                          Reset Password →
                        </button>
                      ) : (
                        <div className={readCls}>••••••••</div>
                      )}
                    </div>

                    {/*
                      Base role and HR authority are two separate facts. There
                      is no HR role in the canonical ladder; the flag is what
                      grants the HR permission set, and ADMIN + HR is the
                      HR ADMIN.
                    */}
                    <div><label className={labelCls}>Base Role *</label>
                      {accessEdit ? (
                        <select
                          value={accessForm.roleId ?? ''}
                          onChange={(e) => setAccessForm((f: any) => ({ ...f, roleId: e.target.value }))}
                          className={selectCls}
                        >
                          {(Array.isArray(roleOptions) ? roleOptions : []).map((r: any) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      ) : (
                        <div className={readCls}>
                          <span className={`apex-user-role-badge inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-inset ${rolePresentation?.badge ?? FALLBACK_ROLE_BADGE}`}>
                            <UsersRound size={16} aria-hidden="true" />
                            {rolePresentation?.label ?? roleName.replace(/_/g, ' ')}
                          </span>
                        </div>
                      )}
                    </div>

                    <div><label className={labelCls}>HR Authority</label>
                      {accessEdit ? (
                        <label
                          className="flex items-start gap-2.5 w-full px-4 py-3 rounded-xl border border-[var(--border-secondary)] bg-[var(--surface-card)]"
                          style={{ cursor: accessIsSuperAdmin ? 'not-allowed' : 'pointer', opacity: accessIsSuperAdmin ? 0.55 : 1 }}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={!!accessForm.isHR && !accessIsSuperAdmin}
                            disabled={accessIsSuperAdmin}
                            onChange={(e) => setAccessForm((f: any) => ({ ...f, isHR: e.target.checked }))}
                          />
                          <span className="text-sm text-[var(--text-primary)]">
                            {accessIsSuperAdmin
                              ? 'Not available for Super Admin'
                              : 'Company-wide attendance, corrections, payroll and month close'}
                          </span>
                        </label>
                      ) : (
                        <div className={readCls}>
                          {(profile as any)?.isHR ? (
                            <span className="text-xs font-bold px-2 py-1 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">Enabled</span>
                          ) : (
                            <span className="text-[var(--text-secondary)]">Not enabled</span>
                          )}
                        </div>
                      )}
                    </div>

                    <div><label className={labelCls}>Account Status *</label>
                      {accessEdit ? (
                        <select
                          value={accessForm.isActive ? 'active' : 'inactive'}
                          onChange={(e) => setAccessForm((f: any) => ({ ...f, isActive: e.target.value === 'active' }))}
                          className={selectCls}
                        >
                          <option value="active">Active</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      ) : (
                        <div className={readCls}>
                          {profile?.isActive === false
                            ? <span className="text-red-700 dark:text-red-400 font-medium">Inactive</span>
                            : <span className="text-green-700 dark:text-green-400 font-medium">Active</span>}
                        </div>
                      )}
                    </div>

                    <div><label className={labelCls}>Department</label>
                      {accessEdit ? (
                        <select
                          value={accessForm.departmentId ?? ''}
                          onChange={(e) => setAccessForm((f: any) => ({ ...f, departmentId: e.target.value }))}
                          className={selectCls}
                        >
                          <option value="">None</option>
                          {(Array.isArray(departmentOptions) ? departmentOptions : []).map((d: any) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      ) : (
                        <div className={readCls}>{profile?.department?.name || 'Not assigned'}</div>
                      )}
                    </div>

                    <div><label className={labelCls}>Last Active</label><div className={readCls}>{profile?.lastActiveAt ? new Date(profile.lastActiveAt).toLocaleString() : 'Never'}</div></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 4: Payroll & Statutory */}
          {activeTab === 'payroll' && canSeePayroll && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className={sectionHeadingCls}>Payroll & Statutory</h2>
                <div className="flex items-center gap-2">
                  {isOwnProfile && (
                    <div className="flex items-center gap-2 text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 dark:text-yellow-400 dark:bg-yellow-900/20 dark:border-yellow-800 rounded-lg px-3 py-1.5">
                      Sensitive data is partially hidden for security
                    </div>
                  )}
                  {canEditAll && (
                    editMode ? (
                      <div className="flex gap-2">
                        <button onClick={handleSave} disabled={updateMutation.isPending} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-xl disabled:opacity-50">Save</button>
                        <button onClick={() => setEditMode(false)} className={`px-4 py-2 text-sm rounded-xl ${neutralButtonCls}`}>Cancel</button>
                      </div>
                    ) : (
                      <button onClick={handleEditToggle} className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl ${neutralButtonCls}`}>
                        <Edit2 size={14} /> Edit
                      </button>
                    )
                  )}
                </div>
              </div>

              <div className="space-y-5">
                {/* Salary */}
                <div className={sectionCls}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <Field label="CTC Annual *" field="ctcAnnual" readOnly={isOwnProfile} />
                    <Field label="Basic Salary Annual *" field="basicSalary" readOnly={isOwnProfile} />
                    <Field label="Salary Structure *" field="salaryStructure" readOnly={isOwnProfile} />
                  </div>
                </div>

                {/* Bank */}
                <div className={sectionCls}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <Field label="Bank Name *" field="bankName" readOnly={isOwnProfile} />
                    <div>
                      <label className={labelCls}>Account Number *</label>
                      <div className={readCls}>{profile?.accountNumber || <span className="text-[var(--text-tertiary)]">Not set</span>}</div>
                    </div>
                    <Field label="IFSC Code *" field="ifscCode" readOnly={isOwnProfile} />
                    <Field label="Account Holder Name *" field="accountHolderName" readOnly={isOwnProfile} />
                    <SelectField label="Payment Mode *" field="paymentMode" options={['NEFT','IMPS','RTGS','Cheque']} readOnly={isOwnProfile} />
                  </div>
                </div>

                {/* Statutory */}
                <div className={sectionCls}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label className={labelCls}>PAN Number *</label>
                      <div className={readCls}>{profile?.panNumber || <span className="text-[var(--text-tertiary)]">Not set</span>}</div>
                    </div>
                    <div>
                      <label className={labelCls}>Aadhaar Number *</label>
                      <div className={readCls}>{profile?.aadhaarNumber || <span className="text-[var(--text-tertiary)]">Not set</span>}</div>
                    </div>
                    <Field label="UAN Number" field="uanNumber" readOnly={isOwnProfile} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
                    {[
                      { field: 'pfApplicable', label: 'PF Applicable' },
                      { field: 'esicApplicable', label: 'ESIC Applicable' },
                      { field: 'professionalTax', label: 'Professional Tax' },
                    ].map(({ field, label }) => (
                      <label key={field} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editMode ? (formData[field] ?? false) : (profile?.[field] ?? false)}
                          onChange={editMode ? (e) => setFormData((f: any) => ({ ...f, [field]: e.target.checked })) : undefined}
                          disabled={!editMode || isOwnProfile}
                          className="w-4 h-4 accent-blue-500"
                        />
                        <span className="apex-profile-label text-sm">{label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-4">
                    <SelectField label="Tax Regime" field="taxRegime" options={['Old Regime','New Regime']} readOnly={isOwnProfile} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 5: Documents & Verification */}
          {activeTab === 'documents' && (
            <div>
              <h2 className={`${sectionHeadingCls} mb-6`}>Documents & Verification</h2>

              {/* Document slots grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {DOCUMENT_TYPES.map((docType) => {
                  const uploaded = Array.isArray(documents) ? documents.find((d: any) => d.documentType === docType.type) : null;
                  const vsColor = uploaded?.verificationStatus === 'VERIFIED' ? 'text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800' :
                    uploaded?.verificationStatus === 'REJECTED' ? 'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800' :
                    'text-yellow-700 bg-yellow-50 border-yellow-200 dark:text-yellow-400 dark:bg-yellow-900/20 dark:border-yellow-800';

                  return (
                    <div key={docType.type} className={`border-2 rounded-xl p-3 flex flex-col items-center gap-2 transition-colors ${
                      uploaded ? 'border-[var(--border-secondary)] bg-[var(--surface-sunken)]' : 'border-dashed border-[var(--border-secondary)] bg-[var(--surface-sunken)] hover:border-[var(--text-tertiary)]'
                    }`}>
                      <div className="text-2xl">{
                        docType.type === 'PROFILE_PHOTO' ? '📷' :
                        docType.type === 'AADHAAR' ? '🪪' :
                        docType.type === 'PAN' ? '💳' :
                        docType.type === 'ADDRESS_PROOF' ? '🏠' :
                        docType.type === 'BANK_PROOF' ? '🏦' :
                        docType.type === 'OFFER_LETTER' ? '📄' :
                        docType.type === 'EDUCATION_CERT' ? '🎓' : '📎'
                      }</div>
                      <p className="apex-profile-label text-xs font-medium text-center">{docType.label}</p>
                      {uploaded ? (
                        <>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${vsColor}`}>
                            {uploaded.verificationStatus === 'VERIFIED' ? '✓ Verified' :
                             uploaded.verificationStatus === 'REJECTED' ? '✗ Rejected' : 'Pending Review'}
                          </span>
                          <div className="flex gap-1 flex-wrap justify-center">
                            <a href={uploaded.fileUrl} target="_blank" rel="noreferrer"
                              className="text-[10px] text-blue-400 hover:underline">View</a>
                            {canEditAll && uploaded.verificationStatus !== 'VERIFIED' && (
                              <button onClick={() => handleVerifyDoc(uploaded.id, 'VERIFIED')}
                                className="text-[10px] text-green-400 hover:underline">Verify</button>
                            )}
                            {canEditAll && uploaded.verificationStatus !== 'REJECTED' && (
                              <button onClick={() => handleVerifyDoc(uploaded.id, 'REJECTED', 'Document unclear')}
                                className="text-[10px] text-red-400 hover:underline">Reject</button>
                            )}
                            {canEditAll && (
                              <button onClick={() => handleDeleteDoc(uploaded.id)}
                                className="text-[10px] text-[var(--text-secondary)] hover:text-red-600 dark:hover:text-red-400 hover:underline ml-1">Delete</button>
                            )}
                          </div>
                        </>
                      ) : (
                        <label className="cursor-pointer text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                          <Upload size={11} />
                          {uploading === docType.type ? 'Uploading…' : 'Upload'}
                          <input
                            type="file"
                            className="hidden"
                            accept="image/*,.pdf"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleDocumentUpload(docType.type, file);
                            }}
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* HR Notes — visible to HR/ADMIN/SUPER_ADMIN only */}
              {canEditAll && (
                <div className={sectionCls}>
                  <p className="apex-profile-heading text-sm font-bold mb-3">HR Notes (Internal)</p>
                  <textarea
                    value={formData.hrNotes ?? profile?.hrNotes ?? ''}
                    onChange={(e) => setFormData((f: any) => ({ ...f, hrNotes: e.target.value }))}
                    placeholder="Internal notes about this employee..."
                    className={`${inputCls} min-h-[100px] resize-none`}
                  />
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => updateMutation.mutate({ hrNotes: formData.hrNotes })}
                      disabled={updateMutation.isPending}
                      className="px-4 py-2 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-50"
                    >
                      Save Notes
                    </button>
                  </div>
                </div>
              )}

              {/* Verification Section */}
              {canEditAll && (
                <div className={`${sectionCls} mt-4`}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <SelectField label="Verification Status" field="verificationStatus"
                      options={['Pending','In Progress','Verified','Rejected']} />
                    <Field label="Verified By" field="verifiedBy" />
                    <Field label="Verification Date" field="verificationDate" type="date" />
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={() => updateMutation.mutate({
                        verificationStatus: formData.verificationStatus ?? profile?.verificationStatus,
                        verifiedBy: formData.verifiedBy ?? profile?.verifiedBy,
                        verificationDate: formData.verificationDate ?? profile?.verificationDate,
                      })}
                      disabled={updateMutation.isPending}
                      className="px-4 py-2 bg-blue-600 text-white text-sm rounded-xl hover:bg-blue-700 disabled:opacity-50"
                    >
                      Save Verification
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 6: Approval Workload */}
          {activeTab === 'approvals' && (
            <div>
              <h2 className={`${sectionHeadingCls} mb-6`}>Approval Workload</h2>
              {reviewerMetricsLoading ? (
                <div className="text-[var(--text-secondary)]">Loading metrics...</div>
              ) : !reviewerMetrics ? (
                <div className="text-[var(--text-secondary)]">No approval metrics available.</div>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className={metricCardCls}>
                      <div className={metricLabelCls}>
                        <Eye size={16} />
                        <span className="text-sm font-medium">Pending Approvals</span>
                      </div>
                      <span className={metricValueCls}>
                        {reviewerMetrics.pendingApprovalsCount ?? 0}
                      </span>
                    </div>
                    <div className={metricCardCls}>
                      <div className={metricLabelCls}>
                        <CheckCircle size={16} className="text-green-500" />
                        <span className="text-sm font-medium">Completed Approvals</span>
                      </div>
                      <span className={metricValueCls}>
                        {reviewerMetrics.completedApprovalsCount ?? 0}
                      </span>
                    </div>
                    <div className={metricCardCls}>
                      <div className={metricLabelCls}>
                        <Clock size={16} className="text-blue-500" />
                        <span className="text-sm font-medium">Avg. Reviewer Active Time</span>
                      </div>
                      <span className={metricValueCls}>
                        {fmtSeconds(reviewerMetrics.averageApprovalSeconds)}
                      </span>
                    </div>
                    <div className={metricCardCls}>
                      <div className={metricLabelCls}>
                        <CheckCircle size={16} className="text-green-500" />
                        <span className="text-sm font-medium">Approvals Today</span>
                      </div>
                      <span className={metricValueCls}>
                        {reviewerMetrics.approvalsToday ?? 0}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className={metricCardCls}>
                      <div className={metricLabelCls}>
                        <CheckCircle size={16} className="text-green-500" />
                        <span className="text-sm font-medium">Approvals This Week</span>
                      </div>
                      <span className={metricValueCls}>
                        {reviewerMetrics.approvalsThisWeek ?? 0}
                      </span>
                    </div>
                    <div className={metricCardCls}>
                      <div className={metricLabelCls}>
                        <CheckCircle size={16} className={reviewerMetrics.approvalPercent >= 60 ? 'text-green-500' : 'text-yellow-500'} />
                        <span className="text-sm font-medium">Approval Rate</span>
                      </div>
                      <span className={metricValueCls}>
                        {fmtPct(reviewerMetrics.approvalPercent)}
                      </span>
                    </div>
                    <div className={metricCardCls}>
                      <div className={metricLabelCls}>
                        <RotateCcw size={16} className={reviewerMetrics.rejectionPercent > 40 ? 'text-yellow-500' : 'text-[var(--text-secondary)]'} />
                        <span className="text-sm font-medium">Rework Rate</span>
                      </div>
                      <span className={metricValueCls}>
                        {fmtPct(reviewerMetrics.rejectionPercent)}
                      </span>
                    </div>
                    <div className={metricCardCls}>
                      <div className={metricLabelCls}>
                        <AlertTriangle size={16} className={reviewerMetrics.approvalSlaBreaches > 0 ? 'text-red-500' : 'text-green-500'} />
                        <span className="text-sm font-medium">SLA Breaches</span>
                      </div>
                      <span className={metricValueCls}>
                        {reviewerMetrics.approvalSlaBreaches ?? 0}
                        <span className="text-sm font-normal text-[var(--text-tertiary)] ml-2">({fmtPct(reviewerMetrics.approvalSlaBreachRate)})</span>
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    </ProfileFormContext.Provider>
  );
}
