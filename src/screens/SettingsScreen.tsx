import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, DeviceEventEmitter, Alert, Image, ActivityIndicator, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { useOrg } from '../context/OrgContext';
import { supabase } from '../supabaseClient';
import { hasSecurePin, deleteSecurePin } from '../utils/securePin';
import {
  getYtTokens,
  saveYtTokens,
  fetchYtChannelInfo,
  getValidAccessToken,
  disconnectYouTube,
  loadYtChannelForOrg,
  YT_SCOPES,
  YtChannelInfo,
} from '../utils/youtubeService';
import pkg from '../../package.json';

// Required for expo-auth-session warm-up
WebBrowser.maybeCompleteAuthSession();

const APP_VERSION = `v${pkg.version}`;

// Google OAuth Client IDs
// Web Client ID (existing - used for web admin)
const GOOGLE_WEB_CLIENT_ID = '869594621568-f43saav9qgm76srbi5jfhonb92q7ubsl.apps.googleusercontent.com';
// iOS Client ID — Google Console > Credentials > Create OAuth Client ID > iOS > Bundle ID: com.amatora.adminapp
const GOOGLE_IOS_CLIENT_ID = '869594621568-f43saav9qgm76srbi5jfhonb92q7ubsl.apps.googleusercontent.com';
// Android Client ID — Google Console > Credentials > Create OAuth Client ID > Android
const GOOGLE_ANDROID_CLIENT_ID = '869594621568-f43saav9qgm76srbi5jfhonb92q7ubsl.apps.googleusercontent.com';

