"use client";

// Sales CRM — CRM-local theme provider
// Adapted from intern source (src/lib/theme.tsx). Same behavior (persisted
// preference, system-preference fallback, manual toggle) but scoped
// entirely differently:
//
// Intern's version calls document.documentElement.setAttribute("data-theme",
// theme) — i.e. it writes to <html>, a global attribute — and ships a
// THEME_INIT_SCRIPT meant to be injected into <head> via a root-layout
// <Script strategy="beforeInteractive"> to prevent flash-of-wrong-theme.
// Neither is usable here: this workspace must not touch Apex's root
// layout/theme, and Next.js only allows beforeInteractive scripts from the
// true root layout. So instead:
//   - theme is applied as a data-salescrm-theme attribute on the
//     .sales-crm-root wrapper element itself (plain React state -> JSX
//     attribute), never on document.documentElement/<html>/<body>.
//   - there is no blocking head script, so the very first client render
//     always starts at "light" (matching the server-rendered HTML exactly,
//     avoiding a hydration mismatch), then an effect applies the user's
//     real persisted/system preference immediately after mount. This can
//     cause a brief, one-frame flash to light for users with a saved dark
//     preference — an accepted, disclosed trade-off of not touching the
//     root layout, not a bug.

import { createContext, useContext, useEffect, useState, useCallback } from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const STORAGE_KEY = "salescrm-theme";

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggleTheme: () => {},
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function readPersistedOrSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
  } catch {
    // localStorage can throw in some environments (private browsing, etc.)
  }
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Always starts at "light" so the first client render matches the
  // server-rendered HTML exactly — see module doc comment.
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    const real = readPersistedOrSystemTheme();
    if (real !== "light") setThemeState(real);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // best-effort persistence, matching the rest of this workspace's stores
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "light" ? "dark" : "light");
  }, [theme, setTheme]);

  return <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>{children}</ThemeContext.Provider>;
}
