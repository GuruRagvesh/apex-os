import { api, unwrap as r } from '@apex/shared-auth';
import type { PunchType } from './punch-api';

/**
 * Phone handoff transport.
 *
 * The raw token is never a path segment or a query parameter: it travels to the
 * phone in the URL fragment, which browsers do not send to servers, and reaches
 * the API in a request body. That keeps it out of access logs, proxy logs and
 * Referer headers.
 *
 * Every call is authenticated. The token says which punch; the session says
 * who — a QR that worked without a session would be a credential anyone could
 * photograph from across a desk.
 */

export interface CreatedHandoff {
  handoffId: string;
  token: string;
  intent: PunchType;
  expiresAt: string;
}

export interface HandoffView {
  handoffId: string;
  intent: PunchType;
  status: string;
  expiresAt: string;
  employeeName: string | null;
}

export type HandoffStatus = 'WAITING' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED';

export async function createHandoff(intent: PunchType): Promise<CreatedHandoff> {
  return r(api.post('/attendance/punch-handoff', { intent }));
}

export async function viewHandoff(handoffId: string, token: string): Promise<HandoffView> {
  return r(api.post(`/attendance/punch-handoff/${handoffId}/view`, { token }));
}

export async function getHandoffStatus(
  handoffId: string,
): Promise<{ id: string; status: HandoffStatus; completedAt: string | null }> {
  return r(api.get(`/attendance/punch-handoff/${handoffId}/status`));
}

export async function cancelHandoff(handoffId: string): Promise<void> {
  await r(api.delete(`/attendance/punch-handoff/${handoffId}`));
}

/**
 * The URL encoded into the QR.
 *
 * Secret in the FRAGMENT, id in the path. No employee id, name, email or punch
 * time is encoded — someone photographing the QR learns nothing about who it
 * belongs to, and the token alone still cannot complete a punch.
 */
export function mobilePunchUrl(origin: string, handoffId: string, token: string): string {
  return `${origin}/attendance/mobile-punch/${handoffId}#token=${encodeURIComponent(token)}`;
}

/** Where the phone stashes the secret across a login redirect. */
export const handoffSecretKey = (handoffId: string) => `apex.punch.handoff.${handoffId}`;

export function rememberHandoffSecret(handoffId: string, token: string): void {
  try {
    sessionStorage.setItem(handoffSecretKey(handoffId), token);
  } catch {
    // Private mode or blocked storage. The punch can still complete in one go;
    // only surviving a login redirect is lost.
  }
}

export function recallHandoffSecret(handoffId: string): string | null {
  try {
    return sessionStorage.getItem(handoffSecretKey(handoffId));
  } catch {
    return null;
  }
}

/** Cleared on completion, cancellation, expiry and refusal — never left behind. */
export function forgetHandoffSecret(handoffId: string): void {
  try {
    sessionStorage.removeItem(handoffSecretKey(handoffId));
  } catch {
    /* nothing to clear */
  }
}

/**
 * Reads and immediately strips the secret from the address bar.
 *
 * The fragment is not sent to servers, but it does persist in history and in
 * anything the user might screenshot or share, so it does not linger.
 */
export function takeTokenFromFragment(): string | null {
  if (typeof window === 'undefined') return null;

  const raw = window.location.hash ?? '';
  const match = /(?:^#|&)token=([^&]+)/.exec(raw);
  if (!match) return null;

  const token = decodeURIComponent(match[1]);
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    /* address bar unchanged; the token is already in hand */
  }
  return token;
}
