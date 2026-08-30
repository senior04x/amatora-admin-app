import React, { createContext, useContext, useState, useEffect } from 'react';
import { Platform, useColorScheme, Appearance, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ThemeColors {
  isDark: boolean;
  bgPrimary: string;
  bgSecondary: string;
  bgCard: string;
  bgCardElevated: string;
  border: string;
  borderLight: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accentGreen: string;
  accentBlue: string;
  accentYellow: string;
  accentRed: string;
  navDockBg: string;
  navDockActiveDot: string;
}

const darkColors: ThemeColors = {
  isDark: true,
  bgPrimary: '#0B0F17',
  bgSecondary: '#0F172A',
  bgCard: '#1E293B',
  bgCardElevated: '#1E293B',
  border: 'rgba(255, 255, 255, 0.1)',
  borderLight: 'rgba(255, 255, 255, 0.06)',
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  accentGreen: '#00FF87',
  accentBlue: '#38BDF8',
  accentYellow: '#FBBF24',
  accentRed: '#F87171',
  navDockBg: 'rgba(8, 8, 14, 0.88)',
  navDockActiveDot: '#00FF87',
};

const lightColors: ThemeColors = {
  isDark: false,
  bgPrimary: '#F8FAFC',
  bgSecondary: '#FFFFFF',
  bgCard: '#FFFFFF',
  bgCardElevated: '#F1F5F9',
  border: '#E2E8F0',
  borderLight: '#CBD5E1',
  textPrimary: '#0F172A',
  textSecondary: '#334155',
  textMuted: '#64748B',
  accentGreen: '#047857',
  accentBlue: '#1D4ED8',
  accentYellow: '#B45309',
  accentRed: '#B91C1C',
  navDockBg: 'rgba(255, 255, 255, 0.96)',
  navDockActiveDot: '#047857',
};

export type ThemeMode = 'system' | 'dark' | 'light';

interface ThemeContextType {
  theme: 'dark' | 'light';
  themeMode: ThemeMode;
  isDark: boolean;
  colors: ThemeColors;
  toggleTheme: () => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setThemeMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'dark',
  themeMode: 'system',
  isDark: true,
  colors: darkColors,
  toggleTheme: () => {},
  setTheme: () => {},
  setThemeMode: () => {},
});

const THEME_MODE_STORAGE_KEY = '@amatora_android_theme_mode';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const deviceColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [activeDeviceScheme, setActiveDeviceScheme] = useState<'dark' | 'light'>(deviceColorScheme === 'light' ? 'light' : 'dark');

  useEffect(() => {
    if (Platform.OS === 'android') {
      AsyncStorage.getItem(THEME_MODE_STORAGE_KEY).then((savedMode) => {
        if (savedMode === 'system' || savedMode === 'light' || savedMode === 'dark') {
          setThemeModeState(savedMode as ThemeMode);
        }
      });

      const updateScheme = () => {
        const cur = Appearance.getColorScheme();
        if (cur === 'light' || cur === 'dark') {
          setActiveDeviceScheme(cur);
        }
      };

      updateScheme();

      const appearanceSub = Appearance.addChangeListener(({ colorScheme }) => {
        if (colorScheme === 'light' || colorScheme === 'dark') {
          setActiveDeviceScheme(colorScheme);
        }
      });

      const appStateSub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          updateScheme();
        }
      });

      return () => {
        appearanceSub.remove();
        appStateSub.remove();
      };
    }
  }, []);

  useEffect(() => {
    if (deviceColorScheme === 'light' || deviceColorScheme === 'dark') {
      setActiveDeviceScheme(deviceColorScheme);
    }
  }, [deviceColorScheme]);

  const setThemeMode = (newMode: ThemeMode) => {
    if (Platform.OS !== 'android') return;
    setThemeModeState(newMode);
    AsyncStorage.setItem(THEME_MODE_STORAGE_KEY, newMode).catch(() => {});
  };

  const setTheme = (newTheme: 'dark' | 'light') => {
    setThemeMode(newTheme);
  };

  const toggleTheme = () => {
    if (Platform.OS !== 'android') return;
    const nextTheme = isDark ? 'light' : 'dark';
    setThemeMode(nextTheme);
  };

  // Determine whether dark colors are active
  let isDark = true;
  if (Platform.OS === 'android') {
    if (themeMode === 'system') {
      isDark = activeDeviceScheme === 'dark';
    } else {
      isDark = themeMode === 'dark';
    }
  }

  const effectiveTheme: 'dark' | 'light' = isDark ? 'dark' : 'light';
  const colors = isDark ? darkColors : lightColors;

  return (
    <ThemeContext.Provider
      value={{
        theme: effectiveTheme,
        themeMode,
        isDark,
        colors,
        toggleTheme,
        setTheme,
        setThemeMode,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
export default ThemeContext;
