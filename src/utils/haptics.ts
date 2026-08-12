import * as Haptics from 'expo-haptics';
import { Platform, Vibration } from 'react-native';

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
 * Triggers a continuous, seamless crescendo vibration on iOS (1200ms).
 * Has zero pauses or gaps ("to'xtab-to'xtab bo'lmasdan"), smoothly ramping up
 * in intensity from light to heavy as the background gradient covers the screen.
 */
export const triggerIosCrescendoHaptic = () => {
  if (Platform.OS !== 'ios') return;

  try {
    // 1. Continuous unbroken vibration motor stream on iOS for 1200ms
    Vibration.vibrate(1200);

    // 2. Rapid seamless micro-haptic wave every 60ms that escalates in force
    let step = 0;
    const totalSteps = 20; // 20 steps over 1200ms
    const interval = setInterval(() => {
      step++;
      if (step > totalSteps || Platform.OS !== 'ios') {
        clearInterval(interval);
        return;
      }

      try {
        if (step <= 7) {
          // Phase 1 (0ms - 420ms): Light continuous feel
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        } else if (step <= 14) {
          // Phase 2 (420ms - 840ms): Medium continuous feel
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        } else {
          // Phase 3 (840ms - 1200ms): Heavy peak feel as gradient finishes covering screen
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
        }
      } catch (e) {}
    }, 60);

    // Cleanup timer after 1250ms
    setTimeout(() => {
      clearInterval(interval);
    }, 1250);
  } catch (e) {
    // Crash-proof safe fallback
  }
};
