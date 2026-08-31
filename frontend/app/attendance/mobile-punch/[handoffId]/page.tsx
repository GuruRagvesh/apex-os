'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, MapPin, ShieldAlert } from 'lucide-react';
import { AttendanceCamera } from '@/components/attendance/AttendanceCamera';
import { useLocationAcquisition } from '@/components/attendance/useLocationAcquisition';
import {
  forgetHandoffSecret,
  takeHandoffToken,
  viewHandoff,
  type HandoffView,
} from '@/components/attendance/handoff-api';
import { newIdempotencyKey, submitPunch } from '@/components/attendance/punch-api';

/**
 * The phone half of the punch handoff.
 *
 * Deliberately OUTSIDE the (dashboard) route group: no sidebar, no topbar, no
 * navigation to anywhere else. Someone finishing a punch on their phone in a
 * doorway should see one task and no way to wander into the rest of Apex OS.
 *
 * THE FRAGMENT PROBLEM. The secret arrives in `#token=...` because a fragment
 * is never sent to a server and so cannot be logged. But a login redirect is a
 * navigation, and navigations lose fragments. So the token is read and stashed
 * BEFORE anything can redirect, the redirect carries only the handoff id, and
 * the secret is recovered from session storage on the way back.
 *
 * The stash is cleared on every ending — completion, refusal, expiry — so a
 * shared phone does not keep a live punch secret.
 */

type Phase = 'checking' | 'invalid' | 'location' | 'photo' | 'submitting' | 'done';

/**
 * `params` is a PLAIN OBJECT on Next 14, not a promise.
 *
 * This page previously read it with React's `use()`. The installed React is
 * 18.3.1, which does not export `use` at all -- but @types/react 18.3.x
 * declares it, so both `tsc` and the production build passed while the page
 * threw `use is not a function` on its very first render, before any token,
 * auth or handoff logic could run. That is what reached production as
 * "Application error: a client-side exception has occurred".
 *
 * Read the object directly. When this project moves to Next 15, `params`
 * becomes a promise and this signature changes with it -- deliberately, and
 * with the React version that provides `use`.
 */
