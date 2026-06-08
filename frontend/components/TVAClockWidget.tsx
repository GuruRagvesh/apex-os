'use client';

import React, { useEffect, useState, useRef } from 'react';
import { fetchTVAClock, TVAClockState } from '../lib/tva-clock';

export default function TVAClockWidget() {
  const [tvaState, setTvaState] = useState<TVAClockState | null>(null);
  const [localVisualTimeMs, setLocalVisualTimeMs] = useState<number>(0);
  const [syncStatus, setSyncStatus] = useState<'SYNCING' | 'SYNCED' | 'ERROR'>('SYNCING');
  const [driftWarning, setDriftWarning] = useState<boolean>(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const resync = async () => {
    setSyncStatus('SYNCING');
    const state = await fetchTVAClock();
    if (state) {
      setTvaState(state);
      setLocalVisualTimeMs(state.unixMs);
      setSyncStatus('SYNCED');
    } else {
      setSyncStatus('ERROR');
    }
  };

  useEffect(() => {
    resync();

    syncIntervalRef.current = setInterval(() => {
      resync();
    }, 45000); // 45 seconds

    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (syncStatus === 'SYNCED') {
      timerRef.current = setInterval(() => {
        setLocalVisualTimeMs((prev) => prev + 1000);
      }, 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [syncStatus]);

  useEffect(() => {
    if (tvaState && syncStatus === 'SYNCED') {
      const systemNow = Date.now();
      const diff = Math.abs(systemNow - localVisualTimeMs);
      // Drift warning if visual time differs from browser time by > 5s
      // Wait, the prompt says "if browser visual time differs from backend by more than 5 seconds"
      // Actually, if the browser's system clock is off from TVA by > 5s.
      if (diff > 5000) {
        setDriftWarning(true);
      } else {
        setDriftWarning(false);
      }
    }
  }, [localVisualTimeMs, tvaState, syncStatus]);

  if (!tvaState) {
    return (
      <div className="bg-gray-800 text-white p-4 rounded shadow-md text-sm">
        <div className="animate-pulse">Loading TVA Clock...</div>
      </div>
    );
  }

  // Format local visual time into HH:mm:ss
  // Since we only tick locally, we should just parse it back based on the company timezone.
  // But we can't reliably format the local visual time in the remote timezone without a timezone library.
  // We can just rely on the fact that TVA sends companyTime (HH:mm:ss) and we parse it and tick it.
  // A simpler way: parse tvaState.companyTime into seconds, add elapsed seconds.
  
  const visualDate = new Date(localVisualTimeMs);

  // We can format it using Intl.DateTimeFormat in the given timezone
  const formattedTime = new Intl.DateTimeFormat('en-US', {
    timeZone: tvaState.timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(visualDate);

  const formattedDate = new Intl.DateTimeFormat('en-US', {
    timeZone: tvaState.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(visualDate).split('/').reverse().join('-'); // rough approx

  return (
    <div className="bg-gray-900 text-green-400 p-4 rounded shadow-lg border border-gray-700 text-sm font-mono flex flex-col space-y-2">
      <div className="flex justify-between items-center border-b border-gray-700 pb-2">
        <h3 className="font-bold text-gray-300">TIME VIGILANCE AUTHORITY</h3>
        <span className={`px-2 py-0.5 rounded text-xs ${syncStatus === 'SYNCED' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
          {syncStatus}
        </span>
      </div>
      
      <div className="grid grid-cols-2 gap-2 mt-2">
        <div>
          <span className="text-gray-500 text-xs block">COMPANY DATE</span>
          <span className="text-lg">{tvaState.companyDate}</span>
        </div>
        <div>
          <span className="text-gray-500 text-xs block">LOCAL VISUAL TIME</span>
          <span className="text-xl font-bold">{formattedTime}</span>
        </div>
        <div>
          <span className="text-gray-500 text-xs block">TIMEZONE</span>
          <span>{tvaState.timezone}</span>
        </div>
        <div>
          <span className="text-gray-500 text-xs block">SOURCE</span>
          <span className="text-blue-400">SERVER_TVA</span>
        </div>
      </div>

      {driftWarning && (
        <div className="bg-yellow-900 text-yellow-300 p-2 mt-2 rounded text-xs">
          ⚠️ Warning: Local system clock differs from TVA time by &gt;5s. Official calculations rely on TVA.
        </div>
      )}
      
      <div className="text-[10px] text-gray-600 mt-2 text-center">
        Never use this widget for official business calculations.
      </div>
    </div>
  );
}
