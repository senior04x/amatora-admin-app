import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Vibration,
  ImageBackground,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import Svg, { Path } from 'react-native-svg';

const FaceIdIcon = ({ size = 28, color = '#FFFFFF' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M7 4H6a2 2 0 0 0-2 2v1" />
    <Path d="M17 4h1a2 2 0 0 1 2 2v1" />
    <Path d="M4 17v1a2 2 0 0 0 2 2h1" />
    <Path d="M20 17v1a2 2 0 0 1-2 2h-1" />
    
    <Path d="M9.5 10v1.5" />
    <Path d="M14.5 10v1.5" />
    
    <Path d="M12 11v3.5a1 1 0 0 1-1 1h-.5" />
    
    <Path d="M9.5 16.5c1.2 1.5 3.8 1.5 5 0" />
  </Svg>
);
import { supabase, supabaseAdmin } from '../supabaseClient';

interface PinScreenProps {
  onSuccess: () => void;
  action?: 'login' | 'edit';
}

type PinMode = 'checking' | 'create' | 'confirm' | 'verify';

const PIN_LENGTH = 4;
const PIN_KEY = '@amatora_pin_code';

export const PinScreen: React.FC<PinScreenProps> = ({ onSuccess, action = 'login' }) => {
  const [mode, setMode] = useState<PinMode>('checking');
  const [pin, setPin] = useState<string>('');
  const [tempPin, setTempPin] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    checkExistingPin();
  }, []);

  const checkExistingPin = async () => {
    try {
      const storedPin = await AsyncStorage.getItem(PIN_KEY);
      if (storedPin) {
        setMode('verify');
      } else {
        setMode('create');
      }
    } catch (err) {
      setMode('create');
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

  const handlePinComplete = async (enteredPin: string) => {
    if (mode === 'create') {
      setTempPin(enteredPin);
      setPin('');
      setMode('confirm');
    } else if (mode === 'confirm') {
      if (enteredPin === tempPin) {
        // Success: save PIN
        try {
          await AsyncStorage.setItem(PIN_KEY, enteredPin);
          
          // Sync with DB
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user?.email) {
            const dbClient = supabaseAdmin || supabase;
            await dbClient.from('organizations').update({ app_pin_code: enteredPin }).eq('admin_email', session.user.email);
          }

          onSuccess();
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
          } else {
            onSuccess();
          }
        } else {
          Vibration.vibrate(400);
          setErrorMsg('PIN kod noto\'g\'ri');
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
                onPress={() => {
                  // TODO: Implement FaceID / Biometrics
                }}
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
