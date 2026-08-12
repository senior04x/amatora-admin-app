import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, DeviceEventEmitter, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Notifications from 'expo-notifications';
import { useOrg } from '../context/OrgContext';
import { supabaseAdmin, supabase } from '../supabaseClient';
import pkg from '../../package.json';

const APP_VERSION = `v${pkg.version}`;

interface SettingsScreenProps {
  onGoBack?: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onGoBack }) => {
  const { currentOrg } = useOrg();
  const [biometricsEnabled, setBiometricsEnabled] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
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
    const p = await AsyncStorage.getItem('@amatora_pin_code');
    setHasPin(!!p);
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

      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Biometrik parolni yoqish uchun tasdiqlang',
        disableDeviceFallback: true,
      });

      if (res.success) {
        setBiometricsEnabled(true);
        await AsyncStorage.setItem('@amatora_biometrics_enabled', 'true');
      } else {
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
            const dbClient = supabaseAdmin || supabase;
            dbClient
              .from('organizations')
              .update({ push_token: tokenData.data })
              .eq('id', currentOrg.id)
              .catch(() => {});
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
    if (hasPin) {
      DeviceEventEmitter.emit('app_pin_edit');
    } else {
      DeviceEventEmitter.emit('app_pin_reset');
    }
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
              // 1. Delete locally INSTANTLY
              await AsyncStorage.removeItem('@amatora_pin_code');
              await AsyncStorage.setItem('@amatora_biometrics_enabled', 'false');
              setHasPin(false);
              setBiometricsEnabled(false);
              DeviceEventEmitter.emit('app_pin_changed');
              
              // 2. Delete from database in background non-blockingly
              if (currentOrg?.id) {
                const dbClient = supabaseAdmin || supabase;
                dbClient
                  .from('organizations')
                  .update({ app_pin_code: null })
                  .eq('id', currentOrg.id)
                  .catch((err) => console.log('Error deleting pin from DB:', err));
              }
            } catch (e) {
              Alert.alert('Xatolik', 'PIN kodni o\'chirishda xatolik yuz berdi.');
            }
          }
        }
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 100 }}>
      {/* Header Row with Back Button */}
      <View style={styles.headerRow}>
        {onGoBack && (
          <TouchableOpacity style={styles.backBtn} activeOpacity={0.8} onPress={onGoBack}>
            <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.screenTitle}>Sozlamalar</Text>
          <Text style={styles.screenSub}>Mobil ilova va xavfsizlik</Text>
        </View>
      </View>

      {/* Security Section */}
      <Text style={styles.sectionHeader}>Xavfsizlik & Kirish</Text>

      <View style={styles.settingItem}>
        <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
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
        <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
        <View style={styles.settingLeft}>
          <View style={[styles.settingIcon, { backgroundColor: 'rgba(255, 255, 255, 0.1)' }]}>
            <Ionicons name="notifications" size={20} color="#FFFFFF" />
          </View>
          <View>
            <Text style={styles.settingTitle}>Push Bildirishnomalar</Text>
            <Text style={styles.settingSub}>Yangi arizalar va transfer xabarlari</Text>
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
            <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
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
            <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
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
          <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
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
});
