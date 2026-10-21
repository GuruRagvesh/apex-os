export type LeaveErrorKind =
  | 'authentication'
  | 'permission'
  | 'not-found'
  | 'server'
  | 'unavailable'
  | 'invalid';

export interface LeaveErrorView {
  kind: LeaveErrorKind;
  title: string;
  message: string;
  canRetry: boolean;
}

function statusOf(error: any): number | null {
  const raw = error?.status ?? error?.response?.status;
  const status = Number(raw);
  return Number.isFinite(status) && status > 0 ? status : null;
}

/** Employee-safe presentation for transport failures. Never exposes raw payloads. */
export function presentLeaveError(error: any, subject = 'leave requests'): LeaveErrorView {
  const status = statusOf(error);

  if (status === 401) {
    return {
      kind: 'authentication',
      title: 'Your session has expired',
      message: 'Sign in again to continue.',
      canRetry: false,
    };
  }
  if (status === 403) {
    return {
      kind: 'permission',
      title: 'Access is restricted',
      message: `You do not have permission to view these ${subject}.`,
      canRetry: false,
    };
  }
  if (status === 404) {
    return {
      kind: 'not-found',
      title: 'Leave service is unavailable',
      message: `The ${subject} endpoint could not be found. Please contact support if this continues.`,
      canRetry: true,
    };
  }
  if (status != null && status >= 500) {
    return {
      kind: 'server',
      title: `Unable to load ${subject}`,
      message: 'The service returned an error. Your existing leave records were not changed.',
      canRetry: true,
    };
  }
  if (status != null && status >= 400) {
    return {
      kind: 'invalid',
      title: `Unable to load ${subject}`,
      message: 'The request could not be completed with the current filters.',
      canRetry: true,
    };
  }
  return {
    kind: 'unavailable',
    title: `Unable to load ${subject}`,
    message: 'Check your connection and try again. No missing value has been treated as zero.',
    canRetry: true,
  };
}

export function knownNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

export function metricText(value: unknown): string {
  const number = knownNumber(value);
  return number == null ? '—' : String(number);
}
