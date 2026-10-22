'use client';
// Company transfer review (Admin / HR). The server enforces who may act.
import { useAuthStore } from '@apex/core-identity';
import { TransferReviewList } from '@/components/transitions/TransferHistory';

export default function TransferReviewPage() {
  const { user } = useAuthStore();
  const role = (user?.role as any)?.name ?? user?.role ?? '';
  if (!user) return null;
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  if (!isAdmin && !(user as any).isHR) return <p role="alert" className="p-4">You do not have access to this page.</p>;
  return <TransferReviewList isAdmin={isAdmin} />;
}
