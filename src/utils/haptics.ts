import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Triggers a crisp, light iOS haptic feedback pulse.
 * Safely scoped strictly to iOS (Platform.OS === 'ios').
 */
export const triggerIosLightHaptic = () => {
  if (Platform.OS === 'ios') {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch (e) {
      // Safe fallback - silence error
    }
  }
};

/**
 * Triggers a progressive crescendo haptic vibration sequence on iOS
 * while the background gradient fades in and fully covers the screen (1200ms).
 * Starts soft (Light) and progressively builds up (Light -> Medium -> Heavy)
 * synchronized with the gradient opacity transition.
 */
export const triggerIosCrescendoHaptic = () => {
  if (Platform.OS !== 'ios') return;

  try {
    // 1. Initial soft pulse (0ms) as gradient begins fading in
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    // 2. Second soft pulse (300ms) as colors expand
    setTimeout(() => {
      if (Platform.OS === 'ios') {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        } catch (e) {}
      }
    }, 300);

    // 3. Medium intensity pulse (650ms) as gradient reaches half screen
    setTimeout(() => {
      if (Platform.OS === 'ios') {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        } catch (e) {}
      }
    }, 650);

    // 4. Strong final pulse (1000ms) as gradient fully covers screen
    setTimeout(() => {
      if (Platform.OS === 'ios') {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
        } catch (e) {}
      }
    }, 1000);
  } catch (e) {
    // Crash-proof safe fallback
  }
};
