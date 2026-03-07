import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const ThemeContext = createContext(null);

const STORAGE_KEY = 'theme-mode';

const LIGHT_THEME = {
  '--color-bg': '#fafafa',
  '--color-bg-soft': '#f4f4f5',
  '--color-surface': '#ffffff',
  '--color-surface-elevated': '#ffffff',
  '--color-surface-hover': '#f4f4f5',
  '--color-fg': '#18181b',
  '--color-fg-muted': '#52525b',
  '--color-fg-dim': '#71717a',
  '--color-border': '#e4e4e7',
  '--color-border-subtle': '#f4f4f5',
  '--color-card': '#ffffff',
  '--color-input-bg': '#f4f4f5',
  '--color-modal-bg': '#ffffff',
};

const DARK_THEME = {
  '--color-bg': '#08090a',
  '--color-bg-soft': '#0c0d0f',
  '--color-surface': '#131417',
  '--color-surface-elevated': '#1a1b1f',
  '--color-surface-hover': '#222328',
  '--color-fg': '#f4f4f5',
  '--color-fg-muted': '#a1a1aa',
  '--color-fg-dim': '#71717a',
  '--color-border': '#27272a',
  '--color-border-subtle': '#1f1f23',
  '--color-card': '#131417',
  '--color-input-bg': '#0c0d0f',
  '--color-modal-bg': '#18181b',
};

function getSystemPreference() {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialTheme() {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return getSystemPreference();
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);

  const applyTheme = useCallback((themeName) => {
    const themeVars = themeName === 'light' ? LIGHT_THEME : DARK_THEME;
    const root = document.documentElement;
    
    Object.entries(themeVars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    
    root.setAttribute('data-theme', themeName);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme, applyTheme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  const setThemeMode = useCallback((mode) => {
    setTheme(mode);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setThemeMode, isDark: theme === 'dark' }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export default ThemeContext;
