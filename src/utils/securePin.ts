import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SECURE_PIN_KEY = 'amatora_secure_pin';
const LEGACY_PIN_KEY = '@amatora_pin_code';

/**
 * Saves 4-digit PIN into hardware-encrypted iOS Keychain / Android Keystore.
 */
export const saveSecurePin = async (pin: string): Promise<void> => {
  try {
    await SecureStore.setItemAsync(SECURE_PIN_KEY, pin, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    // Remove plaintext pin from legacy AsyncStorage
    await AsyncStorage.removeItem(LEGACY_PIN_KEY);
  } catch (e) {
    // Fallback for environments where SecureStore is unavailable
    await AsyncStorage.setItem(LEGACY_PIN_KEY, pin);
  }
};

/**
 * Retrieves PIN from hardware SecureStore, migrating legacy plaintext AsyncStorage if found.
 */
export const getSecurePin = async (): Promise<string | null> => {
  try {
    const pin = await SecureStore.getItemAsync(SECURE_PIN_KEY);
    if (pin) return pin;

    // Seamless migration from legacy AsyncStorage
    const legacyPin = await AsyncStorage.getItem(LEGACY_PIN_KEY);
    if (legacyPin) {
      await saveSecurePin(legacyPin);
      return legacyPin;
    }
    return null;
  } catch (e) {
    return await AsyncStorage.getItem(LEGACY_PIN_KEY);
  }
};

/**
 * Completely removes PIN from SecureStore and AsyncStorage.
 */
export const deleteSecurePin = async (): Promise<void> => {
  try {
    await SecureStore.deleteItemAsync(SECURE_PIN_KEY);
  } catch (e) {}
  try {
    await AsyncStorage.removeItem(LEGACY_PIN_KEY);
  } catch (e) {}
};

/**
 * Checks if a PIN is configured on the device.
 */
export const hasSecurePin = async (): Promise<boolean> => {
  const pin = await getSecurePin();
  return !!pin;
};
