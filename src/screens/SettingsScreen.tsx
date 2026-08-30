import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, DeviceEventEmitter, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from '../components/SafeBlurView';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import { useOrg } from '../context/OrgContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../supabaseClient';
import { hasSecurePin, deleteSecurePin } from '../utils/securePin';
import pkg from '../../package.json';

const APP_VERSION = `v${pkg.version}`;

interface SettingsScreenProps {
  onGoBack?: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onGoBack }) => {
  const { currentOrg, orgId, userRole, showToast } = useOrg();
  const { isDark, colors, themeMode, setThemeMode } = useTheme();
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [hasPin, setHasPin] = useState(false);

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
    <ScrollView
      style={[styles.container, Platform.OS === 'android' && { backgroundColor: colors.bgPrimary }]}
      contentContainerStyle={{ paddingBottom: 100 }}
    >
      {/* Header Row with Back Button */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={[styles.backBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
          activeOpacity={0.7}
          onPress={onNavigateBack}
        >
          <Ionicons name="arrow-back" size={22} color={Platform.OS === 'android' ? colors.textPrimary : "#FFFFFF"} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>Sozlamalar</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Security Section */}
      <Text style={[styles.sectionHeader, Platform.OS === 'android' && { color: colors.textPrimary }]}>Xavfsizlik & Kirish</Text>

      <View style={[styles.settingItem, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        {Platform.OS === 'ios' && <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />}
        <View style={styles.settingLeft}>
          <View style={[styles.settingIcon, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : '#E0F2FE' }]}>
            <Ionicons name="finger-print" size={20} color={Platform.OS === 'android' ? colors.accentGreen : "#FFFFFF"} />
          </View>
          <View>
            <Text style={[styles.settingTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>Face ID / Barmoq Izi</Text>
            <Text style={[styles.settingSub, Platform.OS === 'android' && { color: colors.textMuted }]}>Ilovaga kirishda biometriya so'rash</Text>
          </View>
        </View>
        <Switch
          value={biometricsEnabled}
          onValueChange={toggleBiometrics}
          trackColor={{ false: Platform.OS === 'android' ? colors.border : 'rgba(255, 255, 255, 0.1)', true: colors.accentGreen }}
          thumbColor={biometricsEnabled ? '#FFFFFF' : '#94A3B8'}
        />
      </View>

      <View style={[styles.settingItem, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        {Platform.OS === 'ios' && <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />}
        <View style={styles.settingLeft}>
          <View style={[styles.settingIcon, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : '#FEF3C7' }]}>
            <Ionicons name="notifications" size={20} color={Platform.OS === 'android' ? '#F59E0B' : "#FFFFFF"} />
          </View>
          <View>
            <Text style={[styles.settingTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>Bildirishnomalar</Text>
            <Text style={[styles.settingSub, Platform.OS === 'android' && { color: colors.textMuted }]}>Tizim xabarlari va eslatmalar</Text>
          </View>
        </View>
        <Switch
          value={notificationsEnabled}
          onValueChange={toggleNotifications}
          trackColor={{ false: Platform.OS === 'android' ? colors.border : 'rgba(255, 255, 255, 0.1)', true: colors.accentGreen }}
          thumbColor={notificationsEnabled ? '#FFFFFF' : '#94A3B8'}
        />
      </View>

      {hasPin ? (
        <>
          <TouchableOpacity
            style={[styles.settingItem, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
            activeOpacity={0.7}
            onPress={handleSetOrEditPin}
          >
            {Platform.OS === 'ios' && <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <View style={styles.settingLeft}>
              <View style={[styles.settingIcon, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : '#E2E8F0' }]}>
                <Ionicons name="keypad" size={20} color={Platform.OS === 'android' ? colors.textPrimary : "#FFFFFF"} />
              </View>
              <View>
                <Text style={[styles.settingTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>PIN kodni tahrirlash</Text>
                <Text style={[styles.settingSub, Platform.OS === 'android' && { color: colors.textMuted }]}>Yangi PIN kod o'rnatish</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255, 255, 255, 0.4)"} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.settingItem,
              { borderColor: 'rgba(239, 68, 68, 0.3)' },
              Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.08)' : '#FEF2F2', borderColor: '#EF4444' }
            ]}
            activeOpacity={0.7}
            onPress={handleResetPin}
          >
            {Platform.OS === 'ios' && <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            <View style={styles.settingLeft}>
              <View style={[styles.settingIcon, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                <Ionicons name="trash" size={20} color="#EF4444" />
              </View>
              <View>
                <Text style={[styles.settingTitle, { color: '#EF4444' }]}>PIN kodni o'chirish</Text>
                <Text style={[styles.settingSub, Platform.OS === 'android' && { color: colors.textMuted }]}>Kirish kodini olib tashlash</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#EF4444" />
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity
          style={[styles.settingItem, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
          activeOpacity={0.7}
          onPress={handleSetOrEditPin}
        >
          {Platform.OS === 'ios' && <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />}
          <View style={styles.settingLeft}>
            <View style={[styles.settingIcon, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : '#E2E8F0' }]}>
              <Ionicons name="keypad" size={20} color={Platform.OS === 'android' ? colors.textPrimary : "#FFFFFF"} />
            </View>
            <View>
              <Text style={[styles.settingTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>PIN kod o'rnatish</Text>
              <Text style={[styles.settingSub, Platform.OS === 'android' && { color: colors.textMuted }]}>Xavfsizlik uchun kod o'rnating</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255, 255, 255, 0.4)"} />
        </TouchableOpacity>
      )}

      {/* ─── Theme / Appearance Section (Android Only) ─────── */}
      {Platform.OS === 'android' && (
        <>
          <Text style={[styles.sectionHeader, { color: colors.textPrimary }]}>Tashqi Ko'rinish & Mavzu</Text>
          <View style={[styles.themeBoxContainer, { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            <View style={styles.themeHeaderRow}>
              <View style={[styles.settingIcon, { backgroundColor: isDark ? 'rgba(250, 204, 21, 0.15)' : '#FEF3C7' }]}>
                <Ionicons
                  name={themeMode === 'system' ? "phone-portrait-outline" : isDark ? "moon" : "sunny"}
                  size={20}
                  color={isDark ? '#FACC15' : '#D97706'}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.settingTitle, { color: colors.textPrimary }]}>Ilova Mavzusi</Text>
                <Text style={[styles.settingSub, { color: colors.textMuted }]}>
                  {themeMode === 'system'
                    ? "Qurilma tizim sozlamasiga moslashgan (Avtomatik)"
                    : themeMode === 'dark'
                    ? "Tungi qorong'i rejim faol"
                    : "Kunduzgi yorug' rejim faol"}
                </Text>
              </View>
            </View>

            {/* 3-Way Segment Selector: Avtomatik, Qorong'i, Kunduzgi */}
            <View style={[styles.themeSegmentTrack, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : '#E2E8F0', borderColor: colors.border }]}>
              {/* Option 1: System / Avtomatik */}
              <TouchableOpacity
                style={[
                  styles.themeSegmentBtn,
                  themeMode === 'system' && [styles.themeSegmentBtnActive, { backgroundColor: colors.bgCardElevated }],
                ]}
                onPress={() => setThemeMode('system')}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="phone-portrait-outline"
                  size={15}
                  color={themeMode === 'system' ? colors.accentGreen : colors.textMuted}
                />
                <Text
                  style={[
                    styles.themeSegmentText,
                    { color: colors.textSecondary },
                    themeMode === 'system' && [styles.themeSegmentTextActive, { color: colors.textPrimary }],
                  ]}
                >
                  {"Avtomatik"}
                </Text>
              </TouchableOpacity>

              {/* Option 2: Dark / Qorong'i */}
              <TouchableOpacity
                style={[
                  styles.themeSegmentBtn,
                  themeMode === 'dark' && [styles.themeSegmentBtnActive, { backgroundColor: colors.bgCardElevated }],
                ]}
                onPress={() => setThemeMode('dark')}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="moon"
                  size={15}
                  color={themeMode === 'dark' ? '#FACC15' : colors.textMuted}
                />
                <Text
                  style={[
                    styles.themeSegmentText,
                    { color: colors.textSecondary },
                    themeMode === 'dark' && [styles.themeSegmentTextActive, { color: colors.textPrimary }],
                  ]}
                >
                  {"Qorong'i"}
                </Text>
              </TouchableOpacity>

              {/* Option 3: Light / Kunduzgi */}
              <TouchableOpacity
                style={[
                  styles.themeSegmentBtn,
                  themeMode === 'light' && [styles.themeSegmentBtnActive, { backgroundColor: colors.bgCardElevated }],
                ]}
                onPress={() => setThemeMode('light')}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="sunny"
                  size={15}
                  color={themeMode === 'light' ? '#F59E0B' : colors.textMuted}
                />
                <Text
                  style={[
                    styles.themeSegmentText,
                    { color: colors.textSecondary },
                    themeMode === 'light' && [styles.themeSegmentTextActive, { color: colors.textPrimary }],
                  ]}
                >
                  {"Kunduzgi"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}

      {/* App Info */}
      <Text style={[styles.sectionHeader, Platform.OS === 'android' && { color: colors.textPrimary }]}>Ilova haqida</Text>
      <View style={[styles.infoBox, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        {Platform.OS === 'ios' && <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
        <Text style={[styles.infoText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Ilova: AMATORA Admin"}</Text>
        <Text style={[styles.infoText, Platform.OS === 'android' && { color: colors.textMuted }]}>{`Versiya: ${APP_VERSION}`}</Text>
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
  // ─── Theme Selector styles ──────────────────────────────────────
  themeBoxContainer: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.2,
    gap: 12,
    marginBottom: 12,
  },
  themeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  themeSegmentTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 3,
    borderWidth: 1,
    gap: 4,
  },
  themeSegmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
  },
  themeSegmentBtnActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  themeSegmentText: {
    fontSize: 12,
    fontWeight: '700',
  },
  themeSegmentTextActive: {
    fontWeight: '900',
  },
});
