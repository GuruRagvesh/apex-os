'use client';
// The employee's own resignation page: only their own records.
import { useAuthStore } from '@apex/core-identity';
import { MyResignation } from '@/components/transitions/ExitPanel';

export default function MyResignationPage() {
  const { user } = useAuthStore();
  if (!user) return null;
  return <MyResignation me={{ id: user.id }} />;
}
