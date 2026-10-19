'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Check, ClipboardCheck, UsersRound, X } from 'lucide-react';
import { workdayApi } from '@/lib/api';
import { ModalPortal } from '../ui/ModalPortal';

const MEETING_ACCENT = '#2563EB';
const TYPE_LABEL: Record<string, string> = { ONE_ON_ONE: 'One-on-one', INTERNAL: 'Internal', EXTERNAL: 'External', CUSTOM: 'Custom' };
const PURPOSE_LABEL: Record<string, string> = { REVIEW: 'Review', PLANNING: 'Planning', TRAINING: 'Training / knowledge share', CLIENT: 'Client', STATUS_UPDATE: 'Status update', OTHER: 'Other' };

function meetingLine(meeting: any) {
  return [
    meeting.isDepartmental ? 'Departmental' : TYPE_LABEL[meeting.type] ?? meeting.type,
    meeting.purpose ? PURPOSE_LABEL[meeting.purpose] ?? meeting.purpose : null,
    meeting.clientName ? `Client: ${meeting.clientName}` : null,
  ].filter(Boolean).join(' · ');
}

function minutesBetween(start?: string | null, end?: string | null) {
  if (!start || !end) return null;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
}

/**
 * Meeting invites and approvals, shown on whatever Apex page the person is on.
 *
 * Invites open as a flickering popup over the whole screen: Approve & join
 * pauses their work and opens the meeting; Reject means nothing is recorded
 * for them. Approvers get a card for each finished meeting waiting on them.
 */
export function MeetingInviteCenter() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const { data: invites = [] } = useQuery<any[]>({
    queryKey: ['meeting-v2-invites'],
    queryFn: () => workdayApi.getMeetingInvites() as Promise<any[]>,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const { data: approvals = [] } = useQuery<any[]>({
    queryKey: ['meeting-v2-approvals'],
    queryFn: () => workdayApi.getMeetingApprovals() as Promise<any[]>,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const invite = invites[0] ?? null;

  const respond = async (meetingId: string, accept: boolean) => {
    setBusy(meetingId);
    try {
      const result = await workdayApi.respondToMeetingInvite(meetingId, accept) as any;
      if (!accept) toast.success('Invite declined. Nothing is recorded for you.');
      else if (result?.recorded) toast.success('You joined the meeting.');
      else toast.success('Joined. Start your workday for the meeting time to count.');
    } catch (error: any) {
      toast.error(error?.message || 'Your answer could not be saved');
    } finally {
      setBusy(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['meeting-v2-invites'] }),
        queryClient.invalidateQueries({ queryKey: ['workday-today'] }),
        queryClient.invalidateQueries({ queryKey: ['meeting-v2-active'] }),
      ]);
    }
  };

  const decide = async (meetingId: string, approve: boolean) => {
    setBusy(meetingId);
    try {
      await workdayApi.decideMeeting(meetingId, approve);
      toast.success(approve ? 'Meeting approved' : 'Meeting rejected');
    } catch (error: any) {
      toast.error(error?.message || 'Your decision could not be saved');
    } finally {
      setBusy(null);
      await queryClient.invalidateQueries({ queryKey: ['meeting-v2-approvals'] });
    }
  };

  return (
    <>
      {invite && (
        <ModalPortal>
          <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}>
            <section className="apex-scale-in apex-meeting-invite-card w-full max-w-md overflow-hidden rounded-3xl bg-white" role="alertdialog" aria-modal="true" aria-labelledby="meeting-invite-title" aria-describedby="meeting-invite-body">
              <div className="flex items-center gap-3 bg-gradient-to-r from-blue-700 to-blue-600 px-6 py-5">
                <span className="apex-meeting-invite-dot h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: MEETING_ACCENT }} />
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/15 text-white"><UsersRound size={16} /></div>
                <div className="flex-1">
                  <h2 id="meeting-invite-title" className="text-base font-semibold text-white">Join the meeting?</h2>
                  <p className="mt-0.5 text-xs text-slate-400">{invites.length > 1 ? `${invites.length} invites waiting` : 'You have been added to a meeting'}</p>
                </div>
              </div>
              <div id="meeting-invite-body" className="space-y-3 px-6 py-5">
                <p className="text-sm text-slate-700"><b>{invite.organizer?.name}</b> added you to <b>&ldquo;{invite.agenda}&rdquo;</b>.</p>
                <p className="text-xs font-semibold text-slate-500">{meetingLine(invite)}</p>
                {invite.attendees?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {invite.attendees.map((person: any) => (
                      <span key={person.userId ?? person.name} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${person.status === 'ACCEPTED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {person.name}{person.status === 'ACCEPTED' ? ' · joined' : person.status === 'REJECTED' ? ' · declined' : ''}
                      </span>
                    ))}
                  </div>
                )}
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">If you approve, your work pauses and your meeting time is recorded from now. If you reject, nothing is recorded for you.</p>
              </div>
              <div className="flex items-center justify-end gap-2 rounded-b-3xl border-t border-slate-200 bg-slate-50 px-6 py-4">
                <button type="button" disabled={busy === invite.id} onClick={() => respond(invite.id, false)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"><X size={15} />Reject</button>
                <button type="button" disabled={busy === invite.id} onClick={() => respond(invite.id, true)} autoFocus className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50" style={{ backgroundColor: '#168763' }}><Check size={15} />Approve &amp; join</button>
              </div>
            </section>
          </div>
        </ModalPortal>
      )}

      {!invite && approvals.length > 0 && (
        <ModalPortal>
          <aside className="fixed bottom-4 right-4 z-[9990] w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" aria-label="Meetings waiting for your approval">
            <header className="flex items-center gap-2 bg-gradient-to-r from-blue-700 to-blue-600 px-4 py-3">
              <ClipboardCheck size={15} className="text-white" />
              <p className="text-sm font-semibold text-white">{approvals.length} meeting{approvals.length === 1 ? '' : 's'} to approve</p>
            </header>
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
              {approvals.map((meeting) => {
                const minutes = minutesBetween(meeting.startedAt, meeting.endedAt);
                const joined = (meeting.attendees ?? []).filter((p: any) => p.status === 'ACCEPTED' || p.status === 'LEFT').map((p: any) => p.name);
                return (
                  <li key={meeting.id} className="space-y-2 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{meeting.agenda}</p>
                      <p className="text-xs text-slate-500">{meeting.organizer?.name} · {meetingLine(meeting)}{minutes !== null ? ` · ${minutes} min` : ''}</p>
                      {joined.length > 0 && <p className="mt-0.5 text-xs text-slate-500">Attended: {joined.join(', ')}</p>}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" disabled={busy === meeting.id} onClick={() => decide(meeting.id, false)} className="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Reject</button>
                      <button type="button" disabled={busy === meeting.id} onClick={() => decide(meeting.id, true)} className="flex-1 rounded-xl px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: '#168763' }}>Approve</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </aside>
        </ModalPortal>
      )}
    </>
  );
}
