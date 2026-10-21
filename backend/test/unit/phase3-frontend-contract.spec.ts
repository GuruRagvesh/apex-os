import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Phase 3 connected frontend contract', () => {
  it('captures only an opaque local device id, type and capture channel', () => {
    const device = source('frontend/components/attendance/device-evidence.ts');
    // Environment-scoped Apex OS key, validated before it is ever sent.
    expect(device).toContain('apex-os:${ENVIRONMENT}:attendance-device-id:v1');
    expect(device).toContain('UUID.test(existing)');
    expect(device).toContain('globalThis.crypto?.randomUUID');
    expect(device).toContain("deviceTypeHint: 'MOBILE' | 'TABLET' | 'LAPTOP_DESKTOP' | null");
    expect(device).not.toMatch(/canvas|audioContext|hardwareConcurrency|deviceMemory/i);
    const punch = source('frontend/components/attendance/PunchModal.tsx');
    expect(punch).toContain('currentDeviceEvidence');
  });

  it('shows the device review state without blocking an unavailable id', () => {
    const drawer = source('frontend/components/attendance-v2/DayDetailDrawer.tsx');
    expect(drawer).toContain("item.deviceType === 'UNKNOWN'");
    expect(drawer).toContain('kept for HR review');
    const queue = source('frontend/components/attendance/PunchReviewQueue.tsx');
    expect(queue).toContain('Dismiss with note');
    expect(queue).toContain('Mark reviewed');
  });

  it('renders team/company correction queues and explicit creator confirmation', () => {
    const page = source('frontend/app/(dashboard)/attendance/reviews/page.tsx');
    expect(page).toContain('My team');
    expect(page).toContain('Company pending');
    expect(page).not.toContain('HR final review');
    const queue = source('frontend/components/attendance/RegularizationQueue.tsx');
    expect(queue).toContain('confirmCreatorDecision');
    expect(queue).toContain('I entered this manual recovery');
    expect(queue).toContain('reviewedFingerprint');
  });

  it('personal balances show Casual and Sick only, never an Emergency pool', () => {
    const api = source('frontend/components/attendance/leave-balance-api.ts');
    expect(api).toContain("PERSONAL_LEAVE_TYPES = ['CASUAL', 'SICK']");
    for (const file of ['frontend/components/attendance/LeaveBalanceCard.tsx', 'frontend/components/attendance-v2/AttendanceAccountOverview.tsx', 'frontend/components/attendance-v2/home/HomeCalendarPanel.tsx']) {
      const text = source(file);
      expect(text).not.toContain("getMyLeaveBalance('EMERGENCY'");
      expect(text).not.toContain('type="EMERGENCY"');
      expect(text).not.toContain("label: 'Emergency Leave'");
    }
  });

  it('offers emergency submission as a mode funded only from Casual or Sick', () => {
    const leave = source('platforms/workforce/leave/applications/frontend/screens/LeaveScreen.tsx');
    expect(leave).toContain('Emergency submission');
    expect(leave).toContain("fundingBucket");
    expect(leave).toContain("value=\"CASUAL\"");
    expect(leave).toContain("value=\"SICK\"");
    expect(leave).not.toContain("value=\"EMERGENCY\"");
  });
});
