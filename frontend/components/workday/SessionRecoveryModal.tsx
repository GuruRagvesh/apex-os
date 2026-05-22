'use client';

import { useState } from 'react';
import { workdayApi } from '@/lib/api';
import toast from 'react-hot-toast';

const AWAY_REASONS = [
  { value: 'TEA', label: 'On a break (tea/lunch/personal)' },
  { value: 'MEETING', label: 'In a meeting' },
  { value: 'PERSONAL', label: 'Away from desk' },
  { value: 'POWER_CUT', label: 'Power/connection issue' },
  { value: 'WORKING', label: 'Still working (reading/thinking/reviewing)' },
];

interface Props {
  awayMinutes: number;
  onClose: () => void;
  onRefetch: () => void;
}

export function SessionRecoveryModal({ awayMinutes, onClose, onRefetch }: Props) {
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState(awayMinutes);
  const [loading, setLoading] = useState(false);

  const h = Math.floor(awayMinutes / 60);
  const m = awayMinutes % 60;
  const awayStr = h > 0 ? `${h}h ${m}m` : `${m} minutes`;

  const handleSave = async () => {
    setLoading(true);
    try {
      if (reason && reason !== 'WORKING') {
        await workdayApi.startBreak({ breakType: reason, estimatedMinutes: duration });
        await workdayApi.endBreak();
      }
      await workdayApi.resumeWork();
      toast.success('Welcome back!');
      onRefetch();
      onClose();
    } catch { toast.error('Failed to recover session'); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm shadow-xl">
        <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-1">Welcome back!</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          You were away for <strong>{awayStr}</strong>. What were you doing?
        </p>

        <div className="space-y-2 mb-4">
          {AWAY_REASONS.map((r) => (
            <button
              key={r.value}
              onClick={() => setReason(r.value)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm border transition-colors ${
                reason === r.value
                  ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-400 text-indigo-700 dark:text-indigo-300'
                  : 'border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-indigo-300'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="mb-4">
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
            Duration: {duration} min
          </label>
          <input
            type="range"
            min={5}
            max={Math.max(awayMinutes + 30, 120)}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full accent-indigo-600"
          />
          <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
            <span>5m</span><span>{Math.max(awayMinutes + 30, 120)}m</span>
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={loading || !reason}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg text-sm disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Save & Resume Work'}
        </button>
      </div>
    </div>
  );
}
