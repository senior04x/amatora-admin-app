import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Switch,
  Alert,
  ActivityIndicator,
  TextInput,
  Linking,
  Animated,
  Modal,
  Platform,
  AppState,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from '../components/SafeBlurView';
import { ColorPicker } from '@darthrapid/react-native-color-picker';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useOrg } from '../context/OrgContext';
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../supabaseClient';
import { triggerIosCrescendoHaptic } from '../utils/haptics';
import {
  getYtTokens,
  saveYtTokens,
  fetchYtChannelInfo,
  getValidAccessToken,
  disconnectYouTube,
  loadYtChannelForOrg,
  YT_SCOPES,
  YtChannelInfo,
} from '../utils/youtubeService';

WebBrowser.maybeCompleteAuthSession();

// Google OAuth Client IDs
const GOOGLE_WEB_CLIENT_ID = '869594621568-f43saav9qgm76srbi5jfhonb92q7ubsl.apps.googleusercontent.com';
const GOOGLE_IOS_CLIENT_ID = '869594621568-f43saav9qgm76srbi5jfhonb92q7ubsl.apps.googleusercontent.com';
const GOOGLE_ANDROID_CLIENT_ID = '869594621568-f43saav9qgm76srbi5jfhonb92q7ubsl.apps.googleusercontent.com';

const TextSkeleton: React.FC<{ width?: number | string; height?: number; borderRadius?: number; style?: any }> = ({
  width = 120,
  height = 16,
  borderRadius = 6,
  style,
}) => {
  const { colors } = useTheme();
  const opacityAnim = React.useRef(new Animated.Value(0.3)).current;

  React.useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacityAnim, {
          toValue: 0.7,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0.3,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: Platform.OS === 'android' ? colors.bgCardElevated : 'rgba(255, 255, 255, 0.22)',
          opacity: opacityAnim,
        },
        style,
      ]}
    />
  );
};

