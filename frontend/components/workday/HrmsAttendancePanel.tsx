'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { hrmsAttendanceApi } from '@/lib/api';
import toast from 'react-hot-toast';

function clientCaptureFields() {
  return {
    clientTimestamp: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    deviceMetadata: { userAgent: navigator.userAgent },
  };
}

// Only asks the browser for a location at the moment of an explicit punch
// action — never a continuous watch, never requested on page load.
function getLocationOnce(): Promise<{ latitude: number; longitude: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { timeout: 10000 },
    );
  });
}

function fmtMs(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '0h 0m';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

export function HrmsAttendancePanel() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['hrms-attendance-today'],
    queryFn: () => hrmsAttendanceApi.getToday() as Promise<any>,
    staleTime: 30000,
  });

  const refetchAll = () => {
    queryClient.invalidateQueries({ queryKey: ['hrms-attendance-today'] });
    // Keep the existing WorkdayBar / history strip / QuickActionDock in
    // sync — they all read the same underlying WorkSession this panel
    // ultimately mutates via the existing workday service methods.
    queryClient.invalidateQueries({ queryKey: ['workday-today'] });
    queryClient.invalidateQueries({ queryKey: ['workday-history'] });
  };

  if (isLoading || !data) return null;

  // Feature is off — show a quiet, informational state, never block the
  // existing workday controls (QuickActionDock / WorkdayBar) elsewhere on
  // the page, which remain fully functional regardless of this flag.
  if (!data.captureEnabled) {
    return (
      <div className="apex-card" style={{ padding: '12px 16px', marginTop: 8 }}>
        <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          HRMS attendance capture is not yet enabled for this workspace. Use the existing workday controls to start,
          break, or end your day.
        </p>
      </div>
    );
  }

  const handlePunchIn = async () => {
    setBusy('punch-in');
    try {
      const capture: any = clientCaptureFields();

      if (data.requiredCapture.locationRequired) {
        const loc = await getLocationOnce();
        if (!loc) {
          toast.error('Location is required to punch in. Please allow location access and try again.');
          setBusy(null);
          return;
        }
        capture.latitude = loc.latitude;
        capture.longitude = loc.longitude;
        capture.accuracy = loc.accuracy;
      }

      if (data.requiredCapture.faceRequired) {
        // Phase 1 does not implement face capture UI — block with a clear
        // message rather than silently punching in without it.
        toast.error('Face verification is required to punch in, but face capture is not available yet. Contact your admin.');
        setBusy(null);
        return;
      }

      const res: any = await hrmsAttendanceApi.punchIn(capture);
      if (res.status === 'disabled') {
        toast.error(res.message ?? 'Attendance capture is disabled.');
      } else {
        toast.success('Punched in');
        refetchAll();
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Failed to punch in');
    } finally {
      setBusy(null);
    }
  };

  const handleBreakStart = async () => {
    setBusy('break-start');
    try {
      await hrmsAttendanceApi.breakStart({ breakType: 'GENERAL', deviceMetadata: clientCaptureFields().deviceMetadata });
      toast.success('Break started');
      refetchAll();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Failed to start break');
    } finally {
      setBusy(null);
    }
  };

  const handleBreakEnd = async () => {
    setBusy('break-end');
    try {
      await hrmsAttendanceApi.breakEnd();
      toast.success('Break ended');
      refetchAll();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Failed to end break');
    } finally {
      setBusy(null);
    }
  };

  const handlePunchOut = async () => {
    setBusy('punch-out');
    try {
      const capture = clientCaptureFields();
      await hrmsAttendanceApi.punchOut(capture);
      toast.success('Punched out');
      refetchAll();
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Failed to punch out');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="apex-card" style={{ padding: '14px 16px', marginTop: 8 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
          HRMS Attendance — {data.companyDate}
        </span>
        <span className="text-[10px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
          {data.status}{data.totalWorkedMs != null ? ` · ${fmtMs(data.totalWorkedMs)}` : ''}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {!data.isPunchedIn && (
          <button
            onClick={handlePunchIn}
            disabled={busy !== null}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ background: '#10b981', color: '#fff', opacity: busy ? 0.6 : 1 }}
          >
            {busy === 'punch-in' ? 'Punching in…' : 'Punch In'}
          </button>
        )}

        {data.isPunchedIn && !data.isOnBreak && (
          <>
            <button
              onClick={handleBreakStart}
              disabled={busy !== null}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', opacity: busy ? 0.6 : 1 }}
            >
              {busy === 'break-start' ? 'Starting break…' : 'Break Start'}
            </button>
            <button
              onClick={handlePunchOut}
              disabled={busy !== null}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: '#ef4444', color: '#fff', opacity: busy ? 0.6 : 1 }}
            >
              {busy === 'punch-out' ? 'Punching out…' : 'Punch Out'}
            </button>
          </>
        )}

        {data.isOnBreak && (
          <button
            onClick={handleBreakEnd}
            disabled={busy !== null}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ background: '#6366f1', color: '#fff', opacity: busy ? 0.6 : 1 }}
          >
            {busy === 'break-end' ? 'Ending break…' : 'Break End'}
          </button>
        )}
      </div>

      {(data.requiredCapture.faceRequired || data.requiredCapture.locationRequired) && !data.isPunchedIn && (
        <p className="text-[10px] mt-2" style={{ color: 'var(--text-tertiary)' }}>
          {data.requiredCapture.locationRequired && 'Location will be requested when you punch in. '}
          {data.requiredCapture.faceRequired && 'Face verification is required and not yet available.'}
        </p>
      )}
    </div>
  );
}
