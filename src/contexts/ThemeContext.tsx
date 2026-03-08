import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─────────────────────────────────────────────────────────
// Theme definitions
// ─────────────────────────────────────────────────────────

export type Theme = {
  background: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentDark: string;
  border: string;
  success: string;
  error: string;
  warning: string;
  isDark: boolean;
};

export const DARK_THEME: Theme = {
  background: '#1a1a2e',
  surface: '#16213e',
  surfaceAlt: '#0f3460',
  text: '#e0e0e0',
  textSecondary: '#9e9e9e',
  textMuted: '#616161',
  accent: '#4fc3f7',
  accentDark: '#0288d1',
  border: '#2a2a4e',
  success: '#66bb6a',
  error: '#ef5350',
  warning: '#ffa726',
  isDark: true,
};

export const LIGHT_THEME: Theme = {
  background: '#f0f4f8',
  surface: '#ffffff',
  surfaceAlt: '#dce8f5',
  text: '#212121',
  textSecondary: '#757575',
  textMuted: '#bdbdbd',
  accent: '#1976d2',
  accentDark: '#004ba0',
  border: '#e0e0e0',
  success: '#388e3c',
  error: '#d32f2f',
  warning: '#f57c00',
  isDark: false,
};

// ─────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────

const STORAGE_KEY = '@dt_theme';

type ThemeContextValue = {
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: DARK_THEME,
  isDark: true,
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val !== null) setIsDark(val === 'dark');
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      AsyncStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
      return next;
    });
  }, []);

  const theme = isDark ? DARK_THEME : LIGHT_THEME;

  return (
    <ThemeContext.Provider value={{ theme, isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext).theme;
}

export function useThemeContext(): ThemeContextValue {
  return useContext(ThemeContext);
}
