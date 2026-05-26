'use client';

import { useState } from 'react';
import { workdayApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { CheckCircle, Clock } from 'lucide-react';

interface Props {
  session: any;
  onClose: () => void;
  onEnded: () => void;
}

function fmt(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function EndDayModal({ session, onClose, onEnded }: Props) {
  const [loading, setLoading] = useState(false);

  const elapsed = session?.startWorkAt
    ? Math.max(0, Math.floor((Date.now() - new Date(session.startWorkAt).getTime()) / 60000) - (session.totalBreakMinutes ?? 0))
    : 0;

  const handleEnd = async () => {
    setLoading(true);
    try {
      await workdayApi.endWork();
      toast.success('Workday ended. Great work today!');
      onEnded();
    } catch { toast.error('Failed to end workday'); }
    finally { setLoading(false); }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="apex-scale-in w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'white' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Dark navy header */}
        <div
          className="px-6 py-5 flex items-center gap-3"
          style={{ backgroundColor: '#0B1220' }}
        >
          <span
            className="apex-pulse-dot w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: '#10B981' }}
          />
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'rgba(16,185,129,0.15)', color: '#10B981' }}
          >
            <CheckCircle size={16} />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-white">End Your Day</h2>
            <p className="text-xs text-slate-400 mt-0.5">Confirm your session summary below</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* White body — session summary */}
        <div className="bg-white px-6 py-5">
          <div
            className="rounded-2xl overflow-hidden"
            style={{ border: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' }}
          >
            <div className="px-4 py-3 flex items-center justify-between border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-slate-400" />
                <span className="text-sm text-slate-500">Work time</span>
              </div>
              <span className="text-sm font-bold font-mono text-slate-800">{fmt(elapsed)}</span>
            </div>
            <div className="px-4 py-3 flex items-center justify-between border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded bg-orange-100 flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />
                </span>
                <span className="text-sm text-slate-500">Break time</span>
              </div>
              <span className="text-sm font-bold font-mono text-slate-800">{fmt(session?.totalBreakMinutes ?? 0)}</span>
            </div>
            <div className="px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded bg-blue-100 flex items-center justify-center">
                  <span className="text-[8px] font-bold text-blue-500">#</span>
                </span>
                <span className="text-sm text-slate-500">Breaks taken</span>
              </div>
              <span className="text-sm font-bold font-mono text-slate-800">
                {session?.breakLogs?.filter((b: any) => b.endAt).length ?? 0}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex items-center justify-end gap-2 rounded-b-3xl"
        >
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleEnd}
            disabled={loading}
            className="px-5 py-2 text-sm font-semibold text-white rounded-xl transition-colors disabled:opacity-50"
            style={{ backgroundColor: '#0B1220' }}
            onMouseEnter={(e) => { if (!loading) (e.currentTarget.style.backgroundColor = '#1E293B'); }}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#0B1220')}
          >
            {loading ? 'Ending...' : 'End Workday'}
          </button>
        </div>
      </div>
    </div>
  );
}
