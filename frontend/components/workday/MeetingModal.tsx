'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Clock3, Copy, Link2, Plus, Users, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { workdayApi } from '@/lib/api';
import { ModalPortal } from '../ui/ModalPortal';

type MeetingMode = 'NEW' | 'EXISTING';

const meetingTypes = [
  ['INTERNAL', 'Internal meeting'],
  ['ONE_ON_ONE', 'One-to-one'],
  ['REVIEW', 'Review meeting'],
  ['EXTERNAL', 'External meeting'],
  ['SELF', 'Self meeting'],
] as const;

function localDateTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function MeetingModal({
  breakLog,
  onClose,
  onChanged,
}: {
  breakLog: { id: string; startAt: string; endAt: string; durationMinutes?: number | null };
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<MeetingMode | null>(null);
  const [topic, setTopic] = useState('');
  const [counterpartyId, setCounterpartyId] = useState('');
  const [meetingCode, setMeetingCode] = useState('');
  const [meetingType, setMeetingType] = useState('INTERNAL');
  const [endedEarly, setEndedEarly] = useState(false);
  const [endedAt, setEndedAt] = useState(localDateTime(breakLog.endAt));
  const [savedCode, setSavedCode] = useState<string | null>(null);

  const { data: options } = useQuery({
    queryKey: ['meeting-options'],
    queryFn: () => workdayApi.getMeetingOptions() as Promise<any>,
  });

  const save = useMutation({
    mutationFn: () => workdayApi.classifyMeeting({
      breakLogId: breakLog.id,
      mode,
      topic: mode === 'NEW' ? topic : undefined,
      meetingType: mode === 'NEW' ? meetingType : undefined,
      meetingCode: mode === 'EXISTING' ? meetingCode.trim().toUpperCase() : undefined,
      counterpartyId,
      endedAt: endedEarly && endedAt ? new Date(endedAt).toISOString() : undefined,
    }) as Promise<any>,
    onSuccess: async (meeting) => {
      // Clear the cached pending item before the parent closes this modal. If
      // the stale break log remains in the cache for even one render, the
      // WorkdayBar's pending-classification effect opens the modal again.
      queryClient.setQueryData(['meeting-pending-classification'], null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workday-today'] }),
        queryClient.invalidateQueries({ queryKey: ['meetings'] }),
        queryClient.invalidateQueries({ queryKey: ['meeting-pending-classification'] }),
      ]);
      onChanged();
      // Only the organizer of a newly-created shared meeting needs to see and
      // copy its ID. Existing-meeting participants have already entered that
      // ID, so their successful verification should close immediately.
      if (mode === 'NEW' && meeting?.meetingCode) {
        setSavedCode(meeting.meetingCode);
        setStep(4);
      } else {
        toast.success(mode === 'EXISTING' ? 'Meeting ID verified and time recorded' : 'Meeting time recorded');
        onClose();
      }
    },
    onError: (error: any) => toast.error(error?.message || 'Meeting details could not be saved'),
  });

  const chooseMode = (nextMode: MeetingMode) => {
    setMode(nextMode);
    setStep(2);
  };
  const canContinue = mode === 'NEW'
    ? topic.trim().length >= 3 && !!counterpartyId
    : /^MTG-[A-Z0-9]{8}$/i.test(meetingCode.trim()) && !!counterpartyId;
  const capturedMinutes = breakLog.durationMinutes ?? Math.max(0, Math.floor((new Date(breakLog.endAt).getTime() - new Date(breakLog.startAt).getTime()) / 60_000));

  return <ModalPortal>
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <section className="w-full max-w-md overflow-hidden rounded-3xl border border-blue-100 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Record meeting details" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-blue-100 bg-blue-50/70 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white"><Users size={19} /></span>
            <div><h2 className="text-base font-bold text-slate-900">Record your meeting</h2><p className="text-xs text-slate-500">{capturedMinutes} min captured · step {Math.min(step, 3)} of 3</p></div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-white" aria-label="Close"><X size={18} /></button>
        </header>

        <div className="p-5">
          {step === 1 && <div>
            <p className="mb-4 text-sm font-semibold text-slate-800">Which meeting was this?</p>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => chooseMode('NEW')} className="rounded-2xl border border-blue-200 p-5 text-left transition hover:border-blue-500 hover:bg-blue-50"><Plus className="mb-3 text-blue-600" size={22} /><strong className="block text-sm text-slate-900">New meeting</strong><span className="mt-1 block text-xs leading-5 text-slate-500">Create a fresh meeting record</span></button>
              <button type="button" onClick={() => chooseMode('EXISTING')} className="rounded-2xl border border-blue-200 p-5 text-left transition hover:border-blue-500 hover:bg-blue-50"><Link2 className="mb-3 text-blue-600" size={22} /><strong className="block text-sm text-slate-900">Existing meeting</strong><span className="mt-1 block text-xs leading-5 text-slate-500">Join with a shared meeting ID</span></button>
            </div>
          </div>}

          {step === 2 && <div className="space-y-4">
            <p className="text-sm font-semibold text-slate-800">{mode === 'NEW' ? 'What was the meeting about?' : 'Which shared meeting did you join?'}</p>
            {mode === 'NEW' ? <label className="block text-xs font-semibold text-slate-600">Meeting topic<input value={topic} onChange={(event) => setTopic(event.target.value)} autoFocus placeholder="e.g. Sprint planning" className="mt-1.5 w-full rounded-xl border border-blue-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500" /></label> : <label className="block text-xs font-semibold text-slate-600">Meeting ID<input value={meetingCode} onChange={(event) => setMeetingCode(event.target.value.toUpperCase())} autoFocus placeholder="MTG-1234ABCD" className="mt-1.5 w-full rounded-xl border border-blue-200 px-3 py-2.5 font-mono text-sm uppercase outline-none focus:border-blue-500" /></label>}
            <label className="block text-xs font-semibold text-slate-600">Who was the meeting with?<select value={counterpartyId} onChange={(event) => setCounterpartyId(event.target.value)} className="mt-1.5 w-full rounded-xl border border-blue-200 bg-white px-3 py-2.5 text-sm"><option value="">Select person</option>{(options?.people ?? []).map((person: any) => <option key={person.id} value={person.id}>{person.name}{person.department?.name ? ` · ${person.department.name}` : ''}</option>)}</select></label>
            {mode === 'NEW' && <p className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">{options?.canCreateSharedMeeting ? 'A global meeting ID will be created for others to join.' : 'This will be saved as a personal meeting. Employees and interns cannot create global meeting IDs.'}</p>}
          </div>}

          {step === 3 && <div className="space-y-4">
            <p className="text-sm font-semibold text-slate-800">Confirm the meeting details</p>
            {mode === 'NEW' && <label className="block text-xs font-semibold text-slate-600">Meeting type<select value={meetingType} onChange={(event) => setMeetingType(event.target.value)} className="mt-1.5 w-full rounded-xl border border-blue-200 bg-white px-3 py-2.5 text-sm">{meetingTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
            <div className="rounded-2xl border border-blue-100 bg-slate-50 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Clock3 size={16} className="text-blue-600" />Did the meeting end when you resumed?</div>
              <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => setEndedEarly(false)} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${!endedEarly ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>Yes, use captured time</button><button type="button" onClick={() => setEndedEarly(true)} className={`rounded-xl border px-3 py-2 text-xs font-semibold ${endedEarly ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600'}`}>It ended earlier</button></div>
              {endedEarly && <input type="datetime-local" value={endedAt} min={localDateTime(breakLog.startAt)} max={localDateTime(breakLog.endAt)} onChange={(event) => setEndedAt(event.target.value)} className="mt-3 w-full rounded-xl border border-blue-200 bg-white px-3 py-2.5 text-sm" />}
            </div>
          </div>}

          {step === 4 && savedCode && <div className="py-3 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check size={24} /></span><h3 className="mt-3 font-bold text-slate-900">Shared meeting recorded</h3><p className="mt-1 text-xs text-slate-500">Share this ID with everyone who attended.</p><button type="button" onClick={() => { navigator.clipboard.writeText(savedCode); toast.success('Meeting ID copied'); }} className="mx-auto mt-4 flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-3 font-mono text-base font-bold text-blue-800"><span>{savedCode}</span><Copy size={16} /></button></div>}

          <footer className="mt-6 flex items-center justify-between">
            {step > 1 && step < 4 ? <button type="button" onClick={() => setStep(step - 1)} className="flex items-center gap-1 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"><ArrowLeft size={15} />Back</button> : <span />}
            {step === 2 && <button type="button" disabled={!canContinue} onClick={() => setStep(3)} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Continue</button>}
            {step === 3 && <button type="button" disabled={save.isPending || (endedEarly && !endedAt)} onClick={() => save.mutate()} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{save.isPending ? 'Verifying…' : mode === 'EXISTING' ? 'Verify & save' : 'Save meeting'}</button>}
            {step === 4 && <button type="button" onClick={onClose} className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">Done</button>}
          </footer>
        </div>
      </section>
    </div>
  </ModalPortal>;
}
