'use client';

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'synapse-theme';

/**
 * Theme lives on <html data-theme>. The inline script in layout.tsx sets it
 * before first paint, so this hook only has to read what's already there.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme') as Theme | null;
    if (current) {
      setTheme(current);
      return;
    }
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    const next: Theme = prefersLight ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    setTheme(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* private mode — theme just won't persist */
      }
      return next;
    });
  }, []);

  return { theme, toggle, isDark: theme === 'dark' };
}
