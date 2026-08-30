import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
  Modal,
  Linking,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabaseClient';
import { logUserLoginWithLocation } from '../utils/locationLogger';

interface WelcomeScreenProps {
  onLoginSuccess: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onLoginSuccess }) => {
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

  const handleOpenSupport = async () => {
    const url = 'https://t.me/amatora_support';
    try {
      await Linking.openURL(url);
    } catch (e) {
      Linking.openURL('https://t.me/amatora_bot').catch(() => {});
    }
  };

  const handleLogin = async () => {
    const identifier = loginMode === 'email' ? email.trim() : phone.trim();
    if (!identifier || !password.trim()) {
      showError('Iltimos, barcha maydonlarni to\'ldiring!');
      return;
    }

    setLoading(true);
    try {
      const dbClient = supabase;
      let loginEmail = '';

      if (loginMode === 'email') {
        loginEmail = identifier.toLowerCase();
      } else {
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

      // 1. First try Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: password.trim(),
      });

      if (!authError && authData?.user) {
        const { data: orgData } = await dbClient
          .from('organizations')
          .select('id')
          .eq('admin_email', loginEmail)
          .limit(1);

        if (orgData && orgData.length > 0) {
          const targetOrgId = orgData[0].id;
          await AsyncStorage.setItem('@amatora_user_role', 'org_admin');
          await AsyncStorage.setItem('@amatora_org_id', targetOrgId.toString());
          await AsyncStorage.setItem('@amatora_user_email', loginEmail);
          logUserLoginWithLocation({
            organizationId: targetOrgId,
            userEmail: loginEmail,
            userName: 'Bosh Admin',
            userRole: 'org_admin',
          });
          onLoginSuccess();
          return;
        }

        const { data: orgUser } = await dbClient
          .from('organization_users')
          .select('*')
          .eq('email', loginEmail)
          .maybeSingle();

        if (orgUser) {
          const targetOrgId = orgUser.organization_id;
          const role = orgUser.role || 'user';
          await AsyncStorage.setItem('@amatora_user_role', role);
          await AsyncStorage.setItem('@amatora_org_id', targetOrgId.toString());
          await AsyncStorage.setItem('@amatora_user_email', loginEmail);
          logUserLoginWithLocation({
            organizationId: targetOrgId,
            userEmail: loginEmail,
            userName: orgUser.full_name || loginEmail,
            userRole: role,
          });
          onLoginSuccess();
          return;
        }
      }

      // 2. Fallback: Check organization_users table directly
      const { data: directOrgUser } = await dbClient
        .from('organization_users')
        .select('*')
        .eq('email', loginEmail)
        .eq('password', password.trim())
        .maybeSingle();

      if (directOrgUser) {
        const targetOrgId = directOrgUser.organization_id;
        const role = directOrgUser.role || 'user';
        await AsyncStorage.setItem('@amatora_user_role', role);
        await AsyncStorage.setItem('@amatora_org_id', targetOrgId.toString());
        await AsyncStorage.setItem('@amatora_user_email', loginEmail);
        logUserLoginWithLocation({
          organizationId: targetOrgId,
          userEmail: loginEmail,
          userName: directOrgUser.full_name || loginEmail,
          userRole: role,
        });
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
        const targetOrgId = adminUser.organization_id;
        await AsyncStorage.setItem('@amatora_user_role', 'org_admin');
        await AsyncStorage.setItem('@amatora_org_id', targetOrgId.toString());
        await AsyncStorage.setItem('@amatora_user_email', loginEmail);
        logUserLoginWithLocation({
          organizationId: targetOrgId,
          userEmail: loginEmail,
          userName: 'Bosh Admin',
          userRole: 'org_admin',
        });
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
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      <KeyboardAvoidingView
        style={styles.kvWrapper}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.mainCenterContainer}>
            {/* Logo + AMATORA ADMIN (positioned directly above input box) */}
            <View style={styles.centerBrandWrapper}>
              <Image
                source={require('../../assets/amatora-logo.png')}
                style={styles.amatoraLogo}
                resizeMode="contain"
              />
              <View style={styles.titleWrapper}>
                <Text style={styles.brandTitle}>AMATORA</Text>
                <Text style={styles.adminLabel}>ADMIN</Text>
              </View>
            </View>

            {/* Direct Login Form (Pure Black & White) */}
            <View style={styles.formContainer}>
              {/* Mode Toggle (Email / Telefon) */}
              <View style={styles.modeToggleRow}>
                <TouchableOpacity
                  style={[styles.modeBtn, loginMode === 'email' && styles.modeBtnActive]}
                  activeOpacity={0.8}
                  onPress={() => setLoginMode('email')}
                >
                  <Ionicons
                    name="mail"
                    size={15}
                    color={loginMode === 'email' ? '#FFFFFF' : '#000000'}
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
                    size={15}
                    color={loginMode === 'phone' ? '#FFFFFF' : '#000000'}
                  />
                  <Text style={[styles.modeBtnText, loginMode === 'phone' && styles.modeBtnTextActive]}>
                    Telefon
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Email / Phone Input */}
              {loginMode === 'email' ? (
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>ADMIN EMAIL</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons name="mail-outline" size={18} color="#000000" style={styles.inputIcon} />
                    <TextInput
                      style={styles.textInput}
                      value={email}
                      onChangeText={setEmail}
                      placeholder="admin@amatora.uz"
                      placeholderTextColor="#94A3B8"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  </View>
                </View>
              ) : (
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>TELEFON RAQAM</Text>
                  <View style={styles.inputWrapper}>
                    <Ionicons name="call-outline" size={18} color="#000000" style={styles.inputIcon} />
                    <TextInput
                      style={styles.textInput}
                      value={phone}
                      onChangeText={setPhone}
                      placeholder="+998 90 123 45 67"
                      placeholderTextColor="#94A3B8"
                      keyboardType="phone-pad"
                    />
                  </View>
                </View>
              )}

              {/* Password Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>PAROL</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="lock-closed-outline" size={18} color="#000000" style={styles.inputIcon} />
                  <TextInput
                    style={styles.textInput}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="••••••••"
                    placeholderTextColor="#94A3B8"
                    secureTextEntry={!showPassword}
                  />
                  <TouchableOpacity
                    style={styles.eyeBtn}
                    onPress={() => setShowPassword(!showPassword)}
                  >
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={18}
                      color="#000000"
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
                activeOpacity={0.85}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Text style={styles.submitBtnText}>KIRISH</Text>
                    <Ionicons name="arrow-forward" size={18} color="#FFFFFF" style={{ marginLeft: 6 }} />
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Bottom Support Link */}
          <View style={styles.bottomSection}>
            <TouchableOpacity
              style={styles.secondarySupportBtn}
              activeOpacity={0.7}
              onPress={handleOpenSupport}
            >
              <Ionicons name="help-circle-outline" size={18} color="#000000" style={{ marginRight: 6 }} />
              <Text style={styles.secondarySupportBtnText}>Qo'llab-quvvatlash</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Custom Error Modal (Pure Black & White) */}
      <Modal
        visible={errorVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setErrorVisible(false)}
      >
        <View style={styles.errorModalOverlay}>
          <View style={styles.errorModalCard}>
            <View style={styles.errorIconBox}>
              <Ionicons name="alert-circle-outline" size={32} color="#000000" />
            </View>
            <Text style={styles.errorModalTitle}>Kirishda xatolik</Text>
            <Text style={styles.errorModalMessage}>{errorMessage}</Text>
            <TouchableOpacity
              style={styles.errorModalBtn}
              activeOpacity={0.8}
              onPress={() => setErrorVisible(false)}
            >
              <Text style={styles.errorModalBtnText}>Tushundim</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  kvWrapper: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 20,
    justifyContent: 'center',
  },
  mainCenterContainer: {
    width: '100%',
    alignItems: 'center',
  },

  // Branding Styles (directly above input div, horizontal row)
  centerBrandWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
    gap: 12,
  },
  amatoraLogo: {
    width: 46,
    height: 46,
  },
  titleWrapper: {
    position: 'relative',
    justifyContent: 'center',
  },
  brandTitle: {
    color: '#000000',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 3.5,
    textTransform: 'uppercase',
  },
  adminLabel: {
    position: 'absolute',
    bottom: -10,
    right: 0,
    color: '#000000',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    opacity: 0.6,
  },

  // Form Container
  formContainer: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  modeToggleRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 9,
    gap: 6,
  },
  modeBtnActive: {
    backgroundColor: '#000000',
  },
  modeBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#000000',
  },
  modeBtnTextActive: {
    color: '#FFFFFF',
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    color: '#000000',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 12,
    height: 48,
  },
  inputIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    color: '#000000',
    fontSize: 14,
    fontWeight: '600',
  },
  eyeBtn: {
    padding: 6,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 6,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1,
  },

  // Bottom Section
  bottomSection: {
    alignItems: 'center',
    marginTop: 24,
  },
  secondarySupportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  secondarySupportBtnText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: '700',
  },

  // Error Modal
  errorModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorModalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  errorIconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  errorModalTitle: {
    color: '#000000',
    fontSize: 17,
    fontWeight: '900',
    marginBottom: 6,
  },
  errorModalMessage: {
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
  errorModalBtn: {
    width: '100%',
    backgroundColor: '#000000',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  errorModalBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
});

export default WelcomeScreen;
