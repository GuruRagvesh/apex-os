/**
 * Per-event delivery channels (Phase 1, spec §4).
 *
 * The Notification Center row is ALWAYS created; preferences only decide the
 * extra channels. Two preference forms exist:
 *
 *   legacy   { [eventKey]: false }  mutes popup, push and email for that event
 *   channels { channels: { [eventKey]: { popup?, push?, email? } } }
 *
 * When both are present for an event, `channels` wins, key by key. The global
 * switches keep their meaning: `inApp: false` turns popups off everywhere and
 * `pushEnabled: false` turns push off everywhere.
 */

export type NotificationChannel = 'popup' | 'push' | 'email';
export const NOTIFICATION_CHANNELS: NotificationChannel[] = ['popup', 'push', 'email'];

export interface EffectiveChannels {
  popup: boolean;
  push: boolean;
  email: boolean;
}

export function effectiveChannels(prefs: Record<string, any> | null | undefined, eventKey: string): EffectiveChannels {
  const p = prefs ?? {};
  const legacyOn = !eventKey || p[eventKey] !== false;
  const own = (p.channels && typeof p.channels === 'object' ? p.channels[eventKey] : null) ?? {};
  const pick = (c: NotificationChannel) => (typeof own[c] === 'boolean' ? own[c] : legacyOn);
  return {
    popup: pick('popup') && p.inApp !== false,
    push: pick('push') && p.pushEnabled !== false,
    email: pick('email'),
  };
}

const EVENT_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/**
 * Validates the `channels` part of a preferences body. Unknown shapes are
 * dropped rather than stored; only booleans for the three known channels
 * survive, for at most 100 well-formed event keys.
 */
export function sanitizeChannels(raw: unknown): Record<string, Partial<EffectiveChannels>> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, Partial<EffectiveChannels>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 100)) {
    if (!EVENT_KEY.test(key) || !value || typeof value !== 'object') continue;
    const entry: Partial<EffectiveChannels> = {};
    for (const c of NOTIFICATION_CHANNELS) {
      const v = (value as Record<string, unknown>)[c];
      if (typeof v === 'boolean') entry[c] = v;
    }
    if (Object.keys(entry).length > 0) out[key] = entry;
  }
  return out;
}
