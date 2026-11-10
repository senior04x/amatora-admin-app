import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library/legacy';

export class GalleryPermissionError extends Error {}

export async function saveReplayToGallery(url: string, name: string, headers?: Record<string, string>) {
  if (Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) < 29)) {
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (!permission.granted) throw new GalleryPermissionError();
  }
  if (!FileSystem.cacheDirectory) throw new Error('Cache unavailable');
  const uri = `${FileSystem.cacheDirectory}${name}`;
  try {
    const result = await FileSystem.downloadAsync(url, uri, { headers });
    const mime = Object.entries(result.headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '';
    if (result.status !== 200 || !/^(video\/|application\/octet-stream)/i.test(mime)) throw new Error('Invalid video');
    await MediaLibrary.saveToLibraryAsync(result.uri);
  } finally {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
}
