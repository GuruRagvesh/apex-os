'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, MapPin, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
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

type Phase = 'checking' | 'need-login' | 'invalid' | 'location' | 'photo' | 'submitting' | 'done';

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
  const router = useRouter();
  const { isAuthenticated, hasHydrated } = useAuthStore();
  const loc = useLocationAcquisition();

  const [phase, setPhase] = useState<Phase>('checking');
  const [handoff, setHandoff] = useState<HandoffView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

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
    if (!hasHydrated || token === null) return;

    // Looked, and there was nothing. A bare URL with no fragment and no stash
    // cannot complete a punch, and must say so rather than sit on a spinner.
    if (token === '') {
      setPhase('invalid');
      setError('This punch link is incomplete. Scan the QR code again from your computer.');
      return;
    }

    if (!isAuthenticated) {
      setPhase('need-login');
      // Only the id travels in the URL. The secret stays in session storage.
      router.replace(`/login?returnTo=${encodeURIComponent(`/attendance/mobile-punch/${handoffId}`)}`);
      return;
    }

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
  }, [hasHydrated, isAuthenticated, token, handoffId]);

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

  const title = handoff?.intent === 'PUNCH_OUT' ? 'Complete punch out' : 'Complete punch in';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 p-5">
      <header>
        <p className="apex-text-subtle text-xs font-semibold uppercase tracking-wide">Apex OS</p>
        <h1 className="apex-text text-lg font-semibold">{title}</h1>
        {handoff?.employeeName && (
          <p className="apex-text-muted text-xs">{handoff.employeeName}</p>
        )}
      </header>

      {phase === 'checking' && <Waiting label="Checking this link…" />}
      {phase === 'need-login' && <Waiting label="Sign in to continue…" />}

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
          <p className="apex-text-muted mb-3 text-xs">
            Location captured
            {loc.sample?.accuracyMeters != null &&
              ` · accurate to about ${Math.round(loc.sample.accuracyMeters)} m`}
          </p>
          <AttendanceCamera onCaptured={onCaptured} />
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

function Waiting({ label }: { label: string }) {
  return (
    <div className="apex-card flex items-center justify-center gap-2 py-8">
      <Loader2 size={16} className="apex-text-subtle animate-spin" />
      <span className="apex-text-muted text-sm">{label}</span>
    </div>
  );
}
