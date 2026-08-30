import React from 'react';
import { Platform, View, ViewProps, StyleSheet } from 'react-native';
import { BlurView as ExpoBlurView, BlurViewProps } from 'expo-blur';
import { useTheme } from '../context/ThemeContext';

export interface SafeBlurViewProps extends BlurViewProps {
  androidBackgroundColor?: string;
}

export const SafeBlurView: React.FC<SafeBlurViewProps> = ({
  intensity = 60,
  tint = 'dark',
  style,
  androidBackgroundColor,
  children,
  experimentalBlurMethod,
  pointerEvents,
  ...rest
}) => {
  const { isDark, colors } = useTheme();
  const resolvedPointerEvents = pointerEvents || (!children ? 'none' : 'auto');

  if (Platform.OS === 'android') {
    let defaultBg = isDark ? colors.bgCard : colors.bgCard;
    if (tint === 'light' && isDark) {
      defaultBg = '#334155';
    } else if (tint === 'dark' && !isDark) {
      defaultBg = '#FFFFFF';
    }

    return (
      <View
        pointerEvents={resolvedPointerEvents}
        style={[
          style,
          {
            backgroundColor: androidBackgroundColor || defaultBg,
          },
          !isDark && {
            borderColor: colors.border,
          },
        ]}
        {...rest}
      >
        {children}
      </View>
    );
  }

  if (resolvedPointerEvents === 'none') {
    return (
      <View pointerEvents="none" style={style}>
        <ExpoBlurView
          intensity={intensity}
          tint={tint}
          style={StyleSheet.absoluteFill}
          experimentalBlurMethod={experimentalBlurMethod}
          {...rest}
        />
      </View>
    );
  }

  return (
    <ExpoBlurView
      intensity={intensity}
      tint={tint}
      style={style}
      experimentalBlurMethod={experimentalBlurMethod}
      pointerEvents={resolvedPointerEvents}
      {...rest}
    >
      {children}
    </ExpoBlurView>
  );
};

// Also export as BlurView so screens can import { BlurView } from '../components/SafeBlurView'
export const BlurView = SafeBlurView;
export default SafeBlurView;
