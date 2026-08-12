import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Triggers a crisp, light iOS haptic feedback pulse.
 * Safely scoped strictly to iOS (Platform.OS === 'ios') and wrapped in a try-catch
 * to guarantee 100% fault tolerance and zero runtime errors on any device.
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
