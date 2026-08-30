import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  DeviceEventEmitter,
  Alert,
  Platform,
} from 'react-native';
import { BlurView } from '../components/SafeBlurView';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import * as LocalAuthentication from 'expo-local-authentication';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../supabaseClient';
import { getSecurePin, saveSecurePin, deleteSecurePin } from '../utils/securePin';

const FaceIdIcon = ({ size = 28, color = '#FFFFFF' }) => (
  <Ionicons name="scan-outline" size={size} color={color} />
);

interface PinScreenProps {
  onSuccess: () => void;
  onReset?: () => void;
  action?: 'login' | 'edit';
}

type PinMode = 'checking' | 'create' | 'confirm' | 'verify';

const PIN_LENGTH = 4;

export const PinScreen: React.FC<PinScreenProps> = ({ onSuccess, onReset, action = 'login' }) => {
  const { isDark, colors } = useTheme();
  const [mode, setMode] = useState<PinMode>('checking');
  const [pin, setPin] = useState<string>('');
  const [tempPin, setTempPin] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [attempts, setAttempts] = useState<number>(0);
  const [showResetOption, setShowResetOption] = useState<boolean>(false);

  useEffect(() => {
    checkExistingPin();
  }, []);

  const checkExistingPin = async () => {
    try {
      if (action === 'edit') {
        setMode('create');
        return;
      }
      const storedPin = await getSecurePin();
      if (storedPin) {
        setMode('verify');
        const bioEnabled = await AsyncStorage.getItem('@amatora_biometrics_enabled');
        if (bioEnabled === 'true') {
          setTimeout(() => {
            handleBiometricAuth();
          }, 350);
        }
      } else {
        setMode('create');
      }
    } catch (err) {
      setMode('create');
    }
  };

  const handleBiometricAuth = async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware || !isEnrolled) return;

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'AMATORA Admin ilovasiga kirish',
        fallbackLabel: '',
        cancelLabel: 'Bekor qilish',
      });

      if (result.success) {
        onSuccess();
      }
    } catch (err: any) {
      console.log('Biometric auth error:', err);
    }
  };

  const handleKeyPress = (val: string) => {
    if (pin.length < PIN_LENGTH) {
      const newPin = pin + val;
      setPin(newPin);
      setErrorMsg('');

      if (newPin.length === PIN_LENGTH) {
        setTimeout(() => handlePinComplete(newPin), 180);
      }
    }
  };

  const handleDelete = () => {
    if (pin.length > 0) {
      setPin(pin.slice(0, -1));
      setErrorMsg('');
    }
  };

  const handleForgotOrResetPin = () => {
    Alert.alert(
      "PIN kodni o'chirish",
      "Qurilmadagi PIN kod o'chiriladi va Login sahifasiga qaytasiz. Davom etasizmi?",
      [
        { text: 'Bekor qilish', style: 'cancel' },
        {
          text: "O'chirish va Tizimdan chiqish",
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteSecurePin();
              await AsyncStorage.setItem('@amatora_biometrics_enabled', 'false');
              await AsyncStorage.removeItem('@amatora_pin_skipped');
              DeviceEventEmitter.emit('app_pin_changed');
              DeviceEventEmitter.emit('app_pin_reset');

              await supabase.auth.signOut().catch(() => {});

              if (onReset) {
                onReset();
              }
            } catch (e) {
              console.log('Error deleting pin:', e);
            }
          },
        },
      ]
    );
  };

  const handlePinComplete = async (enteredPin: string) => {
    if (mode === 'create') {
      setTempPin(enteredPin);
      setPin('');
      setMode('confirm');
    } else if (mode === 'confirm') {
      if (enteredPin === tempPin) {
        // Success: save PIN in hardware-encrypted secure store
        try {
          await saveSecurePin(enteredPin);
          await AsyncStorage.removeItem('@amatora_pin_skipped');
          DeviceEventEmitter.emit('app_pin_changed');

          // Prompt for Biometrics enrollment if device supports hardware
          const hasHardware = await LocalAuthentication.hasHardwareAsync();
          const isEnrolled = await LocalAuthentication.isEnrolledAsync();

          if (hasHardware && isEnrolled) {
            Alert.alert(
              'Face ID / Barmoq Izi',
              'Ilovaga tez va xavfsiz kirish uchun biometrik paroldan foydalanishni xohlaysizmi?',
              [
                {
                  text: 'Yo\'q',
                  style: 'cancel',
                  onPress: async () => {
                    await AsyncStorage.setItem('@amatora_biometrics_enabled', 'false');
                    onSuccess();
                  },
                },
                {
                  text: 'Ha, yoqish',
                  onPress: async () => {
                    await AsyncStorage.setItem('@amatora_biometrics_enabled', 'true');
                    onSuccess();
                  },
                },
              ]
            );
          } else {
            await AsyncStorage.setItem('@amatora_biometrics_enabled', 'false');
            onSuccess();
          }
        } catch (err) {
          setErrorMsg('PIN kodni saqlashda xatolik');
          setPin('');
        }
      } else {
        setErrorMsg('PIN kodlar mos kelmadi. Qaytadan urinib ko\'ring');
        setPin('');
        setTempPin('');
        setMode('create');
      }
    } else if (mode === 'verify') {
      try {
        const storedPin = await getSecurePin();
        if (enteredPin === storedPin) {
          onSuccess();
        } else {
          const nextAttempts = attempts + 1;
          setAttempts(nextAttempts);
          setPin('');

          if (nextAttempts >= 3) {
            setErrorMsg('3 marta noto\'g\'ri kiritildi! PIN kodni o\'chirib qayta kiring.');
            setShowResetOption(true);
          } else {
            setErrorMsg(`PIN kod noto'g'ri (${3 - nextAttempts} ta urinish qoldi)`);
            setShowResetOption(true);
          }
        }
      } catch (err) {
        setErrorMsg('PIN kod o\'qishda xatolik');
        setPin('');
      }
    }
  };

  const handleSkip = async () => {
    try {
      await AsyncStorage.setItem('@amatora_pin_skipped', 'true');
    } catch (e) {}
    onSuccess();
  };

  if (mode === 'checking') return null;

  return (
    <View style={[styles.container, Platform.OS === 'android' && { backgroundColor: colors.bgPrimary }]}>
      <StatusBar style={Platform.OS === 'android' ? (isDark ? 'light' : 'dark') : 'light'} />
      
      {Platform.OS === 'ios' && (
        <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFillObject} pointerEvents="none" />
      )}

      {/* Top Bar for Back / Skip Button */}
      <View style={styles.topBar}>
        {action === 'edit' ? (
          <TouchableOpacity
            style={[styles.backBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
            onPress={onSuccess}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={20} color={Platform.OS === 'android' ? colors.textPrimary : '#FFFFFF'} />
            <Text style={[styles.backBtnText, Platform.OS === 'android' && { color: colors.textPrimary }]}>Ortga</Text>
          </TouchableOpacity>
        ) : mode !== 'verify' ? (
          <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} activeOpacity={0.7}>
            <Text style={[styles.skipBtnText, Platform.OS === 'android' && { color: colors.textMuted }]}>O'tkazib yuborish</Text>
            <Ionicons name="arrow-forward" size={16} color={Platform.OS === 'android' ? colors.textMuted : "rgba(255,255,255,0.6)"} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.content}>
        <View style={styles.header}>
          <Ionicons
            name="lock-closed-outline"
            size={42}
            color={Platform.OS === 'android' ? colors.accentGreen : "#FFFFFF"}
            style={styles.lockIcon}
          />
          <Text style={[styles.title, Platform.OS === 'android' && { color: colors.textPrimary }]}>
            {mode === 'create' && 'PIN KOD O\'RNATING'}
            {mode === 'confirm' && 'QAYTA KIRITING'}
            {mode === 'verify' && 'PIN KODNI KIRITING'}
          </Text>
          <Text style={[styles.subtitle, Platform.OS === 'android' && { color: colors.textMuted }]}>
            {mode === 'create' && 'Ilovaga tez kirish uchun 4 xonali raqam o\'rnating'}
            {mode === 'confirm' && 'Tasdiqlash uchun xuddi shu PIN kodni kiriting'}
            {mode === 'verify' && 'Ilovaga kirish uchun xavfsizlik kodini kiriting'}
          </Text>
        </View>

        {/* Dots */}
        <View style={styles.dotsRow}>
          {[...Array(PIN_LENGTH)].map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                pin.length > i
                  ? [styles.dotFilled, Platform.OS === 'android' && { backgroundColor: colors.accentGreen, borderColor: colors.accentGreen }]
                  : [styles.dotEmpty, Platform.OS === 'android' && { borderColor: colors.border }],
                errorMsg ? styles.dotError : null,
              ]}
            />
          ))}
        </View>

        {/* Error Message */}
        <Text style={styles.errorText}>{errorMsg}</Text>

        {/* Keypad */}
        <View style={styles.keypad}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
            <TouchableOpacity
              key={num}
              style={[styles.keyBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
              activeOpacity={0.6}
              onPress={() => handleKeyPress(num)}
            >
              <Text style={[styles.keyText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{num}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.keyBtnEmpty}
            activeOpacity={0.6}
            onPress={handleBiometricAuth}
          >
            <FaceIdIcon size={28} color={Platform.OS === 'android' ? colors.accentGreen : "#FFFFFF"} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.keyBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}
            activeOpacity={0.6}
            onPress={() => handleKeyPress('0')}
          >
            <Text style={[styles.keyText, Platform.OS === 'android' && { color: colors.textPrimary }]}>0</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.keyBtnEmpty}
            activeOpacity={0.6}
            onPress={handleDelete}
          >
            <Ionicons name="backspace-outline" size={28} color={Platform.OS === 'android' ? colors.textPrimary : "#FFFFFF"} />
          </TouchableOpacity>
        </View>

        {/* Reset PIN Option on Incorrect PIN */}
        {showResetOption && mode === 'verify' && (
          <TouchableOpacity
            style={[
              styles.resetPinBtn,
              attempts >= 3 && styles.resetPinBtnUrgent,
            ]}
            activeOpacity={0.75}
            onPress={handleForgotOrResetPin}
          >
            <Ionicons name="trash-outline" size={17} color="#FFFFFF" />
            <Text style={styles.resetPinBtnText}>
              {attempts >= 3 ? "PIN kodni o'chirish va Tizimdan chiqish" : "PIN kodni esdan chiqardingizmi?"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F17',
  },
  topBar: {
    marginTop: 54,
    paddingHorizontal: 20,
    height: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  backBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  skipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    marginLeft: 'auto',
  },
  skipBtnText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginTop: -40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  lockIcon: {
    marginBottom: 14,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 19,
    paddingHorizontal: 20,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 18,
    marginBottom: 16,
  },
  dot: {
    width: 15,
    height: 15,
    borderRadius: 7.5,
    borderWidth: 1.5,
  },
  dotEmpty: {
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'transparent',
  },
  dotFilled: {
    borderColor: '#00FF87',
    backgroundColor: '#00FF87',
  },
  dotError: {
    borderColor: '#EF4444',
    backgroundColor: '#EF4444',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
    height: 20,
    marginBottom: 24,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    width: 280,
    gap: 16,
  },
  keyBtn: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  keyBtnEmpty: {
    width: 74,
    height: 74,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyText: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '600',
  },
  resetPinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 22,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  resetPinBtnUrgent: {
    backgroundColor: '#EF4444',
    borderColor: '#EF4444',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
  },
  resetPinBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '800',
  },
});
