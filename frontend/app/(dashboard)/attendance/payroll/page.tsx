'use client';
// Payroll close for HR and Admin, including unresolved leave setup. The
// server enforces HR/Admin; non-HR callers just see the server's refusal.
import { useAuthStore } from '@apex/core-identity';
import { PayrollMonthClose } from '@/components/attendance/PayrollMonthClose';

export default function PayrollPage() {
  const { user } = useAuthStore();
  const role = (user?.role as any)?.name ?? user?.role ?? '';
  if (!user) return null;
  if (!(user as any).isHR && role !== 'ADMIN' && role !== 'SUPER_ADMIN') return <p role="alert" className="p-4">You do not have access to payroll.</p>;
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-4">
      <h1 className="text-xl font-semibold">Payroll</h1>
      <PayrollMonthClose />
    </div>
  );
}
