import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Vibration,
  ImageBackground,
  DeviceEventEmitter,
  Alert,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
const FaceIdIcon = ({ size = 28, color = '#FFFFFF' }) => (
  <Ionicons name="scan-outline" size={size} color={color} />
);
import * as LocalAuthentication from 'expo-local-authentication';
import { supabase } from '../supabaseClient';
import { getSecurePin, saveSecurePin, deleteSecurePin } from '../utils/securePin';

interface PinScreenProps {
  onSuccess: () => void;
  onReset?: () => void;
  action?: 'login' | 'edit';
}

type PinMode = 'checking' | 'create' | 'confirm' | 'verify';

const PIN_LENGTH = 4;

export const PinScreen: React.FC<PinScreenProps> = ({ onSuccess, onReset, action = 'login' }) => {
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
        Vibration.vibrate(400);
        setErrorMsg('PIN kodlar mos kelmadi!');
        setPin('');
        setTempPin('');
        setMode('create');
      }
    } else if (mode === 'verify') {
      try {
        const storedPin = await getSecurePin();
        if (enteredPin === storedPin) {
          setErrorMsg('');
          setPin('');
          setAttempts(0);
          onSuccess();
        } else {
          Vibration.vibrate(400);
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
    <View style={styles.container}>
      <StatusBar style="light" />
      <ImageBackground
        source={{
          uri: 'https://images.unsplash.com/photo-1518605368461-1ee7c532066d?q=80&w=2000&auto=format&fit=crop',
        }}
        style={styles.bgImage}
      >
        <BlurView intensity={70} tint="dark" style={styles.blurOverlay}>
          {/* Top Bar for Skip Button */}
          <View style={styles.topBar}>
            {mode !== 'verify' && (
              <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} activeOpacity={0.7}>
                <Text style={styles.skipBtnText}>O'tkazib yuborish</Text>
                <Ionicons name="arrow-forward" size={16} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.content}>
            <View style={styles.header}>
              <Ionicons name="lock-closed-outline" size={42} color="#FFFFFF" style={styles.lockIcon} />
              <Text style={styles.title}>
                {mode === 'create' && 'PIN KOD O\'RNATING'}
                {mode === 'confirm' && 'QAYTA KIRITING'}
                {mode === 'verify' && 'PIN KODNI KIRITING'}
              </Text>
              <Text style={styles.subtitle}>
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
                    pin.length > i ? styles.dotFilled : styles.dotEmpty,
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
                  style={styles.keyBtn}
                  activeOpacity={0.6}
                  onPress={() => handleKeyPress(num)}
                >
                  <Text style={styles.keyText}>{num}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.keyBtnEmpty}
                activeOpacity={0.6}
                onPress={handleBiometricAuth}
              >
                <FaceIdIcon size={28} color="#FFFFFF" />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.keyBtn}
                activeOpacity={0.6}
                onPress={() => handleKeyPress('0')}
              >
                <Text style={styles.keyText}>0</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.keyBtnEmpty}
                activeOpacity={0.6}
                onPress={handleDelete}
              >
                <Ionicons name="backspace-outline" size={28} color="#FFFFFF" />
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
        </BlurView>
      </ImageBackground>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
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
  bgImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  blurOverlay: {
    flex: 1,
  },
  topBar: {
    marginTop: 60,
    paddingHorizontal: 24,
    height: 40,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    zIndex: 10,
  },
  skipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
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
    marginTop: -80,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  lockIcon: {
    marginBottom: 16,
    opacity: 0.9,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
    marginBottom: 12,
  },
  subtitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 20,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  dotEmpty: {
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'transparent',
  },
  dotFilled: {
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
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
    marginBottom: 30,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    width: 280,
    gap: 16,
  },
  keyBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  keyBtnEmpty: {
    width: 76,
    height: 76,
    justifyContent: 'center',
    alignItems: 'center',
  },
  keyText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '400',
  },
});