interface SettingsScreenProps {
  onGoBack?: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onGoBack }) => {
  const { currentOrg, orgId, userRole, showToast } = useOrg();
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [hasPin, setHasPin] = useState(false);

  // YouTube state
  const [ytChannelInfo, setYtChannelInfo] = useState<YtChannelInfo | null>(null);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytConnecting, setYtConnecting] = useState(false);

  // ─── Google Auth Request (handles iOS/Android redirect URIs automatically) ──
  const [request, response, promptAsync] = Google.useAuthRequest({
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    webClientId: GOOGLE_WEB_CLIENT_ID,
    scopes: YT_SCOPES,
    shouldAutoExchangeCode: false,
    extraParams: {
      access_type: 'offline',
      prompt: 'consent select_account',
    },
  });

  // ─── Handle OAuth Response ─────────────────────────────────────────
  useEffect(() => {
    if (response?.type === 'success' && response.params?.code) {
      handleCodeExchange(response.params.code);
    } else if (response?.type === 'error') {
      console.error('YouTube OAuth error:', response.error);
      Alert.alert('Xatolik', 'YouTube ulanishda xatolik yuz berdi.');
      setYtConnecting(false);
    } else if (response?.type === 'dismiss' || response?.type === 'cancel') {
      setYtConnecting(false);
    }
  }, [response]);

  const handleCodeExchange = async (code: string) => {
    setYtConnecting(true);
    try {
      // iOS OAuth clients are "public" — use PKCE instead of client_secret
      const tokenRequestBody: Record<string, string> = {
        code,
        client_id: GOOGLE_IOS_CLIENT_ID,
        redirect_uri: request?.redirectUri || '',
        grant_type: 'authorization_code',
      };

      // PKCE code verifier (required for iOS OAuth clients)
      if (request?.codeVerifier) {
        tokenRequestBody.code_verifier = request.codeVerifier;
      }

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(tokenRequestBody).toString(),
      });

      const tokenData = await tokenResponse.json();

      if (tokenData.access_token) {
        // Fetch channel info
        const channelInfo = await fetchYtChannelInfo(tokenData.access_token);

        // Save tokens to AsyncStorage + Supabase DB
        await saveYtTokens(orgId || 1, tokenData, channelInfo);

        setYtChannelInfo(channelInfo);
        showToast({
          message: channelInfo
            ? `YouTube ulandi: ${channelInfo.title}`
            : 'YouTube muvaffaqiyatli ulandi!',
          type: 'success',
        });
      } else {
        console.error('YouTube token exchange failed:', tokenData);
        Alert.alert('Xatolik', `YouTube token olishda xatolik: ${tokenData?.error || 'noma\'lum'}`);
      }
    } catch (err) {
      console.error('Error exchanging YouTube code:', err);
      Alert.alert('Xatolik', 'YouTube ulanishda xatolik yuz berdi.');
    } finally {
      setYtConnecting(false);
    }
  };

  // ─── Load YouTube channel on mount (Only for Super Admin) ───────────
  useEffect(() => {
    if (orgId && userRole !== 'user') {
      loadYouTubeStatus();
    }
  }, [orgId, userRole]);

  // ─── Reload when app comes to foreground (Only for Super Admin) ────
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active' && orgId && userRole !== 'user') {
        loadYouTubeStatus();
      }
    });
    return () => subscription.remove();
  }, [orgId, userRole]);

  const loadYouTubeStatus = async () => {
    setYtLoading(true);
    try {
      const channelInfo = await loadYtChannelForOrg(orgId || 1);
      setYtChannelInfo(channelInfo);
    } catch (e) {
      console.error('Load YT status error:', e);
      setYtChannelInfo(null);
    } finally {
      setYtLoading(false);
    }
  };

  // ─── Connect YouTube ───────────────────────────────────────────────
  const handleConnectYouTube = async () => {
    if (!request) {
      Alert.alert('Kutib turing', 'OAuth tayyorlanmoqda, bir necha soniya kutib qayta urinib ko\'ring.');
      return;
    }

    setYtConnecting(true);
    try {
      await promptAsync();
    } catch (err) {
      console.error('YouTube connect error:', err);
      setYtConnecting(false);
      Alert.alert('Xatolik', 'YouTube ulanishda xatolik yuz berdi.');
    }
  };

  // ─── Disconnect YouTube ────────────────────────────────────────────
  const handleDisconnectYouTube = () => {
    Alert.alert(
      'YouTube uzish',
      `"${ytChannelInfo?.title || 'YouTube'}" kanalini uzmoqchimisiz?`,
      [
        { text: 'Bekor qilish', style: 'cancel' },
        {
          text: 'Uzish',
          style: 'destructive',
          onPress: async () => {
            try {
              await disconnectYouTube(orgId || 1);
              setYtChannelInfo(null);
              showToast({
                message: 'YouTube kanal uzildi',
                type: 'warning',
              });
            } catch (e) {
              console.error('Disconnect error:', e);
              Alert.alert('Xatolik', 'YouTube uzishda xatolik yuz berdi.');
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
    loadSettings();

    const pinSub = DeviceEventEmitter.addListener('app_pin_changed', () => {
      checkPin();
    });

    const bioSub = DeviceEventEmitter.addListener('app_biometrics_changed', () => {
      loadBiometricsStatus();
    });

    return () => {
      pinSub.remove();
      bioSub.remove();
    };
  }, []);

  const loadSettings = async () => {
    await checkPin();
    await loadBiometricsStatus();
    await loadNotificationsStatus();
  };

  const checkPin = async () => {
    const p = await hasSecurePin();
    setHasPin(p);
  };

  const loadBiometricsStatus = async () => {
    const bio = await AsyncStorage.getItem('@amatora_biometrics_enabled');
    setBiometricsEnabled(bio === 'true');
  };

  const loadNotificationsStatus = async () => {
    const notif = await AsyncStorage.getItem('@amatora_notifications_enabled');
    if (notif !== null) {
      setNotificationsEnabled(notif === 'true');
    } else {
      const { status } = await Notifications.getPermissionsAsync();
      setNotificationsEnabled(status === 'granted');
    }
  };

  const toggleBiometrics = async (val: boolean) => {
    if (val) {
      const p = await AsyncStorage.getItem('@amatora_pin_code');
      if (!p) {
        Alert.alert(
          'PIN kod yo\'q',
          'Face ID yoki Barmoq izini yoqish uchun avval PIN kod o\'rnating.',
          [
            { text: 'Bekor qilish', style: 'cancel' },
            {
              text: 'PIN kod o\'rnatish',
              onPress: () => handleSetOrEditPin(),
            },
          ]
        );
        setBiometricsEnabled(false);
        return;
      }

      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) {
        Alert.alert(
          'Biometriya sozlanmagan',
          'Qurilmangizda Face ID / Barmoq izi mavjud emas yoki telefon sozlamalarida biometriya o\'rnatilmagan.'
        );
        setBiometricsEnabled(false);
        await AsyncStorage.setItem('@amatora_biometrics_enabled', 'false');
        return;
      }

      try {
        const res = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Biometriyani tasdiqlang',
          fallbackLabel: '',
          cancelLabel: 'Bekor qilish',
        });

        if (res.success) {
          setBiometricsEnabled(true);
          await AsyncStorage.setItem('@amatora_biometrics_enabled', 'true');
        } else {
          setBiometricsEnabled(false);
          await AsyncStorage.setItem('@amatora_biometrics_enabled', 'false');
        }
      } catch (err) {
        setBiometricsEnabled(false);
        await AsyncStorage.setItem('@amatora_biometrics_enabled', 'false');
      }
    } else {
      setBiometricsEnabled(false);
      await AsyncStorage.setItem('@amatora_biometrics_enabled', 'false');
    }
  };

  const toggleNotifications = async (val: boolean) => {
    if (val) {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        Alert.alert(
          'Bildirishnomalar rad etildi',
          'Push-bildirishnomalardan foydalanish uchun telefon sozlamalaridan ruxsat bering.'
        );
        setNotificationsEnabled(false);
        await AsyncStorage.setItem('@amatora_notifications_enabled', 'false');
        return;
      }

      setNotificationsEnabled(true);
      await AsyncStorage.setItem('@amatora_notifications_enabled', 'true');

      // Request and store push token if available
      try {
        const tokenData = await Notifications.getExpoPushTokenAsync().catch(() => null);
        if (tokenData?.data) {
          await AsyncStorage.setItem('@amatora_push_token', tokenData.data);
          if (currentOrg?.id) {
            await supabase
              .from('organizations')
              .update({ push_token: tokenData.data })
              .eq('id', currentOrg.id);
          }
        }
      } catch (err) {
        console.log('Push token fetch error:', err);
      }
    } else {
      setNotificationsEnabled(false);
      await AsyncStorage.setItem('@amatora_notifications_enabled', 'false');
    }
  };

  const handleSetOrEditPin = () => {
    DeviceEventEmitter.emit('app_pin_edit');
  };

  const handleResetPin = () => {
    Alert.alert(
      'PIN kodni o\'chirish',
      'Rostdan ham joriy PIN kodni o\'chirib tashlamoqchimisiz?',
      [
        { text: 'Bekor qilish', style: 'cancel' },
        {
          text: 'O\'chirish',
          style: 'destructive',
          onPress: async () => {
            try {
              // Delete securely on device
              await deleteSecurePin();
              await AsyncStorage.setItem('@amatora_biometrics_enabled', 'false');
              setHasPin(false);
              setBiometricsEnabled(false);
              DeviceEventEmitter.emit('app_pin_changed');
              DeviceEventEmitter.emit('app_pin_reset');

              Alert.alert('Muvaffaqiyatli', 'PIN kod o\'chirildi');
            } catch (e) {
              console.error('Error deleting pin:', e);
              Alert.alert('Xatolik', 'PIN kodni o\'chirishda xatolik yuz berdi.');
            }
          }
        }
      ]
    );
  };

  const onNavigateBack = () => {
    if (onGoBack) onGoBack();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 100 }}>
      {/* Header Row with Back Button */}
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.backBtn} activeOpacity={0.7} onPress={onNavigateBack}>
          <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Sozlamalar</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Security Section */}
      <Text style={styles.sectionHeader}>Xavfsizlik & Kirish</Text>

      <View style={styles.settingItem}>
        <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={styles.settingLeft}>
          <View style={[styles.settingIcon, { backgroundColor: 'rgba(255, 255, 255, 0.1)' }]}>
            <Ionicons name="finger-print" size={20} color="#FFFFFF" />
          </View>
          <View>
            <Text style={styles.settingTitle}>Face ID / Barmoq Izi</Text>
            <Text style={styles.settingSub}>Ilovaga kirishda biometriya so'rash</Text>
          </View>
        </View>
        <Switch
          value={biometricsEnabled}
          onValueChange={toggleBiometrics}
          trackColor={{ false: 'rgba(255, 255, 255, 0.1)', true: 'rgba(255, 255, 255, 0.35)' }}
          thumbColor={biometricsEnabled ? '#FFFFFF' : '#94A3B8'}
        />
      </View>

      <View style={styles.settingItem}>
        <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={styles.settingLeft}>
          <View style={[styles.settingIcon, { backgroundColor: 'rgba(255, 255, 255, 0.1)' }]}>
            <Ionicons name="notifications" size={20} color="#FFFFFF" />
          </View>
          <View>
            <Text style={styles.settingTitle}>Bildirishnomalar</Text>
            <Text style={styles.settingSub}>Tizim xabarlari va eslatmalar</Text>
          </View>
        </View>
        <Switch
          value={notificationsEnabled}
          onValueChange={toggleNotifications}
          trackColor={{ false: 'rgba(255, 255, 255, 0.1)', true: 'rgba(255, 255, 255, 0.35)' }}
          thumbColor={notificationsEnabled ? '#FFFFFF' : '#94A3B8'}
        />
      </View>

      {hasPin ? (
        <>
          <TouchableOpacity style={styles.settingItem} activeOpacity={0.7} onPress={handleSetOrEditPin}>
            <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
            <View style={styles.settingLeft}>
              <View style={[styles.settingIcon, { backgroundColor: 'rgba(255, 255, 255, 0.1)' }]}>
                <Ionicons name="keypad" size={20} color="#FFFFFF" />
              </View>
              <View>
                <Text style={styles.settingTitle}>PIN kodni tahrirlash</Text>
                <Text style={styles.settingSub}>Yangi PIN kod o'rnatish</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.4)" />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.settingItem, { borderColor: 'rgba(239, 68, 68, 0.3)' }]} activeOpacity={0.7} onPress={handleResetPin}>
            <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
            <View style={styles.settingLeft}>
              <View style={[styles.settingIcon, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                <Ionicons name="trash" size={20} color="#EF4444" />
              </View>
              <View>
                <Text style={[styles.settingTitle, { color: '#EF4444' }]}>PIN kodni o'chirish</Text>
                <Text style={styles.settingSub}>Kirish kodini olib tashlash</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.4)" />
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity style={styles.settingItem} activeOpacity={0.7} onPress={handleSetOrEditPin}>
          <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={styles.settingLeft}>
            <View style={[styles.settingIcon, { backgroundColor: 'rgba(255, 255, 255, 0.1)' }]}>
              <Ionicons name="keypad" size={20} color="#FFFFFF" />
            </View>
            <View>
              <Text style={styles.settingTitle}>PIN kod o'rnatish</Text>
              <Text style={styles.settingSub}>Xavfsizlik uchun kod o'rnating</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.4)" />
        </TouchableOpacity>
      )}

      {/* ─── YouTube Integration Section (Only for Super Admin) ─────── */}
      {userRole !== 'user' && (
        <>
          <Text style={styles.sectionHeader}>YouTube Integratsiya</Text>

          {ytLoading ? (
            <View style={styles.settingItem}>
              <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
              <View style={styles.settingLeft}>
                <View style={[styles.settingIcon, { backgroundColor: 'rgba(255, 0, 0, 0.15)' }]}>
                  <Ionicons name="logo-youtube" size={20} color="#FF0000" />
                </View>
                <View>
                  <Text style={styles.settingTitle}>YouTube holati tekshirilmoqda...</Text>
                  <Text style={styles.settingSub}>Iltimos kuting</Text>
                </View>
              </View>
              <ActivityIndicator size="small" color="rgba(255, 255, 255, 0.5)" />
            </View>
          ) : ytChannelInfo ? (
            /* ─── Connected State ─── */
            <View style={[styles.settingItem, { borderColor: 'rgba(0, 255, 102, 0.3)' }]}>
              <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
              <View style={styles.settingLeft}>
                {ytChannelInfo.thumbnail ? (
                  <Image
                    source={{ uri: ytChannelInfo.thumbnail }}
                    style={styles.ytAvatar}
                  />
                ) : (
                  <View style={[styles.settingIcon, { backgroundColor: 'rgba(0, 255, 102, 0.15)' }]}>
                    <Ionicons name="checkmark-circle" size={20} color="#00FF66" />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingTitle} numberOfLines={1}>{ytChannelInfo.title}</Text>
                  <Text style={[styles.settingSub, { color: 'rgba(0, 255, 102, 0.7)' }]}>
                    YouTube kanal ulangan ✓
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.ytDisconnectBtn}
                activeOpacity={0.7}
                onPress={handleDisconnectYouTube}
              >
                <Ionicons name="close-circle" size={16} color="#EF4444" />
                <Text style={styles.ytDisconnectText}>Uzish</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* ─── Not Connected State ─── */
            <TouchableOpacity
              style={styles.settingItem}
              activeOpacity={0.7}
              onPress={handleConnectYouTube}
              disabled={ytConnecting}
            >
              <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />
              <View style={styles.settingLeft}>
                <View style={[styles.settingIcon, { backgroundColor: 'rgba(255, 0, 0, 0.15)' }]}>
                  <Ionicons name="logo-youtube" size={20} color="#FF0000" />
                </View>
                <View>
                  <Text style={styles.settingTitle}>YouTube Kanal Ulash</Text>
                  <Text style={styles.settingSub}>Translyatsiya boshqaruvi uchun</Text>
                </View>
              </View>
              {ytConnecting ? (
                <ActivityIndicator size="small" color="#FF0000" />
              ) : (
                <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.4)" />
              )}
            </TouchableOpacity>
          )}

          <Text style={styles.ytInfoText}>
            YouTube kanalini ulash orqali translyatsiya oblojkalarini avtomatik yangilash va jonli efirlarni boshqarish imkoniyatiga ega bo'lasiz.
            {'\n\n'}Kanal ma'lumotlari serverda saqlanadi — ilovani qayta o'rnatganingizda ham uzilmaydi.
          </Text>
        </>
      )}

      {/* App Info */}
      <Text style={styles.sectionHeader}>Ilova haqida</Text>
      <View style={styles.infoBox}>
        <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
        <Text style={styles.infoText}>{"Ilova: AMATORA Admin"}</Text>
        <Text style={styles.infoText}>{`Versiya: ${APP_VERSION}`}</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  screenTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  screenSub: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    marginTop: 2,
  },
  sectionHeader: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 14,
    marginTop: 8,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    marginBottom: 12,
    overflow: 'hidden',
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  settingIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  settingSub: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 11,
    marginTop: 2,
  },
  infoBox: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 16,
    padding: 16,
    gap: 6,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  infoText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 12,
    fontWeight: '600',
  },
  // ─── YouTube-specific styles ──────────────────────────────────────
  ytAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 255, 102, 0.4)',
  },
  ytDisconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  ytDisconnectText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '700',
  },
  ytInfoText: {
    color: 'rgba(255, 255, 255, 0.35)',
    fontSize: 11,
    lineHeight: 16,
    paddingHorizontal: 4,
    marginBottom: 20,
  },
});
