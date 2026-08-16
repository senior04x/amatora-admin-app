import NetInfo from '@react-native-community/netinfo';
import { Alert } from 'react-native';

/**
 * Checks internet connectivity before executing destructive or financial/audit mutations.
 * Returns true if online, false if offline (and shows an Alert to the admin).
 */
export const requireOnline = async (actionDescription?: string): Promise<boolean> => {
  try {
    const state = await NetInfo.fetch();
    const isOnline = Boolean(state.isConnected && state.isInternetReachable !== false);

    if (!isOnline) {
      Alert.alert(
        'Internet Aloqasi Yo\'q ⚠️',
        actionDescription
          ? `"${actionDescription}" amalini bajarish uchun barqaror internet aloqasi talab qilinadi.`
          : 'Ushbu amalni bajarish uchun internet aloqasi talab qilinadi. Iltimos, tarmoqni tekshiring.'
      );
      return false;
    }
    return true;
  } catch (e) {
    // If NetInfo check fails, fail-safe allow
    return true;
  }
};
