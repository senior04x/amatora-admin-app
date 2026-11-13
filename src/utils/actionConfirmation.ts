import { Alert, Platform } from 'react-native';

export function showActionMessage(title: string, message: string) {
  if (Platform.OS === 'web') {
    window.alert(title + '\n\n' + message);
    return;
  }
  Alert.alert(title, message);
}

export function confirmDestructiveAction(
  title: string,
  message: string,
  actionLabel: string,
  onConfirm: () => void | Promise<void>,
) {
  if (Platform.OS === 'web') {
    if (window.confirm(title + '\n\n' + message)) void onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Bekor qilish', style: 'cancel' },
    { text: actionLabel, style: 'destructive', onPress: () => void onConfirm() },
  ]);
}
