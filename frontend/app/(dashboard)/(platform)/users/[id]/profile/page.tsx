'use client';

import { useState, useMemo, createContext, useContext } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth.store';
import { usersApi, analyticsApi } from '@/lib/api';
import toast from 'react-hot-toast';
import Link from 'next/link';
import { ChevronRight, Edit2, Upload, Eye, Clock, CheckCircle, AlertTriangle, RotateCcw } from 'lucide-react';

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

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-900 text-purple-300',
  ADMIN: 'bg-red-900 text-red-300',
  MANAGER: 'bg-blue-900 text-blue-300',
  TEAM_LEAD: 'bg-cyan-900 text-cyan-300',
  EMPLOYEE: 'bg-green-900 text-green-300',
  INTERN: 'bg-yellow-900 text-yellow-300',
};

const inputCls = 'w-full px-4 py-3 rounded-xl border border-slate-700 bg-slate-800 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm';
const labelCls = 'block text-sm font-bold text-slate-300 mb-2';
const readCls = 'w-full px-4 py-3 rounded-xl border border-slate-700 bg-slate-800/50 text-slate-200 text-sm';
const sectionCls = 'bg-slate-800/50 rounded-xl p-6 border border-slate-700/50';

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
        <div className={readCls}>{profile?.[field] || <span className="text-slate-500">Not set</span>}</div>
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
        <div className={readCls}>{profile?.[field] || <span className="text-slate-500">Not set</span>}</div>
      )}
    </div>
  );
};

