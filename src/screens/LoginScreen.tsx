import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
  Modal,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { supabase, supabaseAdmin } from '../supabaseClient';

interface LoginScreenProps {
  onLoginSuccess: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [loginMode, setLoginMode] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // Custom Error Modal state
  const [errorVisible, setErrorVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const showError = (msg: string) => {
    setErrorMessage(msg);
    setErrorVisible(true);
  };

  const handleLogin = async () => {
    const identifier = loginMode === 'email' ? email.trim() : phone.trim();
    if (!identifier || !password.trim()) {
      showError('Iltimos, barcha maydonlarni to\'ldiring!');
      return;
    }

    setLoading(true);
    try {
      const dbClient = supabaseAdmin || supabase;
      let loginEmail = '';

      if (loginMode === 'email') {
        loginEmail = identifier.toLowerCase();
      } else {
        // Find email by phone number from organizations table
        let phoneSearch = identifier.replace(/[^0-9]/g, '');
        if (phoneSearch.startsWith('998')) {
          phoneSearch = phoneSearch.substring(3);
        }
        
        const { data: orgs, error: fetchErr } = await dbClient
          .from('organizations')
          .select('admin_email')
          .ilike('contact_phone', `%${phoneSearch}%`)
          .limit(1);

        if (fetchErr || !orgs || orgs.length === 0 || !orgs[0].admin_email) {
          throw new Error('Bu telefon raqami bilan tashkilot topilmadi!');
        }
        loginEmail = orgs[0].admin_email;
      }

      // 1. First try Supabase Auth (for org_admin or auth registered users)
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: password.trim(),
      });

      if (!authError && authData?.user) {
        // Verify if user is org_admin
        const { data: orgData } = await dbClient
          .from('organizations')
          .select('id')
          .eq('admin_email', loginEmail)
          .limit(1);

        if (orgData && orgData.length > 0) {
          await AsyncStorage.setItem('@amatora_user_role', 'org_admin');
          await AsyncStorage.setItem('@amatora_org_id', orgData[0].id.toString());
          onLoginSuccess();
          return;
        }

        // Check if user is in organization_users table
        const { data: orgUser } = await dbClient
          .from('organization_users')
          .select('*')
          .eq('email', loginEmail)
          .maybeSingle();

        if (orgUser) {
          await AsyncStorage.setItem('@amatora_user_role', orgUser.role || 'user');
          await AsyncStorage.setItem('@amatora_org_id', orgUser.organization_id.toString());
          onLoginSuccess();
          return;
        }
      }

      // 2. Fallback: Check organization_users table directly by email & password
      const { data: directOrgUser } = await dbClient
        .from('organization_users')
        .select('*')
        .eq('email', loginEmail)
        .eq('password', password.trim())
        .maybeSingle();

      if (directOrgUser) {
        await AsyncStorage.setItem('@amatora_user_role', directOrgUser.role || 'user');
        await AsyncStorage.setItem('@amatora_org_id', directOrgUser.organization_id.toString());
        onLoginSuccess();
        return;
      }

      // 3. Fallback: Check admin_users table directly
      const { data: adminUser } = await dbClient
        .from('admin_users')
        .select('*')
        .eq('email', loginEmail)
        .eq('password', password.trim())
        .maybeSingle();

      if (adminUser) {
        await AsyncStorage.setItem('@amatora_user_role', 'org_admin');
        await AsyncStorage.setItem('@amatora_org_id', adminUser.organization_id.toString());
        onLoginSuccess();
        return;
      }

      throw new Error('Noto\'g\'ri parol yoki login!');
    } catch (err: any) {
      console.error('Login error:', err);
      showError(err.message || 'Tizimga kirishda xatolik yuz berdi');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      {/* App-wide background will show through because root is transparent */}

      <KeyboardAvoidingView
        style={styles.kvWrapper}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Branding */}
          <View style={styles.brandingBox}>
            {/* Logo */}
            <Image
              source={require('../../assets/amatora-logo-white.png')}
              style={styles.amatoraLogo}
              resizeMode="contain"
            />
            {/* AMATORA + ADMIN stacked */}
            <View style={styles.titleWrapper}>
              <Text style={styles.brandTitle}>AMATORA</Text>
              <Text style={styles.adminLabel}>ADMIN</Text>
            </View>
          </View>

          {/* Glassmorphism Card */}
          <BlurView intensity={40} tint="dark" style={styles.glassCard}>

