'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Shows a non-blocking banner when the backend hasn't responded within 3 seconds.
 * Useful for free-tier hosting (Render, Railway) that spins down after inactivity.
 * Automatically hides once the first successful response arrives.
 */
export function ColdStartBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;

    // Show banner after 3 s of no response
    timer = setTimeout(() => {
      if (mounted) setShow(true);
    }, 3000);

    // Ping the health endpoint (or any fast endpoint)
    api.get('/auth/me')
      .then(() => { clearTimeout(timer); if (mounted) setShow(false); })
      .catch(() => { clearTimeout(timer); if (mounted) setShow(false); });

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, []);

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-800 text-white text-sm px-5 py-3 rounded-full shadow-xl animate-in fade-in slide-in-from-bottom-4 duration-300">
      <span className="flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:0ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:300ms]" />
      </span>
      <span>Apex OS is waking up — this takes a few seconds on first load</span>
    </div>
  );
}
