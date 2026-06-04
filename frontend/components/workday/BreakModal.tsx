'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { workdayApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Coffee } from 'lucide-react';

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
  const queryClient = useQueryClient();
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
    } catch (err: any) { 
      toast.error(err?.message || 'Failed to start break'); 
      queryClient.invalidateQueries({ queryKey: ['workday-today'] });
    }
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
            style={{ backgroundColor: '#FF6A13' }}
          />
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: 'rgba(255,106,19,0.15)', color: '#FF6A13' }}>
            <Coffee size={16} />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-white">Start a Break</h2>
            <p className="text-xs text-slate-400 mt-0.5">Choose break type and duration</p>
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

        {/* White body */}
        <div className="bg-white px-6 py-5">
          {/* Break type grid */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            {BREAK_TYPES.map((bt) => (
              <button
                key={bt.type}
                onClick={() => setBreakType(bt.type)}
                className="px-3 py-2.5 rounded-xl text-sm text-left transition-all border font-medium"
                style={breakType === bt.type ? {
                  backgroundColor: 'rgba(255,106,19,0.08)',
                  borderColor: '#FF6A13',
                  color: '#EA580C',
                } : {
                  backgroundColor: '#F8FAFC',
                  borderColor: '#E2E8F0',
                  color: '#475569',
                }}
              >
                {bt.label}
              </button>
            ))}
          </div>

          {/* Duration chips */}
          {breakType && (
            <div className="mb-2">
              <p className="text-xs text-slate-400 mb-2 font-mono uppercase tracking-wider">Estimated duration (optional)</p>
              <div className="flex gap-2 flex-wrap">
                {DURATIONS.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => { setDuration(duration === d.value ? null : d.value); setShowCustomDuration(false); }}
                    className="px-3 py-1.5 rounded-lg text-xs border transition-all font-semibold"
                    style={!showCustomDuration && duration === d.value ? {
                      backgroundColor: 'rgba(255,106,19,0.08)',
                      borderColor: '#FF6A13',
                      color: '#EA580C',
                    } : {
                      backgroundColor: '#F8FAFC',
                      borderColor: '#E2E8F0',
                      color: '#64748B',
                    }}
                  >
                    {d.label}
                  </button>
                ))}
                <button
                  onClick={() => { setShowCustomDuration(!showCustomDuration); setDuration(null); }}
                  className="px-3 py-1.5 rounded-lg text-xs border transition-all font-semibold"
                  style={showCustomDuration ? {
                    backgroundColor: 'rgba(255,106,19,0.08)',
                    borderColor: '#FF6A13',
                    color: '#EA580C',
                  } : {
                    backgroundColor: '#F8FAFC',
                    borderColor: '#E2E8F0',
                    color: '#64748B',
                  }}
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
                    className="w-28 px-3 py-2 text-sm border border-slate-200 rounded-xl bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-400/30 focus:border-orange-400"
                  />
                  <span className="text-xs text-slate-400">min</span>
                </div>
              )}
            </div>
          )}
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
            onClick={handleStart}
            disabled={loading || !breakType}
            className="px-5 py-2 text-sm font-semibold text-white rounded-xl transition-colors disabled:opacity-50"
            style={{ backgroundColor: '#FF6A13' }}
            onMouseEnter={(e) => { if (!loading && breakType) (e.currentTarget.style.backgroundColor = '#EA580C'); }}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#FF6A13')}
          >
            {loading ? 'Starting...' : 'Start Break'}
          </button>
        </div>
      </div>
    </div>
  );
}
