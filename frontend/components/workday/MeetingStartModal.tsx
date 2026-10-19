'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Search, UsersRound, X } from 'lucide-react';
import { workdayApi } from '@/lib/api';
import { ModalPortal } from '../ui/ModalPortal';

/** Apex's shared royal-blue accent; keep this flow visually inside the application. */
const MEETING_ACCENT = '#2563EB';

type MeetingType = 'ONE_ON_ONE' | 'INTERNAL' | 'EXTERNAL' | 'CUSTOM';
type Person = { id: string; name: string; role: string; departmentId: string | null; departmentName: string | null; inMeeting: boolean };
type Options = {
  me: Person;
  canCreateInternal: boolean;
  departments: { id: string; name: string }[];
  people: Person[];
  approverChain: { id: string; name: string; tier: 'TEAM_LEAD' | 'MANAGER' | 'ADMIN' }[];
  approvalCandidates: { id: string; name: string; role: string; departmentIds: string[]; onLeave: boolean }[];
  myTeamLeadId: string | null;
  myManagerId: string | null;
};

const TYPES: { id: MeetingType; title: string; hint: string }[] = [
  { id: 'ONE_ON_ONE', title: 'One-on-one', hint: 'One person in your department' },
  { id: 'INTERNAL', title: 'Internal', hint: 'People in your department' },
  { id: 'EXTERNAL', title: 'External', hint: 'Other departments or a client' },
  { id: 'CUSTOM', title: 'Custom', hint: 'Any mix of people' },
];
const PURPOSES = [
  { id: 'REVIEW', label: 'Review' },
  { id: 'PLANNING', label: 'Planning' },
  { id: 'TRAINING', label: 'Training / knowledge share' },
  { id: 'CLIENT', label: 'Client' },
  { id: 'STATUS_UPDATE', label: 'Status update' },
  { id: 'OTHER', label: 'Other' },
];
const ROLE_LABEL: Record<string, string> = { SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin', MANAGER: 'Manager', TEAM_LEAD: 'Team Lead', EMPLOYEE: 'Employee', INTERN: 'Intern' };
const RANK: Record<string, number> = { SUPER_ADMIN: 5, ADMIN: 4, MANAGER: 3, TEAM_LEAD: 2, EMPLOYEE: 1, INTERN: 0 };
const FILTER_ROLES = ['MANAGER', 'TEAM_LEAD', 'EMPLOYEE', 'INTERN'];
const isAdminRole = (role: string) => role === 'ADMIN' || role === 'SUPER_ADMIN';

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export function MeetingStartModal({ onClose, onStarted }: { onClose: () => void; onStarted: () => void }) {
  const queryClient = useQueryClient();
  const { data: options, isLoading, isError } = useQuery<Options>({
    queryKey: ['meeting-v2-options'],
    queryFn: () => workdayApi.getMeetingV2Options() as Promise<Options>,
    staleTime: 30_000,
  });

  const [agenda, setAgenda] = useState('');
  const [type, setType] = useState<MeetingType | null>(null);
  const [purpose, setPurpose] = useState('');
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>(FILTER_ROLES);
  const [includeAdmin, setIncludeAdmin] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [clientName, setClientName] = useState('');
  const [guestNames, setGuestNames] = useState('');
  const [approverRoleFilter, setApproverRoleFilter] = useState('ALL');
  const [approverQuery, setApproverQuery] = useState('');
  const [approverIds, setApproverIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const me = options?.me;
  const isEmployee = !options?.canCreateInternal;
  const isDepartmental = type === 'INTERNAL' && isEmployee;
  const peopleById = useMemo(() => new Map((options?.people ?? []).map((p) => [p.id, p])), [options]);

  const chooseType = (next: MeetingType) => {
    setType(next);
    setSelected([]);
    setIncludeAdmin(false);
    setDepartmentIds(next === 'EXTERNAL' && me?.departmentId ? [] : []);
    setClientName('');
    setGuestNames('');
    setApproverRoleFilter('ALL');
    setApproverQuery('');
    setApproverIds([]);
  };

  /** Who the picker may show for this type and role (the server enforces the same rules). */
  const inScope = (p: Person) => {
    if (!type || !me) return false;
    const sameDept = Boolean(me.departmentId) && p.departmentId === me.departmentId;
    if (isAdminRole(p.role)) {
      if (type === 'ONE_ON_ONE') return false;
      if (type === 'INTERNAL') return !isEmployee && includeAdmin;
      return includeAdmin;
    }
    if (type === 'ONE_ON_ONE' || type === 'INTERNAL') return sameDept;
    if (type === 'EXTERNAL') return p.departmentId !== null && departmentIds.includes(p.departmentId);
    return true;
  };

  const visible = useMemo(() => (options?.people ?? [])
    .filter(inScope)
    .filter((p) => isAdminRole(p.role) || roles.includes(p.role))
    .filter((p) => !query.trim() || p.name.toLowerCase().includes(query.trim().toLowerCase())),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [options, type, departmentIds, roles, includeAdmin, query]);

  const toggle = (id: string) => {
    const person = peopleById.get(id);
    if (!person || person.inMeeting) return;
    if (type === 'ONE_ON_ONE') { setSelected([id]); return; }
    setSelected((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  };
  const add = (id: string | null | undefined) => {
    if (!id) return;
    const person = peopleById.get(id);
    if (!person || person.inMeeting || !inScope(person)) return;
    if (type === 'ONE_ON_ONE') setSelected([id]);
    else setSelected((current) => current.includes(id) ? current : [...current, id]);
  };
  const adminIds = (options?.people ?? []).filter((p) => isAdminRole(p.role)).map((p) => p.id);
  const canPickAdmin = type === 'EXTERNAL' || type === 'CUSTOM' || (type === 'INTERNAL' && !isEmployee);
  const selectedPeople = selected.map((id) => peopleById.get(id)).filter(Boolean) as Person[];
  /** Mirrors the server: senior attendees + one available leader for every department. */
  const approvalPlan = useMemo(() => {
    if (!options || !type || !me) return { candidates: [], mandatoryIds: [], groups: [], recommendedIds: [] };
    const available = options.approvalCandidates.filter((candidate) => candidate.id !== me.id && !candidate.onLeave);
    const selectedSet = new Set(selected);
    const mandatory = available.filter((candidate) => selectedSet.has(candidate.id));
    const departments = new Map<string, string>();
    [me, ...selectedPeople].forEach((person) => {
      if (person.departmentId) departments.set(person.departmentId, person.departmentName ?? person.departmentId);
    });
    const groups: { departmentId: string; departmentName: string; candidateIds: string[] }[] = [];
    departments.forEach((departmentName, departmentId) => {
      if (mandatory.some((candidate) => candidate.departmentIds.includes(departmentId) || isAdminRole(candidate.role))) return;
      const organizerRank = me.departmentId === departmentId ? (RANK[me.role] ?? 0) : 0;
      const clientOnly = type === 'EXTERNAL' && Boolean(clientName.trim()) && selected.length === 0;
      const minimumRank = Math.max(clientOnly ? RANK.MANAGER : RANK.TEAM_LEAD, organizerRank + 1);
      let choices = available
        .filter((candidate) => candidate.departmentIds.includes(departmentId) && (RANK[candidate.role] ?? 0) >= minimumRank)
        .sort((a, b) => (RANK[a.role] ?? 0) - (RANK[b.role] ?? 0) || a.name.localeCompare(b.name));
      if (!choices.length) {
        const admins = available.filter((candidate) => isAdminRole(candidate.role));
        const adminRank = Math.min(Infinity, ...admins.map((candidate) => RANK[candidate.role] ?? 0));
        choices = admins.filter((candidate) => (RANK[candidate.role] ?? 0) === adminRank);
      }
      groups.push({ departmentId, departmentName, candidateIds: choices.map((candidate) => candidate.id) });
    });
    const allowedIds = new Set([...mandatory.map((candidate) => candidate.id), ...groups.flatMap((group) => group.candidateIds)]);
    return {
      candidates: options.approvalCandidates.filter((candidate) => allowedIds.has(candidate.id)),
      mandatoryIds: mandatory.map((candidate) => candidate.id),
      groups,
      recommendedIds: Array.from(new Set([...mandatory.map((candidate) => candidate.id), ...groups.map((group) => group.candidateIds[0]).filter(Boolean)])),
    };
  }, [options, type, me, selected, selectedPeople, clientName]);

  const approvalPlanKey = approvalPlan.recommendedIds.join('|');
  useEffect(() => setApproverIds(approvalPlan.recommendedIds), [approvalPlanKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedApprovers = approvalPlan.candidates.filter((candidate) => approverIds.includes(candidate.id));
  const uncoveredApprovalGroup = approvalPlan.groups.find((group) => !group.candidateIds.some((id) => approverIds.includes(id)));
  const missingMandatoryApprover = approvalPlan.mandatoryIds.some((id) => !approverIds.includes(id));

  const problem = (() => {
    if (agenda.trim().length < 3) return 'Add an agenda (at least 3 characters).';
    if (!type) return 'Choose a meeting type.';
    if (type === 'ONE_ON_ONE' && selected.length !== 1) return 'A one-on-one has exactly one other person.';
    if (type === 'INTERNAL' && selected.length < 1) return 'Add at least one person from your department.';
    if (!approvalPlan.candidates.length) return 'No available approver was found for this meeting.';
    if (missingMandatoryApprover) return 'Keep every senior attendee in the approval list.';
    if (uncoveredApprovalGroup) return `Choose an approver for ${uncoveredApprovalGroup.departmentName}.`;
    if (type === 'EXTERNAL' && !selected.length && !clientName.trim()) return 'Add people from another department, or a client.';
    if (type === 'CUSTOM' && !selected.length && !guestNames.trim()) return 'Add at least one person.';
    return null;
  })();

  const start = async () => {
    if (problem || !type) return;
    setSaving(true);
    try {
      await workdayApi.startMeetingV2({
        agenda: agenda.trim(),
        type,
        purpose: purpose || undefined,
        participantIds: selected,
        clientName: type === 'EXTERNAL' ? clientName.trim() || undefined : undefined,
        guestNames: type === 'CUSTOM' || type === 'EXTERNAL' ? guestNames.trim() || undefined : undefined,
        isDepartmental,
        approverIds,
      });
      toast.success(selected.length ? 'Meeting started. Invites sent.' : 'Meeting started');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workday-today'] }),
        queryClient.invalidateQueries({ queryKey: ['meeting-v2-active'] }),
      ]);
      onStarted();
    } catch (error: any) {
      toast.error(error?.message || 'The meeting could not be started');
      queryClient.invalidateQueries({ queryKey: ['meeting-v2-options'] });
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500/25';
  const labelCls = 'mb-1.5 block font-mono text-xs uppercase tracking-wider text-slate-400';

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
        style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      >
        <div className="apex-scale-in flex max-h-[calc(100vh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="meeting-start-title" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center gap-3 bg-gradient-to-r from-blue-700 to-blue-600 px-6 py-5">
            <span className="apex-pulse-dot h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: MEETING_ACCENT }} />
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/15 text-white">
              <UsersRound size={16} />
            </div>
            <div className="flex-1">
              <h2 id="meeting-start-title" className="text-base font-semibold text-white">Start a Meeting</h2>
              <p className="mt-0.5 text-xs text-slate-400">Your work pauses when the meeting starts</p>
            </div>
            <button type="button" onClick={onClose} className="text-slate-400 transition-colors hover:text-white" aria-label="Close"><X size={16} /></button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto bg-white px-6 py-5">
            {isLoading && <p className="py-6 text-center text-sm text-slate-500">Loading people…</p>}
            {isError && <p className="py-6 text-center text-sm text-red-600">People could not be loaded. Close this and try again.</p>}
            {options && <>
              <label className="block">
                <span className={labelCls}>Agenda</span>
                <input value={agenda} onChange={(event) => setAgenda(event.target.value)} maxLength={200} autoFocus placeholder="What is this meeting about?" className={inputCls} />
              </label>

              <div>
                <span className={labelCls}>Meeting type</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {TYPES.map((item) => (
                    <button key={item.id} type="button" onClick={() => chooseType(item.id)} aria-pressed={type === item.id}
                      className="rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all"
                      style={type === item.id
                        ? { borderColor: MEETING_ACCENT, backgroundColor: 'rgba(37,99,235,0.08)', color: '#1e40af' }
                        : { borderColor: '#e2e8f0', color: '#334155' }}>
                      <span className="block font-semibold">{item.title}</span>
                      <span className="mt-0.5 block text-[11px] text-slate-500">{item.id === 'INTERNAL' && isEmployee ? 'Departmental meeting' : item.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              {type && <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className={labelCls}>Purpose (optional)</span>
                    <select value={purpose} onChange={(event) => setPurpose(event.target.value)} className={inputCls}>
                      <option value="">Choose…</option>
                      {PURPOSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </label>
                  {type === 'EXTERNAL' && <label className="block">
                    <span className={labelCls}>Client (optional)</span>
                    <input value={clientName} onChange={(event) => setClientName(event.target.value)} maxLength={200} placeholder="Client or company name" className={inputCls} />
                  </label>}
                  {type === 'CUSTOM' && <label className="block">
                    <span className={labelCls}>People outside Apex (optional)</span>
                    <input value={guestNames} onChange={(event) => setGuestNames(event.target.value)} maxLength={500} placeholder="Names, separated by commas" className={inputCls} />
                  </label>}
                </div>

                {isDepartmental && <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">As an employee you can start a <b>departmental meeting</b> with people in your department, including your Team Lead.</p>}

                <div className="rounded-2xl border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-mono text-xs uppercase tracking-wider text-slate-400">Collaborators{type === 'ONE_ON_ONE' ? ' · pick one' : ''}</span>
                    <span className="text-xs font-semibold text-slate-500">{selected.length} selected</span>
                  </div>

                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {options.myTeamLeadId && <button type="button" onClick={() => add(options.myTeamLeadId)} className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-blue-600 hover:text-blue-700">+ My Team Lead</button>}
                    {options.myManagerId && <button type="button" onClick={() => add(options.myManagerId)} className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-blue-600 hover:text-blue-700">+ My Manager</button>}
                    {canPickAdmin && adminIds.length > 0 && <button type="button" onClick={() => { setIncludeAdmin(true); setSelected((current) => Array.from(new Set([...current, ...adminIds.filter((id) => !peopleById.get(id)?.inMeeting)]))); }} className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-blue-600 hover:text-blue-700">+ Admin</button>}
                    {type !== 'ONE_ON_ONE' && visible.length > 0 && <button type="button" onClick={() => setSelected((current) => Array.from(new Set([...current, ...visible.filter((p) => !p.inMeeting).map((p) => p.id)])))} className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:border-blue-600 hover:text-blue-700">+ Everyone shown</button>}
                  </div>

                  {type === 'EXTERNAL' && <div className="mb-2">
                    <span className="mb-1 block text-[11px] font-semibold text-slate-500">Departments</span>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {options.departments.filter((d) => d.id !== me?.departmentId).map((d) => (
                        <label key={d.id} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                          <input type="checkbox" checked={departmentIds.includes(d.id)} onChange={(event) => setDepartmentIds((current) => event.target.checked ? [...current, d.id] : current.filter((id) => id !== d.id))} />
                          {d.name}
                        </label>
                      ))}
                    </div>
                  </div>}

                  <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-[11px] font-semibold text-slate-500">Roles</span>
                    {FILTER_ROLES.map((role) => (
                      <label key={role} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                        <input type="checkbox" checked={roles.includes(role)} onChange={(event) => setRoles((current) => event.target.checked ? [...current, role] : current.filter((r) => r !== role))} />
                        {ROLE_LABEL[role]}
                      </label>
                    ))}
                    {canPickAdmin && <label className="inline-flex items-center gap-1.5 text-xs text-slate-700"><input type="checkbox" checked={includeAdmin} onChange={(event) => setIncludeAdmin(event.target.checked)} />Admin</label>}
                  </div>

                  <div className="relative mb-2">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a name" aria-label="Search people" className={`${inputCls} pl-9`} />
                  </div>

                  <div className="max-h-56 overflow-y-auto border-t border-slate-100" role="list">
                    {type === 'EXTERNAL' && departmentIds.length === 0 && !includeAdmin
                      ? <p className="px-1 py-4 text-center text-xs text-slate-500">Tick one or more departments to see their people.</p>
                      : visible.length === 0
                        ? <p className="px-1 py-4 text-center text-xs text-slate-500">No one matches these filters.</p>
                        : visible.map((person) => (
                          <label key={person.id} role="listitem" className={`flex items-center gap-3 border-b border-slate-100 px-1 py-2 last:border-b-0 ${person.inMeeting ? 'opacity-50' : 'cursor-pointer hover:bg-slate-50'}`}>
                            <input type={type === 'ONE_ON_ONE' ? 'radio' : 'checkbox'} name="meeting-person" checked={selected.includes(person.id)} disabled={person.inMeeting} onChange={() => toggle(person.id)} />
                            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-[11px] font-bold text-blue-700">{initials(person.name)}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-slate-800">{person.name}</span>
                              <span className="block truncate text-[11px] text-slate-500">{ROLE_LABEL[person.role] ?? person.role}{person.departmentName ? ` · ${person.departmentName}` : ''}</span>
                            </span>
                            {person.inMeeting && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">In a meeting</span>}
                          </label>
                        ))}
                  </div>

                  {selected.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">
                    {selected.map((id) => {
                      const person = peopleById.get(id);
                      if (!person) return null;
                      return <span key={id} className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-1 pl-2.5 pr-1 text-xs font-semibold text-blue-800">
                        {person.name}
                        <button type="button" onClick={() => setSelected((current) => current.filter((x) => x !== id))} className="rounded-full px-1 hover:bg-blue-100" aria-label={`Remove ${person.name}`}><X size={12} /></button>
                      </span>;
                    })}
                  </div>}
                </div>

                <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-3">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <span className={labelCls}>Send for approval to</span>
                      <p className="text-xs text-slate-600">Every department in the meeting must have a leader validating its recorded time.</p>
                    </div>
                    <div className="grid min-w-72 grid-cols-1 gap-2 sm:grid-cols-2">
                      <label>
                        <span className="mb-1 block text-[11px] font-semibold text-slate-600">Designation filter</span>
                        <select value={approverRoleFilter} onChange={(event) => setApproverRoleFilter(event.target.value)} className={inputCls}>
                          <option value="ALL">All designations</option>
                          <option value="TEAM_LEAD">Team Leader</option>
                          <option value="MANAGER">Manager</option>
                          <option value="ADMIN">Admin</option>
                          <option value="SUPER_ADMIN">Super Admin</option>
                        </select>
                      </label>
                      <label>
                        <span className="mb-1 block text-[11px] font-semibold text-slate-600">Name filter</span>
                        <input value={approverQuery} onChange={(event) => setApproverQuery(event.target.value)} placeholder="Search name" className={inputCls} />
                      </label>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {approvalPlan.candidates
                      .filter((candidate) => approverRoleFilter === 'ALL' || candidate.role === approverRoleFilter)
                      .filter((candidate) => !approverQuery.trim() || candidate.name.toLowerCase().includes(approverQuery.trim().toLowerCase()))
                      .map((candidate) => {
                        const mandatory = approvalPlan.mandatoryIds.includes(candidate.id);
                        const departments = approvalPlan.groups.filter((group) => group.candidateIds.includes(candidate.id)).map((group) => group.departmentName);
                        return (
                          <label key={candidate.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-blue-100 bg-white px-3 py-2 hover:border-blue-400">
                            <input
                              type="checkbox"
                              checked={approverIds.includes(candidate.id)}
                              disabled={mandatory}
                              onChange={(event) => setApproverIds((current) => event.target.checked
                                ? Array.from(new Set([...current, candidate.id]))
                                : current.filter((id) => id !== candidate.id))}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-slate-800">{candidate.name}</span>
                              <span className="block text-[11px] text-slate-500">{ROLE_LABEL[candidate.role] ?? candidate.role}{departments.length ? ` · ${departments.join(', ')}` : ' · attending senior'}</span>
                            </span>
                            {mandatory && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">Attending senior</span>}
                          </label>
                        );
                      })}
                    {!approvalPlan.candidates.length && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">No available Team Leader, Manager or Admin was found. A meeting cannot be validated until the hierarchy is assigned.</p>}
                  </div>

                  <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                    <span className="block font-mono text-[11px] uppercase tracking-wider text-emerald-700">Approval goes to</span>
                    <span className="block text-sm font-semibold text-slate-800">{selectedApprovers.length ? selectedApprovers.map((candidate) => `${candidate.name} (${ROLE_LABEL[candidate.role]})`).join(', ') : 'Choose an approver'}</span>
                    <span className="block text-xs text-slate-600">The meeting starts now. These approvals validate the saved meeting time after it ends.</span>
                  </div>
                </div>
              </>}
            </>}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-b-3xl border-t border-slate-200 bg-slate-50 px-6 py-4">
            <span className="text-xs text-red-600">{(agenda || type) && problem ? problem : ''}</span>
            <div className="flex flex-shrink-0 gap-2">
              <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100">Cancel</button>
              <button type="button" onClick={start} disabled={saving || Boolean(problem)} className="rounded-xl px-5 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50" style={{ backgroundColor: MEETING_ACCENT }}>
                {saving ? 'Starting…' : 'Start Meeting'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
