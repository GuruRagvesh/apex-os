// Operations Tickets — the existing schedule / recurrence choice on New Ticket.
//
// Restores the control the bulk-create rewrite dropped, with exactly the values
// the backend scheduler (SchedulerService.checkScheduledTickets) and the ticket
// page (RECURRENCE_LABELS) already understand. No new recurrence values.

import { companyDateTimeLocalToIso } from './ticket-planning-date';

export const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'No reminder schedule' },
  { value: 'custom_time', label: 'One-time reminder at a date & time…' },
  { value: 'daily_morning', label: 'Every day — Morning (9:00 AM)' },
  { value: 'daily_evening', label: 'Every day — Evening (6:00 PM)' },
  { value: 'weekly', label: 'Every week (same day)' },
  { value: 'monthly', label: 'Every month (same date)' },
  { value: '1_month', label: 'For 1 month daily' },
  { value: '6_months', label: 'For 6 months daily' },
] as const;

export type RecurrenceMode = typeof RECURRENCE_OPTIONS[number]['value'];

export const RECURRENCE_END_PRESETS = [
  { value: '1_week', label: '1 week from now', days: 7 },
  { value: '1_month', label: '1 month from now', days: 30 },
  { value: '3_months', label: '3 months from now', days: 90 },
  { value: '6_months', label: '6 months from now', days: 180 },
  { value: 'custom', label: 'Custom date', days: 0 },
] as const;

export type RecurrenceEndPreset = typeof RECURRENCE_END_PRESETS[number]['value'];

export interface RecurrenceChoice {
  mode: RecurrenceMode | string;
  /** datetime-local value, company wall clock; used by 'custom_time'. */
  oneTimeAt: string;
  endPreset: RecurrenceEndPreset | string;
  /** 'yyyy-MM-dd'; used when endPreset is 'custom'. */
  endDate: string;
}

export const NO_RECURRENCE: RecurrenceChoice = { mode: 'none', oneTimeAt: '', endPreset: '1_month', endDate: '' };

const RECURRING = new Set<string>(['daily_morning', 'daily_evening', 'weekly', 'monthly', '1_month', '6_months']);

/**
 * The ticket fields for a recurrence choice, as the backend stores them:
 * scheduleRecurring + scheduleEndDate for a recurring reminder, scheduledFor
 * for a one-time reminder, nothing for 'none' or an unknown value.
 */
export function recurrencePayload(choice: RecurrenceChoice, now: Date = new Date()): {
  scheduleRecurring?: string;
  scheduledFor?: string;
  scheduleEndDate?: string;
} {
  if (choice.mode === 'custom_time') {
    const at = companyDateTimeLocalToIso(choice.oneTimeAt);
    return at ? { scheduledFor: at } : {};
  }
  if (!RECURRING.has(choice.mode)) return {};
  let scheduleEndDate: string | undefined;
  if (choice.endPreset === 'custom') {
    // Date only: the backend reads it with the system's date-only convention.
    scheduleEndDate = /^\d{4}-\d{2}-\d{2}$/.test(choice.endDate) ? choice.endDate : undefined;
  } else {
    const preset = RECURRENCE_END_PRESETS.find((p) => p.value === choice.endPreset) ?? RECURRENCE_END_PRESETS[1];
    scheduleEndDate = new Date(now.getTime() + preset.days * 86_400_000).toISOString();
  }
  return { scheduleRecurring: choice.mode, ...(scheduleEndDate ? { scheduleEndDate } : {}) };
}
