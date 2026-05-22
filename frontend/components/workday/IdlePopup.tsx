'use client';

import { useState } from 'react';
import { workdayApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { BreakModal } from './BreakModal';

interface Props {
  onClose: () => void;
  onRefetch: () => void;
}

export function IdlePopup({ onClose, onRefetch }: Props) {
  const [showBreak, setShowBreak] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  const handleResume = async () => {
    setLoading('resume');
    try {
      await workdayApi.resumeWork();
      toast.success('Resumed!');
      onRefetch();
      onClose();
    } catch { toast.error('Failed'); }
    finally { setLoading(null); }
  };

  const handleEnd = async () => {
    setLoading('end');
    try {
      await workdayApi.endWork();
      toast.success('Workday ended.');
      onRefetch();
      onClose();
    } catch { toast.error('Failed'); }
    finally { setLoading(null); }
  };

  if (showBreak) {
    return <BreakModal onClose={() => setShowBreak(false)} onBreakStarted={() => { setShowBreak(false); onRefetch(); onClose(); }} />;
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm shadow-xl">
        <div className="text-center mb-4">
          <span className="text-3xl">&#128564;</span>
          <h3 className="font-semibold text-gray-800 dark:text-gray-100 mt-2">You&apos;ve been inactive for a while</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">What would you like to do?</p>
        </div>
        <div className="flex flex-col gap-2">
          <button onClick={handleResume} disabled={loading === 'resume'} className="w-full py-2.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg text-sm disabled:opacity-50">
            {loading === 'resume' ? 'Resuming...' : 'Resume Work'}
          </button>
          <button onClick={() => setShowBreak(true)} className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg text-sm">
            Take a Break
          </button>
          <button onClick={handleEnd} disabled={loading === 'end'} className="w-full py-2.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-lg text-sm disabled:opacity-50">
            {loading === 'end' ? 'Ending...' : 'End Workday'}
          </button>
        </div>
      </div>
    </div>
  );
}
