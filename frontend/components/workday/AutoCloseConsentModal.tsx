'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { workdayApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Clock } from 'lucide-react';
import { ModalPortal } from '../ui/ModalPortal';

interface Props {
  autoCloseTime: string | null;
  onClose: () => void;
}

// Shown once a WORKING/ON_BREAK session crosses the company's auto-close
// cutoff. This is a forced decision, not a dismissible notice — see
// workday.policy.helper.ts's grace window for the backend-side half of this
// fix (which is what actually protects genuinely abandoned sessions; this
// modal exists so an ACTIVE user gets a clear choice instead of a silent
// close). Deliberately has no backdrop-click-to-close and no close button —
// only Continue Working or End Workday dismiss it.
export function AutoCloseConsentModal({ autoCloseTime, onClose }: Props) {
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState<'end' | 'continue' | null>(null);
  const continueBtnRef = useRef<HTMLButtonElement>(null);
  const endBtnRef = useRef<HTMLButtonElement>(null);

  const refetchWorkday = () => queryClient.invalidateQueries({ queryKey: ['workday-today'] });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    continueBtnRef.current?.focus();

    // Capture phase so this runs before any other component's own Escape
    // handler (command palette, dropdowns, etc.) — Escape must not close
    // this modal, and must not leak through to close something else either.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Minimal focus trap: only two focusable elements exist in this modal.
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === continueBtnRef.current) {
          e.preventDefault();
          endBtnRef.current?.focus();
        } else if (!e.shiftKey && document.activeElement === endBtnRef.current) {
          e.preventDefault();
          continueBtnRef.current?.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);

  const handleEnd = async () => {
    setLoading('end');
    try {
      await workdayApi.endWork();
      toast.success('Workday ended. Great work today!');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to end workday');
    } finally {
      setLoading(null);
      refetchWorkday();
    }
  };

  const handleContinue = async () => {
    setLoading('continue');
    try {
      await workdayApi.continueWorking();
      toast.success('Continuing your workday.');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to continue');
    } finally {
      setLoading(null);
      refetchWorkday();
    }
  };

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
      // No onClick handler here — backdrop clicks are intentionally inert.
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="autoclose-consent-title"
        aria-describedby="autoclose-consent-body"
        className="apex-scale-in w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'white' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 flex items-center gap-3" style={{ backgroundColor: '#0B1220' }}>
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}
          >
            <Clock size={16} />
          </div>
          <div className="flex-1">
            <h2 id="autoclose-consent-title" className="text-base font-semibold text-white">
              Auto-close time reached
            </h2>
            {autoCloseTime && (
              <p className="text-xs text-slate-400 mt-0.5">Company auto-close time: {autoCloseTime}</p>
            )}
          </div>
        </div>

        <div className="bg-white px-6 py-5">
          <p id="autoclose-consent-body" className="text-sm text-slate-600">
            It is time to auto-close your workday. Do you want to continue working or end the day?
          </p>
        </div>

        <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex items-center justify-end gap-2 rounded-b-3xl">
          <button
            ref={endBtnRef}
            onClick={handleEnd}
            disabled={!!loading}
            className="px-4 py-2 text-sm font-semibold text-white rounded-xl transition-colors disabled:opacity-50"
            style={{ backgroundColor: '#0B1220' }}
          >
            {loading === 'end' ? 'Ending...' : 'End Workday'}
          </button>
          <button
            ref={continueBtnRef}
            onClick={handleContinue}
            disabled={!!loading}
            className="px-5 py-2 text-sm font-semibold text-white rounded-xl transition-colors disabled:opacity-50"
            style={{ backgroundColor: '#10B981' }}
          >
            {loading === 'continue' ? 'Continuing...' : 'Continue Working'}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
