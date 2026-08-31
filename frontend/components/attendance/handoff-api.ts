import { api, unwrap as r } from '@apex/shared-auth';
import { forgetToken, recallToken, rememberToken, takeToken } from './handoff-token';
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

/**
 * Token handling lives in handoff-token.ts, which imports nothing, so the
 * backend Jest suite can exercise it. These wrappers bind it to the real
 * browser objects.
 */
export { handoffSecretKey } from './handoff-token';

const browserEnv = () => ({
  hash: window.location.hash ?? '',
  pathname: window.location.pathname,
  search: window.location.search,
  storage: typeof sessionStorage === 'undefined' ? null : sessionStorage,
  replaceUrl: (url: string) => window.history.replaceState(null, '', url),
});

export function rememberHandoffSecret(handoffId: string, token: string): void {
  rememberToken(handoffId, token, typeof sessionStorage === 'undefined' ? null : sessionStorage);
}

export function recallHandoffSecret(handoffId: string): string | null {
  if (typeof window === 'undefined') return null;
  return recallToken(handoffId, typeof sessionStorage === 'undefined' ? null : sessionStorage);
}

export function forgetHandoffSecret(handoffId: string): void {
  if (typeof window === 'undefined') return;
  forgetToken(handoffId, typeof sessionStorage === 'undefined' ? null : sessionStorage);
}

/**
 * Reads and immediately strips the secret from the address bar.
 *
 * Guarded for the server render: this runs from an effect, but a stray call
 * during SSR must return null rather than throw on `window`.
 */
export function takeHandoffToken(handoffId: string): string | null {
  if (typeof window === 'undefined') return null;
  return takeToken(handoffId, browserEnv());
}
