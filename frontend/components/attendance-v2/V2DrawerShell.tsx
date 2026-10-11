'use client';
import { AttendanceDrawer } from '../attendance/AttendanceDrawer';

/** Shared attendance shell and photo portal behavior; styling is scoped by drawerBody. */
export function V2DrawerShell({ open, title, onClose, children }: {
  open: boolean; title: string; onClose: () => void; children: React.ReactNode;
}) {
  return <AttendanceDrawer open={open} title={title} subtitle="Attendance details" onClose={onClose}>{children}</AttendanceDrawer>;
}
