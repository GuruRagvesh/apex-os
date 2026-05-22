'use client';

import { useState } from 'react';
import { workdayApi } from '@/lib/api';
import toast from 'react-hot-toast';

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
    <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm shadow-xl">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xl">&#10003;</span>
          <h3 className="font-semibold text-gray-800 dark:text-gray-100">End Workday</h3>
        </div>

        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Work time</span>
            <span className="font-medium text-gray-800 dark:text-gray-100">{fmt(elapsed)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Break time</span>
            <span className="font-medium text-gray-800 dark:text-gray-100">{fmt(session?.totalBreakMinutes ?? 0)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Breaks taken</span>
            <span className="font-medium text-gray-800 dark:text-gray-100">{session?.breakLogs?.filter((b: any) => b.endAt).length ?? 0}</span>
          </div>
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
          <button
            onClick={handleEnd}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium bg-gray-800 dark:bg-gray-700 hover:bg-gray-900 dark:hover:bg-gray-600 text-white rounded-lg disabled:opacity-50"
          >
            {loading ? 'Ending...' : 'End Workday'}
          </button>
        </div>
      </div>
    </div>
  );
}
