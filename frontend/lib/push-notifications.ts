import { notificationsApi } from '@/lib/api';

function applicationServerKey(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const bytes = atob(base64);
  const key = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) key[index] = bytes.charCodeAt(index);
  return key.buffer as ArrayBuffer;
}

export function supportsPushNotifications(): boolean {
  return typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
}

/** Registers or refreshes this browser as one delivery target for the user. */
export async function enablePushNotifications(): Promise<'enabled' | 'denied' | 'unsupported' | 'unconfigured'> {
  if (!supportsPushNotifications()) return 'unsupported';
  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const configuration: any = await notificationsApi.getPushConfiguration();
  if (!configuration?.enabled || !configuration?.publicKey) return 'unconfigured';
  const registration = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(configuration.publicKey),
    });
  }
  await notificationsApi.subscribePush(subscription.toJSON());
  return 'enabled';
}

export async function disablePushNotifications(): Promise<void> {
  if (!supportsPushNotifications()) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await notificationsApi.unsubscribePush(subscription.endpoint);
  await subscription.unsubscribe();
}