            {/* Mode Toggle */}
            <View style={styles.modeToggleRow}>
              <TouchableOpacity
                style={[styles.modeBtn, loginMode === 'email' && styles.modeBtnActive]}
                activeOpacity={0.8}
                onPress={() => setLoginMode('email')}
              >
                <Ionicons
                  name="mail"
                  size={14}
                  color={loginMode === 'email' ? '#000' : 'rgba(255,255,255,0.5)'}
                />
                <Text style={[styles.modeBtnText, loginMode === 'email' && styles.modeBtnTextActive]}>
                  Email
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeBtn, loginMode === 'phone' && styles.modeBtnActive]}
                activeOpacity={0.8}
                onPress={() => setLoginMode('phone')}
              >
                <Ionicons
                  name="call"
                  size={14}
                  color={loginMode === 'phone' ? '#000' : 'rgba(255,255,255,0.5)'}
                />
                <Text style={[styles.modeBtnText, loginMode === 'phone' && styles.modeBtnTextActive]}>
                  Telefon
                </Text>
              </TouchableOpacity>
            </View>

            {/* Email Input icon */}
            {loginMode === 'email' ? (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>ADMIN EMAIL</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="mail-outline" size={18} color="rgba(255,255,255,0.5)" style={styles.inputIcon} />
                  <TextInput
                    style={styles.textInput}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="admin@amatora.uz"
                    placeholderTextColor="rgba(255,255,255,0.25)"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    textContentType="emailAddress"
                  />
                </View>
              </View>
            ) : (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>TELEFON RAQAM</Text>
                <View style={styles.inputWrapper}>
                  <View style={styles.phonePrefix}>
                    <Text style={styles.phonePrefixText}>+998</Text>
                  </View>
                  <TextInput
                    style={[styles.textInput, { flex: 1 }]}
                    value={phone}
                    onChangeText={(v) => setPhone(v.replace(/[^0-9]/g, ''))}
                    placeholder="90 123 45 67"
                    placeholderTextColor="rgba(255,255,255,0.25)"
                    keyboardType="number-pad"
                    maxLength={12}
                  />
                </View>
              </View>
            )}

            {/* Password Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>PAROL</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={18} color="rgba(255,255,255,0.5)" style={styles.inputIcon} />
                <TextInput
                  style={[styles.textInput, { flex: 1 }]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor="rgba(255,255,255,0.25)"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <Ionicons
                    name={showPassword ? 'eye-off' : 'eye'}
                    size={18}
                    color="rgba(255,255,255,0.4)"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* Login Button */}
            <TouchableOpacity
              style={[styles.loginBtn, loading && { opacity: 0.7 }]}
              activeOpacity={0.85}
              onPress={handleLogin}
              disabled={loading}
            >
              <LinearGradient
                colors={['rgba(255, 255, 255, 0.12)', 'rgba(255, 255, 255, 0.03)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.loginBtnGradient}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Text style={styles.loginBtnText}>Tizimga Kirish</Text>
                    <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

          </BlurView>

          {/* Footer */}
          <Text style={styles.footerText}>AMATORA © 2026 • Barcha huquqlar himoyalangan</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Custom Error Modal */}
      <Modal
        visible={errorVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setErrorVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <BlurView intensity={60} tint="dark" style={styles.modalGlassCard}>
            <View style={styles.modalMessageRow}>
              <Ionicons name="warning-outline" size={20} color="#FFFFFF" />
              <Text style={styles.modalMessage}>{errorMessage}</Text>
            </View>
            
            <TouchableOpacity
              style={styles.modalBtn}
              activeOpacity={0.8}
              onPress={() => setErrorVisible(false)}
            >
              <Text style={styles.modalBtnText}>YOPISH</Text>
            </TouchableOpacity>
          </BlurView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  glowBlob1: {
    position: 'absolute',
    top: '20%',
    left: '-20%',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    transform: [{ scale: 1.5 }],
  },
  glowBlob2: {
    position: 'absolute',
    bottom: '10%',
    right: '-15%',
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    transform: [{ scale: 1.5 }],
  },
  kvWrapper: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 60,
    gap: 32,
  },
  brandingBox: {
    alignItems: 'center',
    gap: 4,
  },
  amatoraLogo: {
    width: 160,
    height: 60,
    marginBottom: 4,
  },
  brandTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 4,
    textTransform: 'uppercase',
  },
  titleWrapper: {
    position: 'relative',   // so adminLabel absolute positions inside here
    alignItems: 'center',
  },
  adminLabel: {
    position: 'absolute',
    bottom: -11,            // just below AMATORA bottom edge
    right: 0,               // right edge of AMATORA text
    color: 'rgba(255,255,255,0.38)',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  glassCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    gap: 18,
    // Glass effect via shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.8,
    shadowRadius: 40,
    elevation: 20,
  },
  modeToggleRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    padding: 4,
    gap: 4,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  modeBtnActive: {
    backgroundColor: '#FFFFFF',
  },
  modeBtnText: {
    color: 'rgba(255,255,255,0.5)',
    fontWeight: '700',
    fontSize: 13,
  },
  modeBtnTextActive: {
    color: '#000000',
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 2,
    minHeight: 52,
  },
  inputIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 12,
  },
  phonePrefix: {
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.15)',
    paddingRight: 12,
    marginRight: 12,
    paddingVertical: 12,
  },
  phonePrefixText: {
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '900',
    fontSize: 15,
  },
  eyeBtn: {
    padding: 6,
  },
  loginBtn: {
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  loginBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  loginBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  footerText: {
    textAlign: 'center',
    color: 'rgba(255,255,255,0.2)',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalGlassCard: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 24,
    padding: 30,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    // Glass shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.8,
    shadowRadius: 40,
    elevation: 20,
  },
  modalMessageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 24,
  },
  modalMessage: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  modalBtn: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
  },
  modalBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
});