export default function MobilePunchPage({
  params,
}: {
  params: { handoffId: string };
}) {
  const { handoffId } = params;
  const loc = useLocationAcquisition();

  const [phase, setPhase] = useState<Phase>('checking');
  const [handoff, setHandoff] = useState<HandoffView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // A live clock, so the page shows what is about to be recorded rather than
  // whatever the moment the page happened to load. Ticks only while the punch
  // is still being prepared.
  const [now, setNow] = useState(() => new Date());
  const settled = phase === 'done' || phase === 'invalid';
  useEffect(() => {
    if (settled) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [settled]);

  const dateLabel = now.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const clock = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  // Runs before any redirect can discard the fragment. takeHandoffToken reads
  // the hash, stashes the secret, strips the address bar, and falls back to the
  // stash when arriving back from login -- all in one place, so no ordering
  // mistake here can lose the token.
  //
  // `null` means "not looked yet"; `''` means "looked, found nothing". Without
  // that distinction the auth effect below cannot tell a page that is still
  // reading the fragment from one that has no token at all.
  useEffect(() => {
    setToken(takeHandoffToken(handoffId) ?? '');
  }, [handoffId]);

  useEffect(() => {
    if (token === null) return;

    // Looked, and there was nothing. A bare URL with no fragment and no stash
    // cannot complete a punch, and must say so rather than sit on a spinner.
    if (token === '') {
      setPhase('invalid');
      setError('This punch link is incomplete. Scan the QR code again from your computer.');
      return;
    }

    // NO LOGIN. The token is the credential: it is single-use, expires in
    // minutes, is stored only as a hash, and names the employee and the punch
    // type on the server side where the phone cannot influence them. Sending an
    // employee through a login screen to finish a punch their own laptop
    // already authorised is friction with no security to show for it.
    //
    // The server still refuses a session belonging to a DIFFERENT employee, so
    // a colleague scanning this QR on their own signed-in phone is turned away.
    (async () => {
      try {
        const view = await viewHandoff(handoffId, token);
        setHandoff(view);
        setPhase('location');
        void loc.locate();
      } catch (err: any) {
        forgetHandoffSecret(handoffId);
        setPhase('invalid');
        setError(err?.response?.data?.message ?? 'This punch link is not valid.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, handoffId]);

  useEffect(() => {
    if (phase === 'location' && loc.phase === 'ready') setPhase('photo');
  }, [phase, loc.phase]);

  const onCaptured = useCallback(
    async (photoAssetId: string) => {
      if (!handoff || !loc.sample) return;
      setPhase('submitting');
      try {
        await submitPunch({
          type: handoff.intent,
          latitude: loc.sample.latitude,
          longitude: loc.sample.longitude,
          accuracyMeters: loc.sample.accuracyMeters,
          photoAssetId,
          clientCapturedAt: loc.sample.capturedAt,
          // The server reads the shared key from the handoff it claims; this is
          // only a fallback for the non-handoff path.
          idempotencyKey: newIdempotencyKey(),
          handoffId,
          handoffToken: token ?? undefined,
        });
        forgetHandoffSecret(handoffId);
        setPhase('done');
      } catch (err: any) {
        forgetHandoffSecret(handoffId);
        setPhase('invalid');
        setError(err?.response?.data?.message ?? 'The punch could not be recorded.');
      }
    },
    [handoff, loc.sample, handoffId, token],
  );

  const title = handoff?.intent === 'PUNCH_OUT' ? 'Punch out' : 'Punch in';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-5">
      <header className="apex-card">
        <p className="apex-text-subtle text-[10px] font-semibold uppercase tracking-widest">
          Apex OS Attendance
        </p>
        <h1 className="apex-text mt-0.5 text-xl font-semibold">{title}</h1>
        {handoff?.employeeName && (
          <p className="apex-text mt-1 text-sm font-medium">{handoff.employeeName}</p>
        )}
        <div className="apex-text-muted mt-2 flex items-center gap-1.5 text-xs">
          <Clock size={13} className="apex-text-subtle" />
          <span>{dateLabel}</span>
          <span aria-hidden="true">·</span>
          {/* Live, so the employee can see the system agrees with their watch
              before they commit. The authoritative punch time is the server's. */}
          <span className="tabular-nums">{clock}</span>
        </div>
      </header>

      {phase === 'checking' && <Waiting label="Checking this link…" />}

      {phase === 'invalid' && (
        <div className="apex-card text-center">
          <ShieldAlert size={20} className="mx-auto mb-2 text-amber-500" />
          <p className="apex-text text-sm font-medium">{error}</p>
          <p className="apex-text-muted mt-1 text-xs">
            Start the punch again from your computer, or ask your manager or HR to record it.
          </p>
        </div>
      )}

      {phase === 'location' && (
        <div className="apex-card text-center">
          {loc.phase === 'failed' ? (
            <>
              <p className="text-sm font-medium text-red-600 dark:text-red-400">{loc.message}</p>
              {!loc.terminal && (
                <button
                  onClick={() => void loc.locate()}
                  className="mt-3 rounded-lg border border-[var(--border-secondary)] px-3 py-1.5 text-sm apex-text"
                >
                  Try again
                </button>
              )}
            </>
          ) : (
            <>
              <MapPin size={18} className="apex-text-subtle mx-auto mb-2" />
              <p className="apex-text-muted text-sm">Getting your location…</p>
            </>
          )}
        </div>
      )}

      {phase === 'photo' && (
        <div className="apex-card">
          <dl className="mb-3 grid grid-cols-3 gap-2 rounded-lg bg-[var(--surface-secondary,rgba(127,127,127,.08))] p-2.5">
            <Fact label="Date" value={dateLabel} />
            <Fact label="Time" value={clock} />
            <Fact
              label="Accuracy"
              value={
                loc.sample?.accuracyMeters != null
                  ? `${Math.round(loc.sample.accuracyMeters)} m`
                  : '—'
              }
            />
          </dl>
          <p className="apex-text-muted mb-3 text-xs">
            Take a photo to finish. Both the photo and the location come from this phone.
          </p>
          <AttendanceCamera
            onCaptured={onCaptured}
            handoff={token ? { handoffId, handoffToken: token } : null}
          />
        </div>
      )}

      {phase === 'submitting' && <Waiting label="Recording your punch…" />}

      {phase === 'done' && (
        <div className="apex-card text-center">
          <CheckCircle2 size={22} className="mx-auto mb-2 text-emerald-500" />
          <p className="apex-text text-sm font-medium">Punch recorded</p>
          <p className="apex-text-muted mt-1 text-xs">
            You can close this page. Your computer has been updated.
          </p>
        </div>
      )}
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="apex-text-subtle text-[10px] uppercase tracking-wide">{label}</dt>
      <dd className="apex-text mt-0.5 text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Waiting({ label }: { label: string }) {
  return (
    <div className="apex-card flex items-center justify-center gap-2 py-8">
      <Loader2 size={16} className="apex-text-subtle animate-spin" />
      <span className="apex-text-muted text-sm">{label}</span>
    </div>
  );
}
