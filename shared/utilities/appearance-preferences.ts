export type AppearanceKey = 'theme' | 'accent' | 'font-size' | 'compact' | 'contrast' | 'motion' | 'sidebar-density';

export function resolveTheme(preference: string | null): 'technoedge-light' | 'john-wick-dark' {
  if (preference === 'system' && typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'john-wick-dark' : 'technoedge-light';
  }
  return preference === 'john-wick-dark' ? 'john-wick-dark' : 'technoedge-light';
}

export function appearancePreferenceKey(userId: string | null | undefined, key: AppearanceKey): string | null {
  return userId ? `apex-appearance:${userId}:${key}` : null;
}

export function readAppearancePreference(userId: string | null | undefined, key: AppearanceKey): string | null {
  const storageKey = appearancePreferenceKey(userId, key);
  return storageKey && typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
}

export function writeAppearancePreference(userId: string | null | undefined, key: AppearanceKey, value: string): void {
  const storageKey = appearancePreferenceKey(userId, key);
  if (storageKey && typeof localStorage !== 'undefined') localStorage.setItem(storageKey, value);
}

export function clearAppearancePreference(userId: string | null | undefined, key: AppearanceKey): void {
  const storageKey = appearancePreferenceKey(userId, key);
  if (storageKey && typeof localStorage !== 'undefined') localStorage.removeItem(storageKey);
}

export function applyDisplayPreferences(userId: string | null | undefined): void {
  if (typeof document === 'undefined') return;
  const fontSize = readAppearancePreference(userId, 'font-size');
  document.documentElement.setAttribute('data-font-size',
    fontSize === 'small' || fontSize === 'large' ? fontSize : 'medium');
  document.documentElement.setAttribute('data-compact',
    readAppearancePreference(userId, 'compact') === 'true' ? 'true' : 'false');
  document.documentElement.setAttribute('data-contrast',
    readAppearancePreference(userId, 'contrast') === 'more' ? 'more' : 'normal');
  document.documentElement.setAttribute('data-motion',
    readAppearancePreference(userId, 'motion') === 'reduce' ? 'reduce' : 'normal');
  document.documentElement.setAttribute('data-sidebar-density',
    readAppearancePreference(userId, 'sidebar-density') === 'compact' ? 'compact' : 'comfortable');
}

export function applyAppearanceForUser(userId: string | null | undefined): void {
  if (typeof document === 'undefined' || typeof localStorage === 'undefined') return;
  const theme = readAppearancePreference(userId, 'theme') || localStorage.getItem('apex-company-theme');
  const accent = readAppearancePreference(userId, 'accent') || localStorage.getItem('apex-company-accent');
  document.documentElement.setAttribute('data-theme', resolveTheme(theme));
  document.documentElement.setAttribute('data-accent',
    ['royal-blue', 'emerald', 'violet', 'gold', 'crimson', 'slate'].includes(accent || '') ? accent! : 'royal-blue');
  applyDisplayPreferences(userId);
}
