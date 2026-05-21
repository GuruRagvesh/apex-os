'use client';

import { useEffect, useCallback, useState } from 'react';

const THEME_KEY = 'apex-theme';
const ACCENT_KEY = 'apex-accent';

export type ThemeId =
  | 'technoedge-light'
  | 'john-wick-dark'
  | 'gen-z-pastel'
  | 'executive-midnight'
  | 'focus-mode'
  | 'neo-future';

export type AccentId = 'royal-blue' | 'emerald' | 'violet' | 'gold' | 'crimson' | 'slate';

export function applyTheme(theme: ThemeId, accent: AccentId) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-accent', accent);
}

function getStoredTheme(): ThemeId {
  if (typeof localStorage === 'undefined') return 'technoedge-light';
  return (
    (localStorage.getItem(THEME_KEY) as ThemeId) ||
    (localStorage.getItem('apex-company-theme') as ThemeId) ||
    'technoedge-light'
  );
}

function getStoredAccent(): AccentId {
  if (typeof localStorage === 'undefined') return 'royal-blue';
  return (
    (localStorage.getItem(ACCENT_KEY) as AccentId) ||
    (localStorage.getItem('apex-company-accent') as AccentId) ||
    'royal-blue'
  );
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>('technoedge-light');
  const [accent, setAccentState] = useState<AccentId>('royal-blue');

  useEffect(() => {
    const t = getStoredTheme();
    const a = getStoredAccent();
    setThemeState(t);
    setAccentState(a);
    applyTheme(t, a);
  }, []);

  const setTheme = useCallback((t: ThemeId) => {
    localStorage.setItem(THEME_KEY, t);
    setThemeState(t);
    applyTheme(t, getStoredAccent());
  }, []);

  const setAccent = useCallback((a: AccentId) => {
    localStorage.setItem(ACCENT_KEY, a);
    setAccentState(a);
    applyTheme(getStoredTheme(), a);
  }, []);

  const setCompanyDefaults = useCallback((t: ThemeId, a: AccentId) => {
    localStorage.setItem('apex-company-theme', t);
    localStorage.setItem('apex-company-accent', a);
    if (!localStorage.getItem(THEME_KEY)) {
      setThemeState(t);
      setAccentState(a);
      applyTheme(t, a);
    }
  }, []);

  const resetToCompanyDefaults = useCallback(() => {
    localStorage.removeItem(THEME_KEY);
    localStorage.removeItem(ACCENT_KEY);
    const t = (localStorage.getItem('apex-company-theme') as ThemeId) || 'technoedge-light';
    const a = (localStorage.getItem('apex-company-accent') as AccentId) || 'royal-blue';
    setThemeState(t);
    setAccentState(a);
    applyTheme(t, a);
  }, []);

  return { theme, accent, setTheme, setAccent, setCompanyDefaults, resetToCompanyDefaults };
}
