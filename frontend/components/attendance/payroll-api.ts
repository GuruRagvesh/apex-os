import { api, unwrap as r } from '@apex/shared-auth';

/**
 * Monthly attendance for payroll. HR and admin only, enforced server-side.
 *
 * There is no "send on month end" call here, because there is no such endpoint.
 * Finalising and sending are two deliberate human actions.
 */

export type MonthCloseStatus = 'OPEN' | 'REVIEWING' | 'FINALIZED' | 'SENT';

export interface PayrollSummaryRow {
  employeeId: string;
  name: string;
  department: string;
  workingDays: number;
  present: number;
  absent: number;
  casualLeave: number;
  emergencyLeave: number;
  compOff: number;
  halfDays: number;
  holidays: number;
  weeklyOffs: number;
  lateDays: number;
  needsReview: number;
  manualRecoveryDays: number;
  regularizedDays: number;
  unresolvedDays: number;
}

export interface PayrollPreview {
  month: string;
  status: MonthCloseStatus;
  totals: {
    employees: number;
    unresolvedDays: number;
    manualRecoveryDays: number;
    employeesWithUnresolved: number;
  };
  summaries: PayrollSummaryRow[];
  reportSha256: string;
  reportByteSize: number;
}

export interface MonthClose {
  month: string;
  status: MonthCloseStatus;
  employeeCount: number | null;
  unresolvedDays: number | null;
  employeesWithUnresolved: number | null;
  finalizedAt: string | null;
  finalizedBy: { name: string } | null;
  recipientEmail: string | null;
  sentAt: string | null;
  deliveryStatus: string | null;
  reportSha256: string | null;
  reportByteSize: number | null;
}

export async function getPayrollPreview(month: string): Promise<PayrollPreview> {
  return r(api.get('/attendance/payroll/preview', { params: { month } }));
}

export async function getMonthClose(month: string): Promise<MonthClose | null> {
  return r(api.get(`/attendance/payroll/status/${month}`));
}

export async function finalizeMonth(month: string): Promise<MonthClose> {
  return r(api.post('/attendance/payroll/finalize', { month }));
}

export async function sendToFinance(month: string): Promise<MonthClose> {
  return r(api.post('/attendance/payroll/send', { month }));
}

export async function getFinanceRecipient(): Promise<{ recipient: string | null }> {
  return r(api.get('/attendance/payroll/recipient'));
}

export async function setFinanceRecipient(email: string) {
  return r(api.post('/attendance/payroll/recipient', { email }));
}

/**
 * Downloads the workbook through the AUTHENTICATED client.
 *
 * Not a plain <a href>. Auth is a Bearer token injected by an axios request
 * interceptor, and a browser-initiated navigation carries no such header — the
 * link would simply 401. So the bytes are fetched with the token attached and
 * handed to the browser as an object URL.
 *
 * The object URL is revoked immediately: it holds the whole workbook in memory
 * until it is, and this page may be left open all day.
 */
export async function downloadPayrollWorkbook(month: string): Promise<void> {
  const blob = await r<Blob>(
    api.get('/attendance/payroll/download', {
      params: { month },
      responseType: 'blob',
    }),
  );

  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = `apex-os-attendance-${month}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const STATUS_LABEL: Record<MonthCloseStatus, string> = {
  OPEN: 'Not started',
  REVIEWING: 'Under review',
  FINALIZED: 'Finalized — not yet sent',
  SENT: 'Sent to Finance',
};

/** The current month is rarely the one being closed. */
export function previousMonth(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
