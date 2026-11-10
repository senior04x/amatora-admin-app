import { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ReplayVideo from './ReplayVideo';
import { resolveAndroidReplay } from '../utils/androidReplaySource';

export default function ReplayPlayback({ uri, onClose }: { uri: string; onClose: () => void }) {
  const [source, setSource] = useState(Platform.OS === 'android' ? null : uri);
  useEffect(() => {
    let active = true;
    if (Platform.OS === 'android') void resolveAndroidReplay(uri).then(value => { if (active) setSource(value); });
    return () => { active = false; };
  }, [uri]);
  const [paused, setPaused] = useState(AppState.currentState !== 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setPaused(state !== 'active'));
    return () => subscription.remove();
  }, []);
  return <View style={StyleSheet.absoluteFill}>
    {source ? <ReplayVideo key={source} uri={source} paused={paused} dom={{ scrollEnabled: false,
      allowsInlineMediaPlayback: true, mediaPlaybackRequiresUserAction: false, style: { backgroundColor: '#080e18' } }} /> : <ActivityIndicator color="#10b981" style={StyleSheet.absoluteFill} />}
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Videoni yopish" onPress={onClose}
      style={{ position: 'absolute', right: 8, top: 8, padding: 8, borderRadius: 20, backgroundColor: '#0f172acc' }}>
      <Ionicons name="close" size={18} color="#fff" />
    </TouchableOpacity>
  </View>;
}
