import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity, DeviceEventEmitter } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';
import { BlurView } from 'expo-blur';
import { useOrg } from '../context/OrgContext';
import { supabaseAdmin, supabase } from '../supabaseClient';
import pkg from '../../package.json';

const APP_VERSION = `v${pkg.version}`;

interface SettingsScreenProps {
  onGoBack?: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onGoBack }) => {
  const { currentOrg } = useOrg();
  const [biometricsEnabled, setBiometricsEnabled] = useState(true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [hasPin, setHasPin] = useState(false);

  useEffect(() => {
    checkPin();
  }, []);

  const checkPin = async () => {
    const p = await AsyncStorage.getItem('@amatora_pin_code');
    setHasPin(!!p);
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
      'Rostdan ham joriy PIN kodni o\'chirib tashlamoqchimisiz? Keyingi safar ilovaga kirganingizda yangi PIN kod o\'rnatishingiz so\'raladi.',
      [
        { text: 'Bekor qilish', style: 'cancel' },
        {
          text: 'O\'chirish',
          style: 'destructive',
          onPress: async () => {
            try {
              // 1. Delete locally
              await AsyncStorage.removeItem('@amatora_pin_code');
              
              // 2. Delete from database
              if (currentOrg?.id) {
                const dbClient = supabaseAdmin || supabase;
                await dbClient.from('organizations').update({ app_pin_code: null }).eq('id', currentOrg.id);
              }

              setHasPin(false);
              // Do NOT emit app_pin_reset so it doesn't jump to PinScreen
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
          onValueChange={setBiometricsEnabled}
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
          onValueChange={setNotificationsEnabled}
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
