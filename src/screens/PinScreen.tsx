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
import { supabase, supabaseAdmin } from '../supabaseClient';

interface PinScreenProps {
  onSuccess: () => void;
  onReset?: () => void;
  action?: 'login' | 'edit';
}

type PinMode = 'checking' | 'create' | 'confirm' | 'verify';

const PIN_LENGTH = 4;
const PIN_KEY = '@amatora_pin_code';

export const PinScreen: React.FC<PinScreenProps> = ({ onSuccess, onReset, action = 'login' }) => {
  const [mode, setMode] = useState<PinMode>('checking');
  const [pin, setPin] = useState<string>('');
  const [tempPin, setTempPin] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [showResetOption, setShowResetOption] = useState<boolean>(false);

  useEffect(() => {
    checkExistingPin();
  }, []);

  const checkExistingPin = async () => {
    try {
      const storedPin = await AsyncStorage.getItem(PIN_KEY);
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
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware) {
        Alert.alert('Biometriya', 'Qurilmangizda biometrik apparat (Face ID / Barmoq izi) topilmadi.');
        return;
      }

      if (!isEnrolled) {
        Alert.alert('Biometriya', 'Qurilma sozlamalarida Face ID / Barmoq izi sozlanmagan.');
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'AMATORA Admin ilovasiga kirish',
        fallbackLabel: '',
        cancelLabel: 'Bekor qilish',
      });

      if (result.success) {
        onSuccess();
      } else if (result.error && result.error !== 'user_cancel' && result.error !== 'app_cancel') {
        Alert.alert('Face ID Xatoligi', `Xatolik turi: ${result.error}`);
      }
    } catch (err: any) {
      console.log('Biometric auth error:', err);
      Alert.alert('Xatolik', err?.message || 'Biometriyadan foydalanishda xatolik yuz berdi');
    }
  };

  const handleKeyPress = (val: string) => {
    if (pin.length < PIN_LENGTH) {
      const newPin = pin + val;
      setPin(newPin);
      setErrorMsg('');

      if (newPin.length === PIN_LENGTH) {
        setTimeout(() => handlePinComplete(newPin), 200);
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
      'PIN kodni o\'chirish',
      'Joriy PIN kod o\'chiriladi va tizimga qayta kirishingiz kerak bo\'ladi. Davom etasizmi?',
      [
        { text: 'Bekor qilish', style: 'cancel' },
        {
          text: 'O\'chirish',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.removeItem(PIN_KEY);
              await AsyncStorage.setItem('@amatora_biometrics_enabled', 'false');
              DeviceEventEmitter.emit('app_pin_changed');
              DeviceEventEmitter.emit('app_pin_reset');
              
              const { data: { session } } = await supabase.auth.getSession();
              const dbClient = supabaseAdmin || supabase;
              if (session?.user?.email) {
                await dbClient
                  .from('organizations')
                  .update({ app_pin_code: null })
                  .eq('admin_email', session.user.email)
                  .catch(() => {});
              }

              if (onReset) {
                onReset();
              } else {
                await supabase.auth.signOut();
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
        // Success: save PIN locally INSTANTLY
        try {
          await AsyncStorage.setItem(PIN_KEY, enteredPin);
          DeviceEventEmitter.emit('app_pin_changed');

          // Sync with DB in the background non-blockingly
          (async () => {
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (session?.user?.email) {
                const dbClient = supabaseAdmin || supabase;
                await dbClient.from('organizations').update({ app_pin_code: enteredPin }).eq('admin_email', session.user.email);
              }
            } catch (bgErr) {
              console.log('Background DB PIN sync error:', bgErr);
            }
          })();

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
                    const authRes = await LocalAuthentication.authenticateAsync({
                      promptMessage: 'Biometriyani tasdiqlang',
                      disableDeviceFallback: true,
                    });
                    if (authRes.success) {
                      await AsyncStorage.setItem('@amatora_biometrics_enabled', 'true');
                      DeviceEventEmitter.emit('app_biometrics_changed');
                    } else {
                      await AsyncStorage.setItem('@amatora_biometrics_enabled', 'false');
                    }
                    onSuccess();
                  },
                },
              ],
              { cancelable: false }
            );
          } else {
            onSuccess();
          }
        } catch (err) {
          setErrorMsg('PIN kod saqlashda xatolik');
          setPin('');
        }
      } else {
        // Mismatch
        Vibration.vibrate(400);
        setErrorMsg('PIN kod mos kelmadi, qayta urinib ko\'ring');
        setPin('');
        setMode('create');
        setTempPin('');
      }
    } else if (mode === 'verify') {
      try {
        const storedPin = await AsyncStorage.getItem(PIN_KEY);
        if (enteredPin === storedPin) {
          if (action === 'edit') {
            setMode('create');
            setPin('');
            setErrorMsg('');
            setShowResetOption(false);
          } else {
            onSuccess();
          }
        } else {
          Vibration.vibrate(400);
          setErrorMsg('PIN kod noto\'g\'ri');
          setShowResetOption(true);
          setPin('');
        }
      } catch (err) {
        setErrorMsg('PIN kod o\'qishda xatolik');
        setPin('');
      }
    }
  };

  const handleSkip = () => {
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
                style={styles.resetPinBtn}
                activeOpacity={0.75}
                onPress={handleForgotOrResetPin}
              >
                <Ionicons name="trash-outline" size={16} color="#EF4444" />
                <Text style={styles.resetPinBtnText}>PIN kodni o'chirish</Text>
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
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  resetPinBtnText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '700',
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
