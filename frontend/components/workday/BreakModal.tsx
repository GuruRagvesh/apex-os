'use client';

import { useState } from 'react';
import { workdayApi } from '@/lib/api';
import toast from 'react-hot-toast';

const BREAK_TYPES = [
  { type: 'TEA', label: 'Tea Break' },
  { type: 'LUNCH', label: 'Lunch Break' },
  { type: 'RESTROOM', label: 'Restroom' },
  { type: 'PERSONAL', label: 'Personal' },
  { type: 'POWER_CUT', label: 'Connection Issue' },
  { type: 'MEETING', label: 'Meeting' },
  { type: 'OTHER', label: 'Other' },
];

const DURATIONS = [
  { label: '10 min', value: 10 },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '1 hour', value: 60 },
];

interface Props {
  onClose: () => void;
  onBreakStarted: () => void;
}

export function BreakModal({ onClose, onBreakStarted }: Props) {
  const [breakType, setBreakType] = useState('');
  const [duration, setDuration] = useState<number | null>(null);
  const [customDuration, setCustomDuration] = useState('');
  const [showCustomDuration, setShowCustomDuration] = useState(false);
  const [loading, setLoading] = useState(false);

  const effectiveDuration = showCustomDuration
    ? (customDuration ? parseInt(customDuration) : null)
    : duration;

  const handleStart = async () => {
    if (!breakType) { toast.error('Select a break type'); return; }
    setLoading(true);
    try {
      await workdayApi.startBreak({ breakType, estimatedMinutes: effectiveDuration ?? undefined });
      toast.success('Break started');
      onBreakStarted();
    } catch { toast.error('Failed to start break'); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[9999] flex items-center justify-center p-4">
      <div className="apex-modal-animated bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-sm shadow-xl">
        <h3 className="font-semibold text-gray-800 dark:text-gray-100 mb-4">Take a Break</h3>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {BREAK_TYPES.map((bt) => (
            <button
              key={bt.type}
              onClick={() => setBreakType(bt.type)}
              className={`px-3 py-2 rounded-lg text-sm text-left transition-colors border ${
                breakType === bt.type
                  ? 'bg-indigo-100 dark:bg-indigo-900/40 border-indigo-400 text-indigo-700 dark:text-indigo-300'
                  : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-indigo-300'
              }`}
            >
              {bt.label}
            </button>
          ))}
        </div>

        {breakType && (
          <div className="mb-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Estimated duration (optional)</p>
            <div className="flex gap-2 flex-wrap">
              {DURATIONS.map((d) => (
                <button
                  key={d.value}
                  onClick={() => { setDuration(duration === d.value ? null : d.value); setShowCustomDuration(false); }}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                    !showCustomDuration && duration === d.value
                      ? 'bg-indigo-100 dark:bg-indigo-900/40 border-indigo-400 text-indigo-700 dark:text-indigo-300'
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-indigo-300'
                  }`}
                >
                  {d.label}
                </button>
              ))}
              <button
                onClick={() => { setShowCustomDuration(!showCustomDuration); setDuration(null); }}
                className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${
                  showCustomDuration
                    ? 'bg-indigo-100 dark:bg-indigo-900/40 border-indigo-400 text-indigo-700 dark:text-indigo-300'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-indigo-300'
                }`}
              >
                Custom
              </button>
            </div>
            {showCustomDuration && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="480"
                  value={customDuration}
                  onChange={(e) => setCustomDuration(e.target.value)}
                  placeholder="Minutes..."
                  autoFocus
                  className="w-28 px-2 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
                <span className="text-xs text-gray-400">min</span>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
          <button
            onClick={handleStart}
            disabled={loading || !breakType}
            className="px-4 py-2 text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white rounded-lg disabled:opacity-50"
          >
            {loading ? 'Starting...' : 'Start Break'}
          </button>
        </div>
      </div>
    </div>
  );
}
