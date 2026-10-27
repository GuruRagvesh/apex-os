'use client';

import { useEffect, useCallback, useState } from 'react';
import { clearAppearancePreference, readAppearancePreference, resolveTheme, writeAppearancePreference } from './appearance-preferences';

export type ThemeId = 'technoedge-light' | 'john-wick-dark';
export type ThemeChoice = ThemeId | 'system';

export type AccentId = 'royal-blue' | 'emerald' | 'violet' | 'gold' | 'crimson' | 'slate';

export function applyTheme(theme: ThemeId, accent: AccentId) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-accent', accent);
}

function getStoredTheme(userId?: string | null): ThemeChoice {
  if (typeof localStorage === 'undefined') return 'technoedge-light';
  const stored = readAppearancePreference(userId, 'theme') || localStorage.getItem('apex-company-theme');
  return stored === 'john-wick-dark' || stored === 'system' ? stored : 'technoedge-light';
}

function getStoredAccent(userId?: string | null): AccentId {
  if (typeof localStorage === 'undefined') return 'royal-blue';
  const stored = readAppearancePreference(userId, 'accent') || localStorage.getItem('apex-company-accent');
  return (['royal-blue', 'emerald', 'violet', 'gold', 'crimson', 'slate'] as (string | null)[]).includes(stored)
    ? stored as AccentId : 'royal-blue';
}

export function useTheme(userId?: string | null) {
  const [theme, setThemeState] = useState<ThemeChoice>('technoedge-light');
  const [accent, setAccentState] = useState<AccentId>('royal-blue');

  useEffect(() => {
    const t = getStoredTheme(userId);
    const a = getStoredAccent(userId);
    setThemeState(t);
    setAccentState(a);
    applyTheme(resolveTheme(t), a);
  }, [userId]);

  useEffect(() => {
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => applyTheme(resolveTheme('system'), getStoredAccent(userId));
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [theme, userId]);

  const setTheme = useCallback((t: ThemeChoice) => {
    writeAppearancePreference(userId, 'theme', t);
    setThemeState(t);
    applyTheme(resolveTheme(t), getStoredAccent(userId));
  }, [userId]);

  const setAccent = useCallback((a: AccentId) => {
    writeAppearancePreference(userId, 'accent', a);
    setAccentState(a);
    applyTheme(resolveTheme(getStoredTheme(userId)), a);
  }, [userId]);

  const setCompanyDefaults = useCallback((t: ThemeId, a: AccentId) => {
    localStorage.setItem('apex-company-theme', t);
    localStorage.setItem('apex-company-accent', a);
    const effectiveTheme = getStoredTheme(userId);
    const effectiveAccent = getStoredAccent(userId);
    setThemeState(effectiveTheme);
    setAccentState(effectiveAccent);
    applyTheme(resolveTheme(effectiveTheme), effectiveAccent);
  }, [userId]);

  const resetToCompanyDefaults = useCallback(() => {
    clearAppearancePreference(userId, 'theme');
    clearAppearancePreference(userId, 'accent');
    const t = localStorage.getItem('apex-company-theme') === 'john-wick-dark' ? 'john-wick-dark' : 'technoedge-light';
    const storedAccent = localStorage.getItem('apex-company-accent');
    const a = (['royal-blue', 'emerald', 'violet', 'gold', 'crimson', 'slate'] as (string | null)[]).includes(storedAccent)
      ? storedAccent as AccentId : 'royal-blue';
    setThemeState(t);
    setAccentState(a);
    applyTheme(t, a);
  }, [userId]);

  return { theme, accent, setTheme, setAccent, setCompanyDefaults, resetToCompanyDefaults };
}