export default function EmployeeProfilePage() {
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
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400">Loading profile...</div>
      </div>
    );
  }

  const roleName = profile?.role?.name ?? '';
  const initials = profile?.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || '?';

  return (
    <ProfileFormContext.Provider value={{ editMode, formData, setFormData, profile }}>
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="max-w-6xl mx-auto px-4 py-6">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-sm text-slate-400 mb-6 flex-wrap">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="w-3 h-3" />}
              {crumb.href ? (
                <Link href={crumb.href} className="text-blue-400 hover:text-blue-300 transition-colors">
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-slate-200 font-medium">{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>

        {/* Header */}
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-5">
              {profile?.photoUrl ? (
                <img src={profile.photoUrl} alt={profile?.name} className="w-20 h-20 rounded-full object-cover" />
              ) : (
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-black text-white flex-shrink-0"
                  style={{ backgroundColor: profile?.avatar || '#6366f1' }}
                >
                  {initials}
                </div>
              )}
              <div>
                <h1 className="text-3xl font-black text-white">{profile?.name}</h1>
                <p className="text-slate-400 mt-0.5">{profile?.email}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {roleName && (
                    <span className={`text-xs font-bold px-2 py-1 rounded-full ${ROLE_COLORS[roleName] ?? 'bg-slate-700 text-slate-300'}`}>
                      {roleName}
                    </span>
                  )}
                  {profile?.department?.name && (
                    <span className="text-xs font-medium px-2 py-1 rounded-full bg-slate-700 text-slate-300">
                      {profile.department.name}
                    </span>
                  )}
                  {profile?.isActive === false ? (
                    <span className="text-xs font-medium px-2 py-1 rounded-full bg-red-900 text-red-300">Inactive</span>
                  ) : (
                    <span className="text-xs font-medium px-2 py-1 rounded-full bg-green-900 text-green-300">Active</span>
                  )}
                </div>
                {profile?.employeeId && (
                  <p className="text-slate-500 text-sm mt-1">EMP ID: {profile.employeeId}</p>
                )}
              </div>
            </div>

            {canEditAll && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateMutation.mutate({ isActive: !(profile?.isActive !== false) })}
                  className="px-4 py-2 text-sm border border-slate-700 bg-slate-900 text-slate-200 rounded-xl hover:bg-slate-800 transition-colors"
                >
                  {profile?.isActive === false ? 'Activate' : 'Deactivate'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Tab Bar */}
        <div className="border-b border-slate-700 mb-6">
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
                    ? 'border-blue-500 text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-500'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6">

          {/* Tab 1: Personal Details */}
          {activeTab === 'personal' && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-black text-white">Personal Details</h2>
                {(canEditAll || isOwnProfile) && (
                  <div className="flex items-center gap-2">
                    {editMode ? (
                      <>
                        <button onClick={handleSave} disabled={updateMutation.isPending}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl disabled:opacity-50">
                          {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
                        </button>
                        <button onClick={() => setEditMode(false)}
                          className="px-4 py-2 border border-slate-700 bg-slate-900 text-slate-200 text-sm rounded-xl hover:bg-slate-800">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button onClick={handleEditToggle}
                        className="flex items-center gap-1.5 px-4 py-2 border border-slate-700 bg-slate-900 text-slate-200 text-sm rounded-xl hover:bg-slate-800">
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
                      <div className={`${readCls} min-h-[60px]`}>{profile?.currentAddress || <span className="text-slate-500">Not set</span>}</div>
                    )}
                  </div>
                  <div className="md:col-span-2">
                    <label className={labelCls}>Permanent Address</label>
                    {editMode && (canEditAll || isOwnProfile) ? (
                      <textarea value={formData.permanentAddress ?? ''} onChange={(e) => setFormData((f: any) => ({ ...f, permanentAddress: e.target.value }))}
                        className={`${inputCls} min-h-[80px] resize-none`} />
                    ) : (
                      <div className={`${readCls} min-h-[60px]`}>{profile?.permanentAddress || <span className="text-slate-500">Not set</span>}</div>
                    )}
                  </div>
                  <Field label="Emergency Contact Name" field="emergencyName" />
                  <Field label="Emergency Contact Number" field="emergencyPhone" type="tel" />
                  <Field label="Relationship" field="emergencyRelation" />
                  <Field label="Location" field="userLocation" />
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Employment Details */}
          {activeTab === 'employment' && (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-black text-white">Employment Details</h2>
                {canEditAll && (
                  <div className="flex gap-2">
                    {editMode ? (
                      <>
                        <button onClick={handleSave} disabled={updateMutation.isPending} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-xl disabled:opacity-50">
                          {updateMutation.isPending ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditMode(false)} className="px-4 py-2 border border-slate-700 text-slate-200 text-sm rounded-xl">Cancel</button>
                      </>
                    ) : (
                      <button onClick={handleEditToggle} className="flex items-center gap-1.5 px-4 py-2 border border-slate-700 text-slate-200 text-sm rounded-xl hover:bg-slate-800">
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
              <h2 className="text-xl font-black text-white mb-6">Account & Access</h2>
              {!canSeeAccess && !isOwnProfile ? (
                <div className="text-slate-400 text-center py-8">You don&apos;t have permission to view this section.</div>
              ) : (
                <div className={sectionCls}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div><label className={labelCls}>Login Email *</label><div className={readCls}>{profile?.email}</div></div>
                    <div>
                      <label className={labelCls}>Password</label>
                      {canEditAll ? (
                        <button className="w-full px-4 py-3 rounded-xl border border-slate-600 bg-slate-800 text-blue-400 text-sm text-left hover:bg-slate-700">
                          Reset Password →
                        </button>
                      ) : (
                        <div className={readCls}>••••••••</div>
                      )}
                    </div>
                    <div><label className={labelCls}>Role *</label>
                      <div className={readCls}>
                        <span className={`text-xs font-bold px-2 py-1 rounded-full ${ROLE_COLORS[roleName] ?? 'bg-slate-700 text-slate-300'}`}>{roleName}</span>
                      </div>
                    </div>
                    <div><label className={labelCls}>Account Status *</label>
                      <div className={readCls}>
                        {profile?.isActive === false
                          ? <span className="text-red-400 font-medium">Inactive</span>
                          : <span className="text-green-400 font-medium">Active</span>}
                      </div>
                    </div>
                    <div><label className={labelCls}>Department</label><div className={readCls}>{profile?.department?.name || 'Not assigned'}</div></div>
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
                <h2 className="text-xl font-black text-white">Payroll & Statutory</h2>
                <div className="flex items-center gap-2">
                  {isOwnProfile && (
                    <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-800 rounded-lg px-3 py-1.5">
                      Sensitive data is partially hidden for security
                    </div>
                  )}
                  {canEditAll && (
                    editMode ? (
                      <div className="flex gap-2">
                        <button onClick={handleSave} disabled={updateMutation.isPending} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-xl disabled:opacity-50">Save</button>
                        <button onClick={() => setEditMode(false)} className="px-4 py-2 border border-slate-700 text-slate-200 text-sm rounded-xl">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={handleEditToggle} className="flex items-center gap-1.5 px-4 py-2 border border-slate-700 text-slate-200 text-sm rounded-xl hover:bg-slate-800">
                        <Edit2 size={14} /> Edit
                      </button>
                    )
                  )}
                </div>
              </div>

              <div className="space-y-5">
                {/* Salary */}
                <div className={sectionCls}>
                  <p className="text-blue-400 text-sm font-black mb-4">SALARY INFORMATION</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <Field label="CTC Annual *" field="ctcAnnual" readOnly={isOwnProfile} />
                    <Field label="Basic Salary Annual *" field="basicSalary" readOnly={isOwnProfile} />
                    <Field label="Salary Structure *" field="salaryStructure" readOnly={isOwnProfile} />
                  </div>
                </div>

                {/* Bank */}
                <div className={sectionCls}>
                  <p className="text-blue-400 text-sm font-black mb-4">BANK DETAILS</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <Field label="Bank Name *" field="bankName" readOnly={isOwnProfile} />
                    <div>
                      <label className={labelCls}>Account Number *</label>
                      <div className={readCls}>{profile?.accountNumber || <span className="text-slate-500">Not set</span>}</div>
                    </div>
                    <Field label="IFSC Code *" field="ifscCode" readOnly={isOwnProfile} />
                    <Field label="Account Holder Name *" field="accountHolderName" readOnly={isOwnProfile} />
                    <SelectField label="Payment Mode *" field="paymentMode" options={['NEFT','IMPS','RTGS','Cheque']} readOnly={isOwnProfile} />
                  </div>
                </div>

                {/* Statutory */}
                <div className={sectionCls}>
                  <p className="text-blue-400 text-sm font-black mb-4">STATUTORY DETAILS</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                      <label className={labelCls}>PAN Number *</label>
                      <div className={readCls}>{profile?.panNumber || <span className="text-slate-500">Not set</span>}</div>
                    </div>
                    <div>
                      <label className={labelCls}>Aadhaar Number *</label>
                      <div className={readCls}>{profile?.aadhaarNumber || <span className="text-slate-500">Not set</span>}</div>
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
                        <span className="text-sm text-slate-300">{label}</span>
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
              <h2 className="text-xl font-black text-white mb-6">Documents & Verification</h2>

              {/* Document slots grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {DOCUMENT_TYPES.map((docType) => {
                  const uploaded = Array.isArray(documents) ? documents.find((d: any) => d.documentType === docType.type) : null;
                  const vsColor = uploaded?.verificationStatus === 'VERIFIED' ? 'text-green-400 bg-green-900/20 border-green-800' :
                    uploaded?.verificationStatus === 'REJECTED' ? 'text-red-400 bg-red-900/20 border-red-800' :
                    'text-yellow-400 bg-yellow-900/20 border-yellow-800';

                  return (
                    <div key={docType.type} className={`border-2 rounded-xl p-3 flex flex-col items-center gap-2 transition-colors ${
                      uploaded ? 'border-slate-600 bg-slate-800/50' : 'border-dashed border-slate-600 bg-slate-800/20 hover:border-slate-500'
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
                      <p className="text-xs font-medium text-slate-300 text-center">{docType.label}</p>
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
                                className="text-[10px] text-slate-400 hover:text-red-400 hover:underline ml-1">Delete</button>
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
                  <p className="text-blue-400 text-sm font-black mb-3">HR NOTES (Internal)</p>
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
                  <p className="text-blue-400 text-sm font-black mb-4">VERIFICATION DETAILS</p>
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
              <h2 className="text-xl font-black text-white mb-6">Approval Workload</h2>
              {reviewerMetricsLoading ? (
                <div className="text-slate-400">Loading metrics...</div>
              ) : !reviewerMetrics ? (
                <div className="text-slate-400">No approval metrics available.</div>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 flex flex-col">
                      <div className="flex items-center gap-2 text-slate-400 mb-2">
                        <Eye size={16} />
                        <span className="text-sm font-medium">Pending Approvals</span>
                      </div>
                      <span className="text-3xl font-black text-white">
                        {reviewerMetrics.pendingApprovalsCount ?? 0}
                      </span>
                    </div>
                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 flex flex-col">
                      <div className="flex items-center gap-2 text-slate-400 mb-2">
                        <CheckCircle size={16} className="text-green-500" />
                        <span className="text-sm font-medium">Completed Approvals</span>
                      </div>
                      <span className="text-3xl font-black text-white">
                        {reviewerMetrics.completedApprovalsCount ?? 0}
                      </span>
                    </div>
                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 flex flex-col">
                      <div className="flex items-center gap-2 text-slate-400 mb-2">
                        <Clock size={16} className="text-blue-500" />
                        <span className="text-sm font-medium">Avg. Review Time</span>
                      </div>
                      <span className="text-3xl font-black text-white">
                        {fmtSeconds(reviewerMetrics.averageApprovalSeconds)}
                      </span>
                    </div>
                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 flex flex-col">
                      <div className="flex items-center gap-2 text-slate-400 mb-2">
                        <CheckCircle size={16} className="text-green-500" />
                        <span className="text-sm font-medium">Approvals Today</span>
                      </div>
                      <span className="text-3xl font-black text-white">
                        {reviewerMetrics.approvalsToday ?? 0}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 flex flex-col">
                      <div className="flex items-center gap-2 text-slate-400 mb-2">
                        <CheckCircle size={16} className="text-green-500" />
                        <span className="text-sm font-medium">Approvals This Week</span>
                      </div>
                      <span className="text-3xl font-black text-white">
                        {reviewerMetrics.approvalsThisWeek ?? 0}
                      </span>
                    </div>
                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 flex flex-col">
                      <div className="flex items-center gap-2 text-slate-400 mb-2">
                        <CheckCircle size={16} className={reviewerMetrics.approvalPercent >= 60 ? 'text-green-500' : 'text-yellow-500'} />
                        <span className="text-sm font-medium">Approval Rate</span>
                      </div>
                      <span className="text-3xl font-black text-white">
                        {fmtPct(reviewerMetrics.approvalPercent)}
                      </span>
                    </div>
                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 flex flex-col">
                      <div className="flex items-center gap-2 text-slate-400 mb-2">
                        <RotateCcw size={16} className={reviewerMetrics.rejectionPercent > 40 ? 'text-yellow-500' : 'text-slate-400'} />
                        <span className="text-sm font-medium">Rework Rate</span>
                      </div>
                      <span className="text-3xl font-black text-white">
                        {fmtPct(reviewerMetrics.rejectionPercent)}
                      </span>
                    </div>
                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 flex flex-col">
                      <div className="flex items-center gap-2 text-slate-400 mb-2">
                        <AlertTriangle size={16} className={reviewerMetrics.approvalSlaBreaches > 0 ? 'text-red-500' : 'text-green-500'} />
                        <span className="text-sm font-medium">SLA Breaches</span>
                      </div>
                      <span className="text-3xl font-black text-white">
                        {reviewerMetrics.approvalSlaBreaches ?? 0}
                        <span className="text-sm font-normal text-slate-500 ml-2">({fmtPct(reviewerMetrics.approvalSlaBreachRate)})</span>
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
