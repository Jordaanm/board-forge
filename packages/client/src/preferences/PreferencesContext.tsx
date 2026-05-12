import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { load, save } from './storage';
import { DEFAULT_PREFERENCES, type DarkMode, type Preferences, type RotateAmount } from './types';

export interface PreferencesContextValue {
  darkMode:        DarkMode;
  rotateAmount:    RotateAmount;
  resolvedTheme:   'light' | 'dark';
  setDarkMode:     (mode: DarkMode) => void;
  setRotateAmount: (amount: RotateAmount) => void;
  reset:           () => void;
}

export const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function readSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function deriveResolvedTheme(darkMode: DarkMode, systemTheme: 'light' | 'dark'): 'light' | 'dark' {
  if (darkMode === 'system') return systemTheme;
  return darkMode;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(() => load());
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => readSystemTheme());

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemTheme(e.matches ? 'dark' : 'light');
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    // Fallback for older Safari
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  const setDarkMode = useCallback((darkMode: DarkMode) => {
    setPrefs(prev => {
      const next = { ...prev, darkMode };
      save(next);
      return next;
    });
  }, []);

  const setRotateAmount = useCallback((rotateAmount: RotateAmount) => {
    setPrefs(prev => {
      const next = { ...prev, rotateAmount };
      save(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    const next: Preferences = { ...DEFAULT_PREFERENCES };
    save(next);
    setPrefs(next);
  }, []);

  const value = useMemo<PreferencesContextValue>(() => ({
    darkMode:      prefs.darkMode,
    rotateAmount:  prefs.rotateAmount,
    resolvedTheme: deriveResolvedTheme(prefs.darkMode, systemTheme),
    setDarkMode,
    setRotateAmount,
    reset,
  }), [prefs.darkMode, prefs.rotateAmount, systemTheme, setDarkMode, setRotateAmount, reset]);

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}