export const AccountScreen: React.FC<{
  onNavigateToSettings?: () => void;
  onNavigateToOrganizers?: () => void;
  onLogout?: () => void;
}> = ({
  onNavigateToSettings,
  onNavigateToOrganizers,
  onLogout,
}) => {
  const { isDark, colors, themeMode, setThemeMode } = useTheme();
  const {
    orgId,
    currentOrg,
    currentUser,
    updateCurrentUserLocally,
    refreshCurrentUser,
    loading,
    userRole,
    transferWindowOpen,
    isRegistrationOpen,
    toggleTransferWindow,
    toggleRegistrationStatus,
    refreshOrg,
    updateOrgLocally,
    showToast,
  } = useOrg();

  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // YouTube state
  const [ytChannelInfo, setYtChannelInfo] = useState<YtChannelInfo | null>(null);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytConnecting, setYtConnecting] = useState(false);

  // Google Auth Request (handles iOS/Android redirect URIs automatically)
  const [request, response, promptAsync] = Google.useAuthRequest({
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    webClientId: GOOGLE_WEB_CLIENT_ID,
    scopes: YT_SCOPES,
    shouldAutoExchangeCode: false,
    extraParams: {
      access_type: 'offline',
      prompt: 'consent select_account',
    },
  });

  useEffect(() => {
    if (response?.type === 'success' && response.params?.code) {
      handleCodeExchange(response.params.code);
    } else if (response?.type === 'error') {
      console.error('YouTube OAuth error:', response.error);
      Alert.alert('Xatolik', 'YouTube ulanishda xatolik yuz berdi.');
      setYtConnecting(false);
    } else if (response?.type === 'dismiss' || response?.type === 'cancel') {
      setYtConnecting(false);
    }
  }, [response]);

  const handleCodeExchange = async (code: string) => {
    setYtConnecting(true);
    try {
      const tokenRequestBody: Record<string, string> = {
        code,
        client_id: GOOGLE_IOS_CLIENT_ID,
        redirect_uri: request?.redirectUri || '',
        grant_type: 'authorization_code',
      };

      if (request?.codeVerifier) {
        tokenRequestBody.code_verifier = request.codeVerifier;
      }

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(tokenRequestBody).toString(),
      });

      const tokenData = await tokenResponse.json();

      if (tokenData.access_token) {
        const channelInfo = await fetchYtChannelInfo(tokenData.access_token);
        await saveYtTokens(orgId || 1, tokenData, channelInfo);
        setYtChannelInfo(channelInfo);
        showToast({
          message: channelInfo
            ? `YouTube ulandi: ${channelInfo.title}`
            : 'YouTube muvaffaqiyatli ulandi!',
          type: 'success',
        });
      } else {
        console.error('YouTube token exchange failed:', tokenData);
        Alert.alert('Xatolik', `YouTube token olishda xatolik: ${tokenData?.error || 'noma\'lum'}`);
      }
    } catch (err) {
      console.error('Error exchanging YouTube code:', err);
      Alert.alert('Xatolik', 'YouTube ulanishda xatolik yuz berdi.');
    } finally {
      setYtConnecting(false);
    }
  };

  useEffect(() => {
    if (orgId && userRole !== 'user') {
      loadYouTubeStatus();
    }
  }, [orgId, userRole]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active' && orgId && userRole !== 'user') {
        loadYouTubeStatus();
      }
    });
    return () => subscription.remove();
  }, [orgId, userRole]);

  const loadYouTubeStatus = async () => {
    setYtLoading(true);
    try {
      const channelInfo = await loadYtChannelForOrg(orgId || 1);
      setYtChannelInfo(channelInfo);
    } catch (e) {
      console.error('Load YT status error:', e);
      setYtChannelInfo(null);
    } finally {
      setYtLoading(false);
    }
  };

  const handleConnectYouTube = async () => {
    if (!request) {
      Alert.alert('Kutib turing', 'OAuth tayyorlanmoqda, bir necha soniya kutib qayta urinib ko\'ring.');
      return;
    }

    setYtConnecting(true);
    try {
      await promptAsync();
    } catch (err) {
      console.error('YouTube connect error:', err);
      setYtConnecting(false);
      Alert.alert('Xatolik', 'YouTube ulanishda xatolik yuz berdi.');
    }
  };

  const handleDisconnectYouTube = () => {
    Alert.alert(
      'YouTube uzish',
      `"${ytChannelInfo?.title || 'YouTube'}" kanalini uzmoqchimisiz?`,
      [
        { text: 'Bekor qilish', style: 'cancel' },
        {
          text: 'Uzish',
          style: 'destructive',
          onPress: async () => {
            try {
              await disconnectYouTube(orgId || 1);
              setYtChannelInfo(null);
              showToast({
                message: 'YouTube kanal uzildi',
                type: 'warning',
              });
            } catch (e) {
              console.error('Disconnect error:', e);
              Alert.alert('Xatolik', 'YouTube uzishda xatolik yuz berdi.');
            }
          },
        },
      ]
    );
  };

  // Organizers (User Role) Management State
  const [showOrganizersModal, setShowOrganizersModal] = useState(false);
  const [organizersList, setOrganizersList] = useState<any[]>([]);
  const [loadingOrganizers, setLoadingOrganizers] = useState(false);
  const [showAddOrganizerForm, setShowAddOrganizerForm] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgEmail, setNewOrgEmail] = useState('');
  const [newOrgPassword, setNewOrgPassword] = useState('');
  const [isCreatingOrgUser, setIsCreatingOrgUser] = useState(false);

  const fetchOrganizers = async () => {
    try {
      setLoadingOrganizers(true);
      const dbClient = supabase;
      const targetOrgId = currentOrg?.id || orgId || 1;

      const { data, error } = await dbClient
        .from('organization_users')
        .select('*')
        .eq('organization_id', targetOrgId)
        .order('id', { ascending: false });

      if (!error && data) {
        setOrganizersList(data);
      } else {
        setOrganizersList([]);
      }
    } catch (e) {
      console.error('Fetch organizers error:', e);
    } finally {
      setLoadingOrganizers(false);
    }
  };

  const handleOpenOrganizersModal = () => {
    setShowOrganizersModal(true);
    fetchOrganizers();
  };

  const handleCreateOrganizer = async () => {
    if (!newOrgEmail.trim() || !newOrgPassword.trim() || !newOrgName.trim()) {
      Alert.alert('Xatolik', 'Iltimos, barcha maydonlarni to\'ldiring!');
      return;
    }

    try {
      setIsCreatingOrgUser(true);
      const dbClient = supabase;
      const targetOrgId = currentOrg?.id || orgId || 1;

      const { error } = await dbClient.from('organization_users').insert([
        {
          organization_id: targetOrgId,
          email: newOrgEmail.trim().toLowerCase(),
          password: newOrgPassword.trim(),
          full_name: newOrgName.trim(),
          role: 'user',
        },
      ]);

      if (error) {
        throw new Error(error.message);
      }

      Alert.alert('Muvaffaqiyatli', 'Yangi organizator (user) saqlandi!');
      setNewOrgName('');
      setNewOrgEmail('');
      setNewOrgPassword('');
      setShowAddOrganizerForm(false);
      fetchOrganizers();
    } catch (err: any) {
      Alert.alert('Xatolik', err.message || 'Organizator qo\'shishda xatolik yuz berdi');
    } finally {
      setIsCreatingOrgUser(false);
    }
  };

  const handleDeleteOrganizer = async (id: any) => {
    Alert.alert('Tasdiqlash', 'Ushbu organizatorni o\'chirmoqchimisiz?', [
      { text: 'Bekor qilish', style: 'cancel' },
      {
        text: 'O\'chirish',
        style: 'destructive',
        onPress: async () => {
          try {
            const dbClient = supabase;
            await dbClient.from('organization_users').delete().eq('id', id);
            fetchOrganizers();
          } catch (e) {
            console.error('Delete organizer error:', e);
          }
        },
      },
    ]);
  };

  // 1-to-1 SuperAdmin Organization Edit Form State
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [editName, setEditName] = useState(currentOrg?.name || '');
  const [editSlug, setEditSlug] = useState(currentOrg?.slug || '');
  const [editEmail, setEditEmail] = useState(currentOrg?.admin_email || currentOrg?.email || '');
  const [editPassword, setEditPassword] = useState(currentOrg?.admin_password || currentOrg?.password || '');
  // Phone suffix only (without +998 prefix)
  const rawPhone = (v: string) => v.replace(/^\+998\s?/, '').replace(/^\+998/, '');
  const [editPhoneSuffix, setEditPhoneSuffix] = useState(rawPhone(currentOrg?.contact_phone || currentOrg?.phone || ''));
  const [showPassword, setShowPassword] = useState(false);
  const [editBrandColors, setEditBrandColors] = useState<string[]>(
    Array.isArray(currentOrg?.brand_colors) ? currentOrg.brand_colors : ['#00FF87']
  );
  const [isSavingInfo, setIsSavingInfo] = useState(false);

  const handleAddBrandColor = () => {
    setEditBrandColors((prev) => [...prev, '#38BDF8']);
  };

  const handleUpdateBrandColor = (index: number, val: string) => {
    const updated = [...editBrandColors];
    updated[index] = val;
    setEditBrandColors(updated);
  };

  const handleRemoveBrandColor = (index: number) => {
    if (editBrandColors.length <= 1) return;
    setEditBrandColors((prev) => prev.filter((_, idx) => idx !== index));
  };

  const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    const loadData = async () => {
      if (userRole === 'user') {
        try {
          const dbClient = supabase;
          const { data: sessionData } = await supabase.auth.getSession();
          let sessionEmail = sessionData?.session?.user?.email || currentUser?.email;
          if (!sessionEmail) {
            sessionEmail = await AsyncStorage.getItem('@amatora_user_email');
          }

          if (sessionEmail) {
            const { data: userRec } = await dbClient
              .from('organization_users')
              .select('*')
              .ilike('email', sessionEmail)
              .maybeSingle();

            if (userRec) {
              setEditName(userRec.full_name || 'Organizator');
              setEditEmail(userRec.email || sessionEmail);
              setEditPassword(userRec.password || '');
              setUserAvatarUrl(userRec.avatar_url || null);
              return;
            }
          }
        } catch (e) {
          console.error('Fetch user account record error:', e);
        }
      }

      if (currentOrg) {
        setEditName(currentOrg.name || '');
        setEditSlug(currentOrg.slug || '');
        setEditEmail(currentOrg.admin_email || currentOrg.email || '');
        setEditPassword(currentOrg.admin_password || currentOrg.password || '');
        const phoneVal = currentOrg.contact_phone || currentOrg.phone || '';
        setEditPhoneSuffix(rawPhone(phoneVal));
        setEditBrandColors(Array.isArray(currentOrg.brand_colors) ? currentOrg.brand_colors : ['#00FF87']);
      }
    };

    loadData();
  }, [currentOrg, userRole]);

  // Handle Organization Logo Upload (SuperAdmin - Instant 0ms Preview + Background CDN Upload)
  const handlePickLogo = async () => {
    try {
      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.85,
        base64: false,
      });

      if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
        return;
      }

      const asset = pickerResult.assets[0];
      const localUri = asset.uri;

      // 1. Instant 0ms local update for Header & AccountScreen
      updateOrgLocally({ logo_url: localUri });
      showToast({ message: "Tashkilot logotipi tanlandi, saqlanmoqda...", type: "info" });

      // 2. Background Asynchronous CDN Upload (Non-blocking)
      (async () => {
        try {
          const dbClient = supabase;
          const fileExt = localUri.split('.').pop()?.toLowerCase().split('?')[0] || 'jpg';
          const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(fileExt) ? fileExt : 'jpg';
          const fileName = `org_logo_${orgId || 1}_${Date.now()}.${safeExt}`;

          const response = await fetch(localUri);
          const blob = await response.blob();
          const arrayBuffer = await new Response(blob).arrayBuffer();

          const { error: uploadErr } = await dbClient.storage
            .from('player-photos')
            .upload(`logos/${fileName}`, arrayBuffer, {
              contentType: `image/${safeExt === 'jpg' ? 'jpeg' : safeExt}`,
              upsert: true
            });

          if (uploadErr) {
            console.error('Storage logo upload error:', uploadErr);
            return;
          }

          const { data: urlData } = dbClient.storage.from('player-photos').getPublicUrl(`logos/${fileName}`);
          const publicUrl = urlData?.publicUrl || '';

          if (publicUrl) {
            await dbClient.from('organizations').update({ logo_url: publicUrl }).eq('id', orgId || 1);
            updateOrgLocally({ logo_url: publicUrl });
            refreshOrg();
            showToast({ message: "Tashkilot logotipi muvaffaqiyatli saqlandi! ✅", type: "success" });
          }
        } catch (bgErr: any) {
          console.warn('Background logo upload warn:', bgErr);
        }
      })();
    } catch (err: any) {
      console.error('Error picking logo:', err);
    }
  };

  // Handle User Avatar Photo Upload (Organizator / User - Instant 0ms Preview + Background CDN Upload)
  const handlePickUserAvatar = async () => {
    try {
      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
        base64: false,
      });

      if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
        return;
      }

      const asset = pickerResult.assets[0];
      const localUri = asset.uri;

      // 1. Instant 0ms local update for Header & AccountScreen
      setUserAvatarUrl(localUri);
      updateCurrentUserLocally({ avatar_url: localUri });
      showToast({ message: "Profil rasmi tanlandi, saqlanmoqda...", type: "info" });

      // 2. Background Asynchronous CDN Upload (Non-blocking)
      (async () => {
        try {
          const dbClient = supabase;
          const { data: sessionData } = await supabase.auth.getSession();
          const sessionEmail = sessionData?.session?.user?.email;

          const fileExt = localUri.split('.').pop()?.toLowerCase().split('?')[0] || 'jpg';
          const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(fileExt) ? fileExt : 'jpg';
          const fileName = `user_avatar_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${safeExt}`;

          const response = await fetch(localUri);
          const blob = await response.blob();
          const arrayBuffer = await new Response(blob).arrayBuffer();

          const { error: uploadErr } = await dbClient.storage
            .from('player-photos')
            .upload(`avatars/${fileName}`, arrayBuffer, {
              contentType: `image/${safeExt === 'jpg' ? 'jpeg' : safeExt}`,
              upsert: true
            });

          if (uploadErr) {
            console.error('Storage avatar upload error:', uploadErr);
            showToast({ message: "Rasm yuklashda xatolik yuz berdi", type: "error" });
            return;
          }

          const { data: urlData } = dbClient.storage.from('player-photos').getPublicUrl(`avatars/${fileName}`);
          const publicUrl = urlData?.publicUrl || '';

          if (publicUrl) {
            setUserAvatarUrl(publicUrl);
            updateCurrentUserLocally({ avatar_url: publicUrl });

            if (sessionEmail) {
              await dbClient
                .from('organization_users')
                .update({ avatar_url: publicUrl })
                .ilike('email', sessionEmail);
            }
            refreshCurrentUser();
            showToast({ message: "Profil rasmingiz muvaffaqiyatli saqlandi! ✅", type: "success" });
          }
        } catch (bgErr: any) {
          console.warn('Background avatar upload warn:', bgErr);
        }
      })();
    } catch (err: any) {
      console.error('Error picking user avatar:', err);
    }
  };

  // Save Profile / Organization Info Handler
  const handleSaveAdminInfo = async () => {
    if (!editName.trim()) {
      Alert.alert('Xatolik', userRole === 'user' ? 'Iltimos, ismingizni kiriting!' : 'Iltimos, tashkilot nomini kiriting!');
      return;
    }

    triggerIosCrescendoHaptic();

    // 1. ORGANIZATOR (user role) - ONLY UPDATE organization_users TABLE
    if (userRole === 'user') {
      updateCurrentUserLocally({
        full_name: editName.trim(),
        email: editEmail.trim(),
      });

      setIsEditingInfo(false);
      setIsSavingInfo(false);

      (async () => {
        try {
          const dbClient = supabase;
          const targetOrgId = orgId || currentOrg?.id || 1;

          const userUpdatePayload: any = {
            full_name: editName.trim(),
            email: editEmail.trim(),
          };
          if (editPassword.trim()) {
            userUpdatePayload.password = editPassword.trim();
          }

          if (currentUser?.id) {
            await dbClient
              .from('organization_users')
              .update(userUpdatePayload)
              .eq('id', currentUser.id);
          } else {
            const { data: sessionData } = await supabase.auth.getSession();
            const sessionEmail = sessionData?.session?.user?.email;
            if (sessionEmail) {
              await dbClient
                .from('organization_users')
                .update(userUpdatePayload)
                .eq('organization_id', targetOrgId)
                .ilike('email', sessionEmail);
            }
          }

          refreshCurrentUser();
          showToast({ message: "Profil ma'lumotlaringiz muvaffaqiyatli saqlandi! ✅", type: "success" });
        } catch (err: any) {
          console.error('Save organizer profile error:', err);
          showToast({ message: "Saqlashda xatolik yuz berdi", type: "error" });
        }
      })();
      return;
    }

    // 2. BOSH ADMIN (org_admin / superadmin) - UPDATE organizations AND admin_users TABLES
    const fullPhone = editPhoneSuffix.trim() ? `+998 ${editPhoneSuffix.trim()}` : '';

    updateOrgLocally({
      name: editName.trim(),
      brand_colors: editBrandColors,
      admin_email: editEmail.trim(),
      contact_phone: fullPhone,
    });

    setIsEditingInfo(false);
    setIsSavingInfo(false);

    (async () => {
      try {
        const dbClient = supabase;
        const targetOrgId = orgId || currentOrg?.id || 1;

        const mainUpdatePayload: any = {
          name: editName.trim(),
          slug: editSlug.trim() || editName.trim().toLowerCase().replace(/\s+/g, '-'),
          brand_colors: editBrandColors,
        };
        if (editEmail.trim()) {
          mainUpdatePayload.admin_email = editEmail.trim();
        }
        if (fullPhone) {
          mainUpdatePayload.contact_phone = fullPhone;
        }

        const { error: primaryErr } = await dbClient
          .from('organizations')
          .update(mainUpdatePayload)
          .eq('id', targetOrgId);

        if (primaryErr) {
          console.warn('Primary org update warning, trying fallback:', primaryErr);
          await dbClient
            .from('organizations')
            .update({
              name: editName.trim(),
              slug: editSlug.trim() || editName.trim().toLowerCase().replace(/\s+/g, '-'),
              brand_colors: editBrandColors,
            })
            .eq('id', targetOrgId);
        }

        const { data: adminUser } = await dbClient
          .from('admin_users')
          .select('id')
          .eq('organization_id', targetOrgId)
          .eq('role', 'org_admin')
          .maybeSingle();

        if (adminUser) {
          const uPayload: any = {};
          if (editEmail.trim()) uPayload.email = editEmail.trim();
          if (editPassword.trim()) uPayload.password = editPassword.trim();
          if (fullPhone) uPayload.phone_number = fullPhone;
          if (Object.keys(uPayload).length > 0) {
            await dbClient.from('admin_users').update(uPayload).eq('id', adminUser.id);
          }
        }

        refreshOrg();
        showToast({ message: "Tashkilot ma'lumotlari muvaffaqiyatli saqlandi! ✅", type: "success" });
      } catch (err: any) {
        console.error('Background save error:', err);
      }
    })();
  };

  // Handle Logout
  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  const confirmLogout = () => {
    setShowLogoutModal(false);
    if (onLogout) onLogout();
  };

  // Switcher Handlers (Feedback via Top Toast in OrgContext)
  const handleRegistrationToggle = async (val: boolean) => {
    await toggleRegistrationStatus(val);
  };

  const handleTransferToggle = async (val: boolean) => {
    await toggleTransferWindow(val);
  };

  return (
    <ScrollView
      style={[styles.container, Platform.OS === 'android' && { backgroundColor: colors.bgPrimary }]}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Admin Akkounti"}</Text>
        <Text style={[styles.headerSub, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Tashkilot va Admin profil boshqaruvi"}</Text>
      </View>

      {/* Organization Profile Card */}
      <View style={[styles.profileCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        {Platform.OS === 'ios' && <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
        <View style={styles.profileHeaderRow}>
          <TouchableOpacity
            style={styles.logoWrapper}
            activeOpacity={0.8}
            onPress={userRole === 'user' ? handlePickUserAvatar : handlePickLogo}
            disabled={isUploadingLogo}
          >
            {isUploadingLogo ? (
              <ActivityIndicator size="small" color={colors.accentGreen} />
            ) : (
              <>
                <Image
                  source={{
                    uri:
                      userRole === 'user'
                        ? (currentUser?.avatar_url || userAvatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop')
                        : (currentOrg?.logo_url || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=120&auto=format&fit=crop'),
                  }}
                  style={[styles.orgLogo, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
                />
                <View style={[styles.logoEditBadge, Platform.OS === 'android' && { backgroundColor: colors.accentGreen }]}>
                  <Ionicons name="camera" size={12} color="#FFFFFF" />
                </View>
              </>
            )}
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            {loading || (!currentOrg?.name && userRole !== 'user') ? (
              <View style={{ gap: 6, marginVertical: 4 }}>
                <TextSkeleton width={180} height={20} borderRadius={6} />
                <TextSkeleton width={100} height={14} borderRadius={4} />
              </View>
            ) : (
              <>
                <Text style={[styles.orgName, Platform.OS === 'android' && { color: colors.textPrimary }]}>
                  {userRole === 'user' ? (editName || 'Organizator') : currentOrg.name}
                </Text>
                <View style={styles.badgeRow}>
                  <View style={[
                    styles.roleBadge,
                    Platform.OS === 'android' && {
                      backgroundColor: userRole === 'user' ? (isDark ? 'rgba(56, 189, 248, 0.25)' : '#E0F2FE') : (isDark ? 'rgba(74, 222, 128, 0.18)' : '#ECFDF5'),
                      borderColor: userRole === 'user' ? '#38BDF8' : colors.accentGreen,
                    }
                  ]}>
                    <Ionicons
                      name={userRole === 'user' ? "person-circle" : "shield-checkmark"}
                      size={12}
                      color={userRole === 'user' ? "#38BDF8" : (Platform.OS === 'android' ? colors.accentGreen : "#FFFFFF")}
                    />
                    <Text style={[
                      styles.roleBadgeText,
                      Platform.OS === 'android' && { color: userRole === 'user' ? '#0284C7' : colors.accentGreen }
                    ]}>
                      {userRole === 'user' ? "ORGANIZATOR" : "BOSH ADMIN"}
                    </Text>
                  </View>
                </View>
              </>
            )}
          </View>
        </View>

        {userRole !== 'user' && (
          <>
            <View style={[styles.divider, Platform.OS === 'android' && { backgroundColor: colors.border }]} />

            {/* Quick Toggles Section */}
            <Text style={[styles.sectionTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Tizim Kalit Sozlamalari"}</Text>

            {/* 1. Registration Switch */}
            <View style={[styles.toggleRow, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}>
              <View style={styles.toggleLabelGroup}>
                <View style={[styles.toggleIconBox, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
                  <Ionicons name="person-add" size={18} color="#38BDF8" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.toggleTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Ro'yxatdan O'tish Holati"}</Text>
                  <Text
                    style={[
                      styles.toggleSub,
                      { color: isRegistrationOpen ? (Platform.OS === 'android' ? colors.accentGreen : '#00FF87') : '#EF4444' },
                    ]}
                  >
                    {isRegistrationOpen ? "OCHIQ (Arizalar qabul qilinmoqda)" : "YOPILGAN (Qabul to'xtatilgan)"}
                  </Text>
                </View>
              </View>
              <Switch
                value={isRegistrationOpen}
                onValueChange={handleRegistrationToggle}
                trackColor={{ false: Platform.OS === 'android' ? colors.border : 'rgba(255, 255, 255, 0.1)', true: colors.accentGreen }}
                thumbColor={isRegistrationOpen ? '#FFFFFF' : '#94A3B8'}
              />
            </View>

            {/* 2. Transfer Window Switch */}
            <View style={[styles.toggleRow, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}>
              <View style={styles.toggleLabelGroup}>
                <View style={[styles.toggleIconBox, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
                  <Ionicons name="swap-horizontal" size={18} color="#F59E0B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.toggleTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Transfer Oynasi Holati"}</Text>
                  <Text
                    style={[
                      styles.toggleSub,
                      { color: transferWindowOpen ? (Platform.OS === 'android' ? colors.accentGreen : '#00FF87') : '#EF4444' },
                    ]}
                  >
                    {transferWindowOpen ? "OCHIQ (O'yinchilar ko'chishi mumkin)" : "YOPILGAN (O'yinchilar ko'chishi to'xtatilgan)"}
                  </Text>
                </View>
              </View>
              <Switch
                value={transferWindowOpen}
                onValueChange={handleTransferToggle}
                trackColor={{ false: Platform.OS === 'android' ? colors.border : 'rgba(255, 255, 255, 0.1)', true: '#F59E0B' }}
                thumbColor={transferWindowOpen ? '#FFFFFF' : '#94A3B8'}
              />
            </View>

            {/* Registration Website Link Card */}
            <View style={[styles.toggleRow, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}>
              <TouchableOpacity
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                activeOpacity={0.8}
                onPress={() => {
                  const url = `https://amatora.uz/${currentOrg?.slug || 'hfl'}`;
                  Linking.openURL(url).catch(() => {
                    Alert.alert("Sayt havolasi", url);
                  });
                }}
              >
                <View style={[styles.toggleIconBox, { backgroundColor: isDark ? 'rgba(0, 255, 135, 0.15)' : '#ECFDF5' }]}>
                  <Ionicons name="globe-outline" size={18} color={colors.accentGreen} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.toggleTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Ro'yxatdan o'tkazish sayti"}</Text>
                  <Text style={[styles.toggleSub, { color: colors.accentGreen, textDecorationLine: 'underline' }]} numberOfLines={1}>
                    {`https://amatora.uz/${currentOrg?.slug || 'hfl'}`}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  {
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 10,
                    backgroundColor: isDark ? 'rgba(0, 255, 135, 0.15)' : '#ECFDF5',
                    borderWidth: 1,
                    borderColor: colors.accentGreen,
                  },
                ]}
                activeOpacity={0.7}
                onPress={() => {
                  const url = `https://amatora.uz/${currentOrg?.slug || 'hfl'}`;
                  Alert.alert(
                    "Nusxalandi!",
                    `Sayt havolasi:\n\n${url}\n\nUshbu havolani ishtirokchilar va jamoalarga yuboring.`
                  );
                }}
              >
                <Ionicons name="copy-outline" size={16} color={colors.accentGreen} />
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {/* Account & Organization Details with 1-to-1 SuperAdmin Inline Editing */}
      <View style={[styles.sectionCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        {Platform.OS === 'ios' && <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
        <View style={styles.sectionHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.sectionTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>
              {userRole === 'user' ? "Mening Akkount Ma'lumotlarim" : "Tashkilot & Admin Ma'lumotlari"}
            </Text>
            <TouchableOpacity
              style={styles.inlineEditIconBtn}
              activeOpacity={0.8}
              onPress={() => setIsEditingInfo(!isEditingInfo)}
            >
              <Ionicons name={isEditingInfo ? "close-circle" : "create-outline"} size={18} color={colors.accentGreen} />
            </TouchableOpacity>
          </View>
        </View>

        {isEditingInfo ? (
          <View style={styles.inlineFormContainer}>
            {/* 1. Name Input */}
            <View style={styles.inlineInputGroup}>
              <Text style={[styles.inlineInputLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>
                {userRole === 'user' ? "ISMI VA FAMILIYASI *" : "TASHKILOT NOMI *"}
              </Text>
              <TextInput
                style={[styles.textInput, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border, color: colors.textPrimary }]}
                value={editName}
                onChangeText={setEditName}
                placeholder="Ism Familiyani kiriting..."
                placeholderTextColor={colors.textMuted}
              />
            </View>

            {/* 2. Slug Input (Admin Only) */}
            {userRole !== 'user' && (
              <View style={styles.inlineInputGroup}>
                <Text style={[styles.inlineInputLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"IDENTIFIKATOR / SLUG *"}</Text>
                <TextInput
                  style={[styles.textInput, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border, color: colors.textPrimary }]}
                  value={editSlug}
                  onChangeText={setEditSlug}
                  placeholder="tashkilot-slug"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                />
              </View>
            )}

            {/* 3. Email Input */}
            <View style={styles.inlineInputGroup}>
              <Text style={[styles.inlineInputLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>
                {userRole === 'user' ? "LOGIN EMAIL *" : "ADMIN EMAIL MANZILI *"}
              </Text>
              <TextInput
                style={[styles.textInput, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border, color: colors.textPrimary }]}
                value={editEmail}
                onChangeText={setEditEmail}
                placeholder="email@domain.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            {/* 4. Password Input with Eye Toggle */}
            <View style={styles.inlineInputGroup}>
              <Text style={[styles.inlineInputLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>
                {userRole === 'user' ? "KIRISH PAROLI *" : "ADMIN PAROLI *"}
              </Text>
              <View style={[styles.passwordInputWrapper, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}>
                <TextInput
                  style={[styles.textInput, { flex: 1, borderWidth: 0, backgroundColor: 'transparent' }, Platform.OS === 'android' && { color: colors.textPrimary }]}
                  value={editPassword}
                  onChangeText={setEditPassword}
                  placeholder="Yangi parol..."
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <Ionicons name={showPassword ? "eye-off" : "eye"} size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            {/* 5. Contact Phone Input (Admin Only) */}
            {userRole !== 'user' && (
              <View style={styles.inlineInputGroup}>
                <Text style={[styles.inlineInputLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"BOG'LANISH TELEFONI *"}</Text>
                <View style={[styles.phoneInputWrapper, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}>
                  <View style={[styles.phonePrefixBox, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(0, 255, 135, 0.12)' : '#ECFDF5', borderRightColor: colors.border }]}>
                    <Text style={[styles.phonePrefixText, Platform.OS === 'android' && { color: colors.accentGreen }]}>{'+998'}</Text>
                  </View>
                  <TextInput
                    style={[styles.phoneInput, Platform.OS === 'android' && { color: colors.textPrimary }]}
                    value={editPhoneSuffix}
                    onChangeText={(v) => {
                      const digits = v.replace(/[^0-9 ]/g, '');
                      setEditPhoneSuffix(digits);
                    }}
                    placeholder="90 123 45 67"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    maxLength={12}
                  />
                </View>
              </View>
            )}

            {/* 6. Brand Colors List (Admin Only) */}
            {userRole !== 'user' && (
              <View style={styles.inlineInputGroup}>
                <Text style={[styles.inlineInputLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"TASHKILOT RANGLARI *"}</Text>
                <View style={styles.brandColorsList}>
                  {editBrandColors.map((colorHex, idx) => (
                    <View key={idx} style={styles.colorEditRow}>
                      <ColorPicker
                        value={colorHex}
                        onChange={(color: string) => handleUpdateBrandColor(idx, color)}
                        tabs={['picker', 'palettes']}
                      />
                      <TextInput
                        style={[styles.colorHexInput, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border, color: colors.textPrimary }]}
                        value={colorHex}
                        onChangeText={(val) => handleUpdateBrandColor(idx, val)}
                        placeholder="#HEX"
                        placeholderTextColor={colors.textMuted}
                        autoCapitalize="characters"
                        maxLength={7}
                      />
                      {editBrandColors.length > 1 && (
                        <TouchableOpacity
                          style={styles.removeColorBtn}
                          onPress={() => handleRemoveBrandColor(idx)}
                        >
                          <Ionicons name="trash-outline" size={16} color="#EF4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}

                  {/* Add Brand Color Button */}
                  <TouchableOpacity
                    style={[styles.addColorBtn, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(0, 255, 135, 0.1)' : '#ECFDF5', borderColor: colors.accentGreen, borderWidth: 1 }]}
                    onPress={handleAddBrandColor}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="add-circle-outline" size={16} color={colors.accentGreen} />
                    <Text style={[styles.addColorBtnText, Platform.OS === 'android' && { color: colors.accentGreen }]}>{"Rang qo'shish"}</Text>
                  </TouchableOpacity>

                  {/* Live Gradient Preview */}
                  {editBrandColors.length > 0 && (
                    <LinearGradient
                      colors={
                        editBrandColors.length === 1
                          ? [editBrandColors[0], editBrandColors[0]]
                          : (editBrandColors as [string, string, ...string[]])
                      }
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.gradientPreview}
                    />
                  )}
                </View>
              </View>
            )}

            {/* 7. YouTube Integration (Admin Only) */}
            {userRole !== 'user' && (
              <View style={styles.inlineInputGroup}>
                <Text style={[styles.inlineInputLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"YOUTUBE KANALI"}</Text>
                {ytLoading ? (
                  <View style={[styles.ytBox, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}>
                    <ActivityIndicator size="small" color="#FF0000" />
                    <Text style={{ color: colors.textMuted, fontSize: 12 }}>{"YouTube holati tekshirilmoqda..."}</Text>
                  </View>
                ) : ytChannelInfo ? (
                  <View style={[styles.ytBox, { borderColor: 'rgba(0, 255, 102, 0.3)' }, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.accentGreen }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                      {ytChannelInfo.thumbnail ? (
                        <Image source={{ uri: ytChannelInfo.thumbnail }} style={styles.ytAvatar} />
                      ) : (
                        <View style={[styles.ytIconBox, { backgroundColor: isDark ? 'rgba(0, 255, 102, 0.15)' : '#ECFDF5' }]}>
                          <Ionicons name="checkmark-circle" size={20} color={colors.accentGreen} />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.ytTitle, Platform.OS === 'android' && { color: colors.textPrimary }]} numberOfLines={1}>
                          {ytChannelInfo.title}
                        </Text>
                        <Text style={[styles.ytSub, { color: colors.accentGreen }]}>
                          {"YouTube kanal ulangan ✓"}
                        </Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      style={styles.ytDisconnectBtn}
                      activeOpacity={0.7}
                      onPress={handleDisconnectYouTube}
                    >
                      <Ionicons name="close-circle" size={16} color="#EF4444" />
                      <Text style={styles.ytDisconnectText}>{"Uzish"}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.ytBox, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
                    activeOpacity={0.7}
                    onPress={handleConnectYouTube}
                    disabled={ytConnecting}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                      <View style={[styles.ytIconBox, { backgroundColor: 'rgba(255, 0, 0, 0.15)' }]}>
                        <Ionicons name="logo-youtube" size={20} color="#FF0000" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.ytTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"YouTube Kanal Ulash"}</Text>
                        <Text style={[styles.ytSub, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Translyatsiya boshqaruvi uchun"}</Text>
                      </View>
                    </View>
                    {ytConnecting ? (
                      <ActivityIndicator size="small" color="#FF0000" />
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Save & Cancel Buttons */}
            <View style={styles.inlineActionRow}>
              <TouchableOpacity
                style={[styles.inlineCancelBtn, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border, borderWidth: 1 }]}
                activeOpacity={0.8}
                onPress={() => setIsEditingInfo(false)}
                disabled={isSavingInfo}
              >
                <Text style={[styles.inlineCancelText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Bekor qilish"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.inlineSaveBtn, Platform.OS === 'android' && { backgroundColor: colors.accentGreen }, isSavingInfo && { opacity: 0.6 }]}
                activeOpacity={0.8}
                onPress={handleSaveAdminInfo}
                disabled={isSavingInfo}
              >
                {isSavingInfo ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={[styles.inlineSaveText, Platform.OS === 'android' && { color: '#FFFFFF' }]}>{"Saqlash"}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            {userRole === 'user' ? (
              <>
                <View style={[styles.infoRow, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated }]}>
                  <Ionicons name="person-outline" size={16} color={colors.textMuted} />
                  <Text style={[styles.infoLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Ismi va Familiyasi:"}</Text>
                  <Text style={[styles.infoValue, Platform.OS === 'android' && { color: colors.textPrimary }]}>{editName || 'Organizator'}</Text>
                </View>

                <View style={[styles.infoRow, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated }]}>
                  <Ionicons name="mail-outline" size={16} color={colors.textMuted} />
                  <Text style={[styles.infoLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Login Email:"}</Text>
                  <Text style={[styles.infoValue, Platform.OS === 'android' && { color: colors.textPrimary }]}>{editEmail || '—'}</Text>
                </View>

                <View style={[styles.infoRow, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated }]}>
                  <Ionicons name="key-outline" size={16} color={colors.textMuted} />
                  <Text style={[styles.infoLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Parol:"}</Text>
                  <Text style={[styles.infoValue, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"••••••••"}</Text>
                </View>
              </>
            ) : (
              <>
                <View style={[styles.infoRow, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated }]}>
                  <Ionicons name="business-outline" size={16} color={colors.textMuted} />
                  <Text style={[styles.infoLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Tashkilot:"}</Text>
                  {loading || (!currentOrg?.name && !editName) ? (
                    <TextSkeleton width={140} height={14} borderRadius={4} />
                  ) : (
                    <Text style={[styles.infoValue, Platform.OS === 'android' && { color: colors.textPrimary }]}>{currentOrg?.name || editName}</Text>
                  )}
                </View>

                <View style={[styles.infoRow, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated }]}>
                  <Ionicons name="link-outline" size={16} color={colors.textMuted} />
                  <Text style={[styles.infoLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Identifikator:"}</Text>
                  {loading || (!currentOrg?.slug && !editSlug) ? (
                    <TextSkeleton width={80} height={14} borderRadius={4} />
                  ) : (
                    <Text style={[styles.infoValue, Platform.OS === 'android' && { color: colors.textPrimary }]}>{currentOrg?.slug || editSlug}</Text>
                  )}
                </View>

                <View style={[styles.infoRow, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated }]}>
                  <Ionicons name="mail-outline" size={16} color={colors.textMuted} />
                  <Text style={[styles.infoLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Email:"}</Text>
                  <Text style={[styles.infoValue, Platform.OS === 'android' && { color: colors.textPrimary }]}>
                    {editEmail || currentOrg?.admin_email || currentOrg?.email || '—'}
                  </Text>
                </View>

                <View style={[styles.infoRow, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated }]}>
                  <Ionicons name="call-outline" size={16} color={colors.textMuted} />
                  <Text style={[styles.infoLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Telefon:"}</Text>
                  <Text style={[styles.infoValue, Platform.OS === 'android' && { color: colors.textPrimary }]}>
                    {(() => {
                      const ph = currentOrg?.contact_phone || currentOrg?.phone || '';
                      if (ph) return ph;
                      if (editPhoneSuffix) return `+998 ${editPhoneSuffix}`;
                      return '—';
                    })()}
                  </Text>
                </View>

                {ytChannelInfo && (
                  <View style={[styles.infoRow, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated }]}>
                    <Ionicons name="logo-youtube" size={16} color="#FF0000" />
                    <Text style={[styles.infoLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"YouTube:"}</Text>
                    <Text style={[styles.infoValue, { color: colors.accentGreen }]} numberOfLines={1}>
                      {ytChannelInfo.title}
                    </Text>
                  </View>
                )}
              </>
            )}
          </>
        )}
      </View>

      {/* Navigation Quick Links */}
      <View style={[styles.sectionCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
        {Platform.OS === 'ios' && <BlurView intensity={80} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
        <Text style={[styles.sectionTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Boshqaruv Menyu"}</Text>

        <TouchableOpacity
          style={[styles.menuLinkRow, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
          activeOpacity={0.8}
          onPress={() => {
            if (onNavigateToSettings) {
              onNavigateToSettings();
            }
          }}
        >
          <View style={[styles.menuIconBox, { backgroundColor: isDark ? 'rgba(0, 255, 135, 0.12)' : '#ECFDF5' }]}>
            <Ionicons name="settings-sharp" size={18} color={colors.accentGreen} />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={[styles.menuLinkText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Tizim Sozlamalari va Konfiguratsiya"}</Text>
            <Text style={[styles.menuLinkSub, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Mobil ilova, biometriya va xavfsizlik sozlamalari"}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {userRole !== 'user' && (
          <TouchableOpacity
            style={[styles.menuLinkRow, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
            activeOpacity={0.8}
            onPress={() => {
              if (onNavigateToOrganizers) {
                onNavigateToOrganizers();
              }
            }}
          >
            <View style={[styles.menuIconBox, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
              <Ionicons name="people-sharp" size={18} color="#38BDF8" />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={[styles.menuLinkText, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Organizatorlar (Userlar)"}</Text>
              <Text style={[styles.menuLinkSub, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Tashkilot xodimlariga kirish huquqlarini berish va boshqarish"}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.logoutBtn, Platform.OS === 'android' && { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.12)' : '#FEF2F2', borderColor: '#EF4444' }]}
          activeOpacity={0.8}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={18} color="#EF4444" />
          <Text style={[styles.logoutBtnText, Platform.OS === 'android' && { color: '#EF4444' }]}>{"Tizimdan Chiqish"}</Text>
        </TouchableOpacity>
      </View>

      {/* Sleek single-row Organization Info Badge at the VERY BOTTOM for Regular User */}
      {userRole === 'user' && currentOrg && (
        <View style={[styles.userOrgBottomCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
          {Platform.OS === 'ios' && <BlurView intensity={70} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />}
          <Image
            source={{ uri: currentOrg.logo_url || 'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=100&auto=format&fit=crop' }}
            style={[styles.userOrgBottomLogo, { backgroundColor: colors.bgCardElevated }]}
          />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.userOrgBottomLabel, Platform.OS === 'android' && { color: colors.textMuted }]}>{"Biriktirilgan Tashkilot"}</Text>
            <Text style={[styles.userOrgBottomName, Platform.OS === 'android' && { color: colors.textPrimary }]}>{currentOrg.name || 'Amatora'}</Text>
          </View>
          <View style={styles.userOrgStatusPill}>
            <View style={styles.greenDot} />
            <Text style={styles.userOrgStatusText}>{"FAOL"}</Text>
          </View>
        </View>
      )}

      {/* Organizers (User Roles) Management Modal */}
      <Modal
        visible={showOrganizersModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowOrganizersModal(false)}
      >
        <View style={styles.modalOverlay}>
          {Platform.OS === 'ios' && <BlurView intensity={95} tint="dark" style={StyleSheet.absoluteFill} />}

          <View style={[styles.glassModalCard, { maxWidth: 380, maxHeight: '85%', padding: 20 }, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={85} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />}

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.glassModalTitle, { marginBottom: 2, textAlign: 'left' }, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Organizatorlar Bilan Ishlash"}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>{`Tashkilot ID: #${currentOrg?.id || orgId}`}</Text>
              </View>
              <TouchableOpacity onPress={() => setShowOrganizersModal(false)} style={{ padding: 4 }}>
                <Ionicons name="close-circle" size={26} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {!showAddOrganizerForm ? (
              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  backgroundColor: isDark ? 'rgba(56, 189, 248, 0.2)' : '#E0F2FE',
                  borderColor: '#38BDF8',
                  borderWidth: 1,
                  borderRadius: 14,
                  paddingVertical: 12,
                  width: '100%',
                  marginBottom: 16,
                }}
                activeOpacity={0.8}
                onPress={() => setShowAddOrganizerForm(true)}
              >
                <Ionicons name="person-add" size={18} color="#38BDF8" />
                <Text style={{ color: Platform.OS === 'android' ? '#0284C7' : '#FFFFFF', fontWeight: '700', fontSize: 14 }}>{"Yangi User (Organizator) Qo'shish"}</Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: '100%', backgroundColor: Platform.OS === 'android' ? colors.bgCardElevated : 'rgba(0,0,0,0.3)', padding: 14, borderRadius: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: '#38BDF8', fontWeight: '700', fontSize: 14, marginBottom: 10 }}>{"Yangi Organizator Kiritish"}</Text>
                
                <TextInput
                  style={[styles.inlineInput, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                  placeholder="F.I.SH (Ism Familiya)"
                  placeholderTextColor={colors.textMuted}
                  value={newOrgName}
                  onChangeText={setNewOrgName}
                />
                
                <TextInput
                  style={[styles.inlineInput, { marginTop: 8 }, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                  placeholder="Login Email"
                  placeholderTextColor={colors.textMuted}
                  value={newOrgEmail}
                  onChangeText={setNewOrgEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                <TextInput
                  style={[styles.inlineInput, { marginTop: 8 }, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, color: colors.textPrimary }]}
                  placeholder="Parol"
                  placeholderTextColor={colors.textMuted}
                  value={newOrgPassword}
                  onChangeText={setNewOrgPassword}
                  secureTextEntry
                />

                <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                  <TouchableOpacity
                    style={[{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center' }, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border, borderWidth: 1 }]}
                    onPress={() => setShowAddOrganizerForm(false)}
                  >
                    <Text style={{ color: Platform.OS === 'android' ? colors.textPrimary : '#FFFFFF', fontSize: 13 }}>{"Bekor qilish"}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#38BDF8', alignItems: 'center' }}
                    onPress={handleCreateOrganizer}
                    disabled={isCreatingOrgUser}
                  >
                    {isCreatingOrgUser ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 13 }}>{"Saqlash"}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <ScrollView style={{ width: '100%' }} showsVerticalScrollIndicator={false}>
              {loadingOrganizers ? (
                <ActivityIndicator size="small" color="#38BDF8" style={{ marginVertical: 20 }} />
              ) : organizersList.length === 0 ? (
                <View style={{ padding: 20, alignItems: 'center' }}>
                  <Ionicons name="people-outline" size={40} color={colors.textMuted} />
                  <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 8 }}>{"Hozircha organizatorlar yo'q"}</Text>
                </View>
              ) : (
                organizersList.map((item) => (
                  <View
                    key={item.id}
                    style={[
                      {
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: 'rgba(255,255,255,0.06)',
                        borderRadius: 14,
                        padding: 12,
                        marginBottom: 8,
                        borderWidth: 1,
                        borderColor: 'rgba(255,255,255,0.1)',
                      },
                      Platform.OS === 'android' && {
                        backgroundColor: colors.bgCardElevated,
                        borderColor: colors.border,
                      }
                    ]}
                  >
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(56, 189, 248, 0.15)', justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
                      <Ionicons name="person" size={18} color="#38BDF8" />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={[{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }, Platform.OS === 'android' && { color: colors.textPrimary }]}>{item.full_name || 'Organizator'}</Text>
                      <Text style={[{ color: '#94A3B8', fontSize: 12, marginTop: 2 }, Platform.OS === 'android' && { color: colors.textMuted }]}>{item.email}</Text>
                      <Text style={[{ color: '#64748B', fontSize: 11, marginTop: 1 }, Platform.OS === 'android' && { color: colors.textMuted }]}>{`Parol: ${item.password}`}</Text>
                    </View>

                    <TouchableOpacity onPress={() => handleDeleteOrganizer(item.id)} style={{ padding: 6 }}>
                      <Ionicons name="trash-outline" size={18} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Glassmorphism Logout Confirmation Modal */}
      <Modal
        visible={showLogoutModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowLogoutModal(false)}
      >
        <View style={styles.modalOverlay}>
          {Platform.OS === 'ios' && <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} />}
          
          <View style={[styles.glassModalCard, Platform.OS === 'android' && { backgroundColor: colors.bgCard, borderColor: colors.border }]}>
            {Platform.OS === 'ios' && <BlurView intensity={85} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} pointerEvents="none" />}
            
            <Text style={[styles.glassModalTitle, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Akkountdan chiqmoqchimisiz?"}</Text>

            <View style={styles.glassModalActions}>
              <TouchableOpacity
                style={[styles.glassModalBtnStay, Platform.OS === 'android' && { backgroundColor: colors.bgCardElevated, borderColor: colors.border }]}
                activeOpacity={0.7}
                onPress={() => setShowLogoutModal(false)}
              >
                <Text style={[styles.glassModalTextStay, Platform.OS === 'android' && { color: colors.textPrimary }]}>{"Qolish"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.glassModalBtnLogout, Platform.OS === 'android' && { backgroundColor: '#EF4444', borderColor: '#EF4444' }]}
                activeOpacity={0.7}
                onPress={confirmLogout}
              >
                <Text style={[styles.glassModalTextLogout, Platform.OS === 'android' && { color: '#FFFFFF' }]}>{"Chiqish"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  glassModalCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    overflow: 'hidden',
  },
  glassModalTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 22,
    letterSpacing: 0.2,
  },
  glassModalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
  },
  glassModalBtnStay: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.14)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  glassModalTextStay: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  glassModalBtnLogout: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  glassModalTextLogout: {
    color: '#EF4444',
    fontSize: 15,
    fontWeight: '700',
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  scrollContent: {
    paddingBottom: 140,
    gap: 16,
  },
  header: {
    marginBottom: 4,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerSub: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  profileCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 22,
    padding: 18,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    gap: 16,
    overflow: 'hidden',
  },
  profileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  logoWrapper: {
    position: 'relative',
    width: 62,
    height: 62,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orgLogo: {
    width: 62,
    height: 62,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  logoEditBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 22,
    marginBottom: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  roleBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  orgIdText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  inlineEditIconBtn: {
    padding: 4,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  toggleLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    marginRight: 10,
  },
  toggleIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  toggleSub: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  sectionCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    gap: 14,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  infoLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  infoValue: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
    textAlign: 'right',
  },
  inlineFormContainer: {
    gap: 12,
    marginTop: 4,
  },
  inlineInputGroup: {
    gap: 4,
  },
  brandColorsList: {
    gap: 8,
    marginTop: 4,
  },
  colorEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  colorSquare: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  colorHexInput: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#FFF',
    fontSize: 13,
    height: 36,
  },
  removeColorBtn: {
    width: 36,
    height: 36,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addColorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 255, 135, 0.1)',
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 4,
  },
  addColorBtnText: {
    color: '#00FF87',
    fontSize: 12,
    fontWeight: '700',
  },
  gradientPreview: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    marginTop: 4,
  },
  inlineInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#FFFFFF',
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  modalContent: {
    width: '100%',
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalSaveBtn: {
    backgroundColor: '#00FF87',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  modalSaveBtnText: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: 'bold',
  },
  inlineInputLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: '#CBD5E1',
    letterSpacing: 0.5,
  },
  textInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 13.5,
  },
  passwordInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    paddingRight: 10,
  },
  eyeBtn: {
    padding: 6,
  },
  phoneInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  phonePrefixBox: {
    backgroundColor: 'rgba(0, 255, 135, 0.12)',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  phonePrefixText: {
    color: '#00FF87',
    fontWeight: '900',
    fontSize: 13.5,
  },
  phoneInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#FFFFFF',
    fontSize: 13.5,
  },
  inlineActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  inlineCancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  inlineCancelText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  inlineSaveBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#00FF87',
    alignItems: 'center',
  },
  inlineSaveText: {
    color: '#000000',
    fontWeight: '900',
    fontSize: 12,
  },
  menuLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  menuIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 255, 135, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLinkText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  menuLinkSub: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    marginTop: 4,
  },
  logoutBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // User Role Bottom Organization Badge Styles
  userOrgBottomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 14,
    padding: 12,
    marginTop: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    gap: 12,
    overflow: 'hidden',
  },
  userOrgBottomLogo: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  userOrgBottomLabel: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontSize: 10.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  userOrgBottomName: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '900',
  },
  userOrgStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  userOrgStatusText: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  // ─── YouTube Styles ──────────────────────────────────────────
  ytBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  ytIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ytAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 255, 102, 0.4)',
  },
  ytTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  ytSub: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 2,
  },
  ytDisconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  ytDisconnectText: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '700',
  },
});
