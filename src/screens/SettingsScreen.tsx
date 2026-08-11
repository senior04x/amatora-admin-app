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
            <Ionicons name="chevron-back" size={20} color="#00FF87" />
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
        <View style={styles.settingLeft}>
          <View style={[styles.settingIcon, { backgroundColor: 'rgba(0, 255, 102, 0.15)' }]}>
            <Ionicons name="finger-print" size={20} color="#00FF66" />
          </View>
          <View>
            <Text style={styles.settingTitle}>Face ID / Barmoq Izi</Text>
            <Text style={styles.settingSub}>Ilovaga kirishda biometriya so'rash</Text>
          </View>
        </View>
        <Switch
          value={biometricsEnabled}
          onValueChange={setBiometricsEnabled}
          trackColor={{ false: '#334155', true: '#059669' }}
          thumbColor={biometricsEnabled ? '#00FF66' : '#94A3B8'}
        />
      </View>

      <View style={styles.settingItem}>
        <View style={styles.settingLeft}>
          <View style={[styles.settingIcon, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
            <Ionicons name="notifications" size={20} color="#3B82F6" />
          </View>
          <View>
            <Text style={styles.settingTitle}>Push Bildirishnomalar</Text>
            <Text style={styles.settingSub}>Yangi arizalar va transfer xabarlari</Text>
          </View>
        </View>
        <Switch
          value={notificationsEnabled}
          onValueChange={setNotificationsEnabled}
          trackColor={{ false: '#334155', true: '#059669' }}
          thumbColor={notificationsEnabled ? '#00FF66' : '#94A3B8'}
        />
      </View>

      {hasPin ? (
        <>
          <TouchableOpacity style={[styles.settingItem, { borderColor: 'rgba(59, 130, 246, 0.3)' }]} activeOpacity={0.7} onPress={handleSetOrEditPin}>
            <View style={styles.settingLeft}>
              <View style={[styles.settingIcon, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
                <Ionicons name="keypad" size={20} color="#3B82F6" />
              </View>
              <View>
                <Text style={[styles.settingTitle, { color: '#3B82F6' }]}>PIN kodni tahrirlash</Text>
                <Text style={styles.settingSub}>Yangi PIN kod o'rnatish</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.2)" />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.settingItem, { borderColor: 'rgba(239, 68, 68, 0.3)' }]} activeOpacity={0.7} onPress={handleResetPin}>
            <View style={styles.settingLeft}>
              <View style={[styles.settingIcon, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                <Ionicons name="trash" size={20} color="#EF4444" />
              </View>
              <View>
                <Text style={[styles.settingTitle, { color: '#EF4444' }]}>PIN kodni o'chirish</Text>
                <Text style={styles.settingSub}>Kirish kodini olib tashlash</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.2)" />
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity style={[styles.settingItem, { borderColor: 'rgba(0, 255, 102, 0.3)' }]} activeOpacity={0.7} onPress={handleSetOrEditPin}>
          <View style={styles.settingLeft}>
            <View style={[styles.settingIcon, { backgroundColor: 'rgba(0, 255, 102, 0.15)' }]}>
              <Ionicons name="keypad" size={20} color="#00FF66" />
            </View>
            <View>
              <Text style={[styles.settingTitle, { color: '#00FF66' }]}>PIN kod o'rnatish</Text>
              <Text style={styles.settingSub}>Xavfsizlik uchun kod o'rnating</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color="rgba(255, 255, 255, 0.2)" />
        </TouchableOpacity>
      )}

      {/* App Info */}
      <Text style={styles.sectionHeader}>Ilova haqida</Text>
      <View style={styles.infoBox}>
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
    backgroundColor: 'rgba(0, 255, 135, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 135, 0.3)',
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
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    marginBottom: 12,
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
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  infoText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 12,
  },
});
