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
 * Triggers a soft, subtle, gentle iOS haptic wave during the 1.2s gradient fade-in.
 */
export const triggerIosCrescendoHaptic = () => {
  if (Platform.OS !== 'ios') return;

  try {
    // 1. Initial gentle light tap as gradient starts
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    // 2. Soft selection pulse (250ms)
    setTimeout(() => {
      if (Platform.OS === 'ios') {
        try {
          Haptics.selectionAsync().catch(() => {});
        } catch (e) {}
      }
    }, 250);

    // 3. Gentle light impact pulse (550ms)
    setTimeout(() => {
      if (Platform.OS === 'ios') {
        try {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        } catch (e) {}
      }
    }, 550);
  } catch (e) {
    // Safe crash-proof fallback
  }
};

export const triggerHapticMedium = () => {
  try {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  } catch (e) {}
};

export const triggerHapticSuccess = () => {
  try {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  } catch (e) {}
};
